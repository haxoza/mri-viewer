import {
  Enums,
  RenderingEngine,
  StackViewport,
  VolumeViewport,
  type Types,
} from '@cornerstonejs/core';
import { controllers, crosshairs, pause } from '../../imaging/rendering/controller';
import { useSession } from '../../app/store';
import { volumes } from '../../imaging/rendering/volumes';
import { budgets } from '../../imaging/types';
export interface ExportOptions {
  scope: 'active' | 'workspace';
  format: 'png' | 'jpeg';
  width: number;
  height: number;
  quality: number;
  overlays: boolean;
}
export function validateExport(width: number, height: number, profile: 'standard' | 'low') {
  const b = budgets[profile];
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > b.exportSide ||
    height > b.exportSide ||
    width * height > b.exportPixels
  )
    throw new Error(
      `Use dimensions up to ${b.exportSide}px per side and ${b.exportPixels / 1e6} megapixels.`,
    );
}
export async function exportImage(options: ExportOptions, workspace: HTMLElement): Promise<Blob> {
  pause();
  const state = useSession.getState();
  validateExport(options.width, options.height, state.profile);
  const selected = controllers.filter(
    (c) => c.viewport && c.element && (options.scope === 'workspace' || c.index === state.active),
  );
  if (!selected.length) throw new Error('Open an image before exporting.');
  if (selected.some((c) => state.panes[c.index].pending))
    throw new Error('Wait for pending frames to finish before exporting.');
  const bounds =
    options.scope === 'workspace'
      ? workspace.getBoundingClientRect()
      : selected[0].element!.getBoundingClientRect();
  const snapshots = selected.map((c) => ({
    index: c.index,
    mode: state.panes[c.index].mode,
    setId: state.panes[c.index].setId!,
    rect: c.element!.getBoundingClientRect(),
    camera: structuredClone(c.viewport!.getCamera()),
    properties: structuredClone(c.viewport!.getProperties()),
    imageIds: c.viewport instanceof StackViewport ? c.viewport.getImageIds() : undefined,
    displayed: state.panes[c.index].displayed,
    point: crosshairs.get(state.panes[c.index].setId!),
  }));
  const canvas = document.createElement('canvas');
  canvas.width = options.width;
  canvas.height = options.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Export canvas allocation failed. Try a smaller size.');
  context.fillStyle = '#000';
  context.fillRect(0, 0, canvas.width, canvas.height);
  const scale = Math.min(options.width / bounds.width, options.height / bounds.height),
    ox = (options.width - bounds.width * scale) / 2,
    oy = (options.height - bounds.height * scale) / 2;
  const engine = new RenderingEngine(`export-${crypto.randomUUID()}`);
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-20000px;top:0;pointer-events:none;';
  document.body.append(holder);
  try {
    for (const s of snapshots) {
      const w = Math.max(1, Math.round(s.rect.width * scale)),
        h = Math.max(1, Math.round(s.rect.height * scale));
      holder.style.width = `${w / devicePixelRatio}px`;
      holder.style.height = `${h / devicePixelRatio}px`;
      const id = 'export-pane';
      engine.enableElement({
        viewportId: id,
        element: holder,
        type: s.mode === 'stack' ? Enums.ViewportType.STACK : Enums.ViewportType.ORTHOGRAPHIC,
        defaultOptions: {
          background: [0, 0, 0],
          ...(s.mode === 'stack'
            ? {}
            : {
                orientation: {
                  axial: Enums.OrientationAxis.AXIAL,
                  sagittal: Enums.OrientationAxis.SAGITTAL,
                  coronal: Enums.OrientationAxis.CORONAL,
                }[s.mode],
              }),
        },
      });
      const v = engine.getViewport(id) as StackViewport | VolumeViewport;
      if (v instanceof StackViewport) await v.setStack(s.imageIds!, s.displayed);
      else await v.setVolumes([{ volumeId: volumes.volumes.get(s.setId)!.id }]);
      v.setCamera(s.camera);
      if (s.properties) v.setProperties(s.properties);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          holder.removeEventListener(Enums.Events.IMAGE_RENDERED, rendered);
          reject(new Error('Export render timed out. Try a smaller image.'));
        }, 15000);
        const rendered = () => {
          clearTimeout(timer);
          holder.removeEventListener(Enums.Events.IMAGE_RENDERED, rendered);
          resolve();
        };
        holder.addEventListener(Enums.Events.IMAGE_RENDERED, rendered);
        v.render();
      });
      const x = ox + (s.rect.left - bounds.left) * scale,
        y = oy + (s.rect.top - bounds.top) * scale;
      context.drawImage(v.canvas, x, y, w, h);
      if (options.overlays) {
        context.fillStyle = '#dce7ed';
        context.font = `${Math.max(12, 14 * scale)}px system-ui`;
        context.fillText(
          `${s.mode === 'stack' ? 'Slice' : 'Reconstruction'} ${s.displayed + 1}`,
          x + 12,
          y + 24 * scale,
        );
        if (s.mode !== 'stack' && s.point) {
          const point = v.worldToCanvas(s.point as Types.Point3);
          const px = x + point[0] * devicePixelRatio,
            py = y + point[1] * devicePixelRatio;
          context.strokeStyle = '#76dacb';
          context.beginPath();
          context.moveTo(px, y);
          context.lineTo(px, y + h);
          context.moveTo(x, py);
          context.lineTo(x + w, py);
          context.stroke();
        }
      }
      engine.disableElement(id);
    }
    const mime = options.format === 'png' ? 'image/png' : 'image/jpeg';
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) =>
          b ? resolve(b) : reject(new Error('Export allocation failed. Try a smaller size.')),
        mime,
        options.quality,
      ),
    );
    if (blob.type !== mime) throw new Error('Browser did not produce the selected format.');
    const decoded = await createImageBitmap(blob);
    const valid = decoded.width === options.width && decoded.height === options.height;
    decoded.close();
    if (!valid) throw new Error('Export dimensions did not match.');
    return blob;
  } finally {
    engine.destroy();
    holder.remove();
    canvas.width = 0;
    canvas.height = 0;
  }
}
export function download(blob: Blob, format: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `mri-view.${format === 'jpeg' ? 'jpg' : 'png'}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
