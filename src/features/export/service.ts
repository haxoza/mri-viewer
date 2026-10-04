import { ViewerError } from '../../app/errors';
import { abortable } from '../../app/async';
import { renderAndWait } from '../../imaging/rendering/render';
import { useMarks } from '../annotations/model';
import { Enums, StackViewport, VolumeViewport, type Types } from '@cornerstonejs/core';
import { controllers, crosshairs, pause } from '../../imaging/rendering/controller';
import { getSet, paneCount, useSession } from '../../app/store';
import { volumes } from '../../imaging/rendering/volumes';
import {
  nativeCompatibility,
  nativeReference,
  nativeReferenceLabel,
  nativeReferenceColors,
  nearestNative,
  insideNativeImage,
  projectToNativePlane,
  planeOffset,
} from '../../imaging/nativeGeometry';
import { budgets } from '../../imaging/types';
export interface ExportOptions {
  scope: 'active' | 'workspace';
  pane?: number;
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
    throw new ViewerError(
      `Use dimensions up to ${b.exportSide}px per side and ${b.exportPixels / 1e6} megapixels.`,
    );
}
export async function exportImage(
  options: ExportOptions,
  workspace: HTMLElement,
  signal?: AbortSignal,
): Promise<Blob> {
  signal?.throwIfAborted();
  pause();
  const state = useSession.getState();
  validateExport(options.width, options.height, state.profile);
  const selected = controllers.filter(
    (c) =>
      c.index < paneCount(state.layout) &&
      c.viewport &&
      c.element &&
      (options.scope === 'workspace' || c.index === (options.pane ?? state.active)),
  );
  if (!selected.length) throw new ViewerError('Open an image before exporting.');
  if (selected.some((c) => state.panes[c.index].pending))
    throw new ViewerError('Wait for pending frames to finish before exporting.');
  const bounds =
    options.scope === 'workspace'
      ? workspace.getBoundingClientRect()
      : selected[0].element!.getBoundingClientRect();
  const snapshots = selected.map((c) => ({
    index: c.index,
    linked: state.panes[c.index].linked,
    marks: structuredClone(useMarks.getState().panes[c.index]),
    mode: state.panes[c.index].mode,
    setId: state.panes[c.index].setId!,
    rect: c.element!.getBoundingClientRect(),
    camera: structuredClone(c.viewport!.getCamera()),
    properties: structuredClone(c.viewport!.getProperties()),
    imageIds: c.viewport instanceof StackViewport ? c.viewport.getImageIds() : undefined,
    displayed: state.panes[c.index].displayed,
    point: crosshairs.get(state.panes[c.index].setId!)?.slice(),
  }));
  const canvas = document.createElement('canvas');
  canvas.width = options.width;
  canvas.height = options.height;
  const context = canvas.getContext('2d');
  if (!context) throw new ViewerError('Export canvas allocation failed. Try a smaller size.');
  context.fillStyle = '#000';
  context.fillRect(0, 0, canvas.width, canvas.height);
  const scale = Math.min(options.width / bounds.width, options.height / bounds.height),
    ox = (options.width - bounds.width * scale) / 2,
    oy = (options.height - bounds.height * scale) / 2;
  // Volume textures belong to the viewer's WebGL context. A separate engine
  // cannot reuse them and renders black MPR images.
  const engine = selected[0].viewport!.getRenderingEngine();
  const id = `export-${crypto.randomUUID()}`;
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-20000px;top:0;pointer-events:none;';
  document.body.append(holder);
  const releaseViewport = () => {
    if (!engine.getViewport(id)) return;
    // Shrink the shared GPU buffer while the export viewport is still registered.
    // Removing a large viewport alone leaves the buffer larger than the pool's
    // recorded size, so subsequent pane renders copy from the wrong region.
    holder.style.width = '1px';
    holder.style.height = '1px';
    engine.resize(false, true);
    engine.disableElement(id);
  };
  try {
    for (const s of snapshots) {
      signal?.throwIfAborted();
      const w = Math.max(1, Math.round(s.rect.width * scale)),
        h = Math.max(1, Math.round(s.rect.height * scale));
      holder.style.width = `${w / devicePixelRatio}px`;
      holder.style.height = `${h / devicePixelRatio}px`;
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
      if (v instanceof StackViewport) await abortable(v.setStack(s.imageIds!, s.displayed), signal);
      else await abortable(v.setVolumes([{ volumeId: volumes.volumes.get(s.setId)!.id }]), signal);
      v.setCamera(s.camera);
      if (s.properties) v.setProperties(s.properties);
      await renderAndWait(v, signal);
      const x = ox + (s.rect.left - bounds.left) * scale,
        y = oy + (s.rect.top - bounds.top) * scale;
      signal?.throwIfAborted();
      context.drawImage(v.canvas, x, y, w, h);
      for (const mark of s.marks) {
        context.strokeStyle = mark.color;
        context.lineWidth = Math.max(1, 2 * scale);
        context.beginPath();
        context.ellipse(
          x + mark.x * w,
          y + mark.y * h,
          mark.rx * w,
          mark.ry * h,
          0,
          0,
          2 * Math.PI,
        );
        context.stroke();
      }
      if (options.overlays) {
        context.fillStyle = '#dce7ed';
        context.font = `${Math.max(12, 14 * scale)}px system-ui`;
        context.fillText(
          `Pane ${s.index + 1} · ${s.mode === 'stack' ? 'Slice' : s.mode} ${s.displayed + 1}`,
          x + 12,
          y + 24 * scale,
        );
        if (s.mode === 'stack' && s.linked && state.nativeLinks && state.nativePoint) {
          const shared = state.nativePoint,
            source = getSet(shared.setId),
            target = getSet(s.setId);
          if (source && target) {
            const match = nearestNative(source, target, shared.point);
            const frame = target.frames[s.displayed];
            const offset = match.reason ? 0 : Math.abs(planeOffset(frame, shared.point));
            const outside =
              match.outside || (!match.reason && !insideNativeImage(frame, shared.point));
            context.save();
            context.beginPath();
            context.rect(x, y, w, h);
            context.clip();
            context.fillStyle = '#f2d49b';
            context.font = `${Math.max(10, 11 * scale)}px system-ui`;
            const label =
              match.reason ??
              `Native ${s.displayed === match.index ? 'nearest-slice' : 'displayed-slice'} offset ${offset.toFixed(2)} mm${outside ? ' · Outside acquired coverage' : ''}`;
            context.fillText(label, x + 12, y + 44 * scale);
            context.fillText(
              'Experimental · alignment unverified · not for diagnosis',
              x + 12,
              y + 60 * scale,
            );
            if (!match.reason) {
              const canvasPoint = (point: Types.Point3) => {
                const p = v.worldToCanvas(point);
                return [x + p[0] * devicePixelRatio, y + p[1] * devicePixelRatio];
              };
              context.strokeStyle = '#f2c66b';
              context.setLineDash([6 * scale, 4 * scale]);
              let lineIndex = 0,
                noteIndex = 0;
              state.panes.slice(0, paneCount(state.layout)).forEach((other, i) => {
                const set = getSet(other.setId);
                if (
                  i === s.index ||
                  !other.linked ||
                  other.mode !== 'stack' ||
                  other.pending ||
                  other.error ||
                  other.displayed < 0 ||
                  !set ||
                  nativeCompatibility(target, set)
                )
                  return;
                const reference = nativeReference(frame, set.frames[other.displayed]);
                context.strokeStyle = nativeReferenceColors[i];
                context.fillStyle = nativeReferenceColors[i];
                if (reference.relation !== 'intersecting') {
                  context.fillText(
                    `Pane ${i + 1}: ${nativeReferenceLabel(reference)}`,
                    x + 12,
                    y + (78 + noteIndex++ * 16) * scale,
                  );
                  return;
                }
                const [a, b] = reference.segment.map(canvasPoint);
                context.beginPath();
                context.moveTo(a[0], a[1]);
                context.lineTo(b[0], b[1]);
                context.stroke();
                context.fillText(
                  `Pane ${i + 1}`,
                  (a[0] + b[0]) / 2 + 8,
                  (a[1] + b[1]) / 2 - 8 - lineIndex++ * 16 * scale,
                );
              });
              if (insideNativeImage(frame, shared.point)) {
                const [px, py] = canvasPoint(projectToNativePlane(frame, shared.point));
                context.strokeStyle = '#76dacb';
                context.setLineDash(offset > 0.01 || outside ? [3 * scale, 3 * scale] : []);
                context.beginPath();
                context.moveTo(px - 12 * scale, py);
                context.lineTo(px + 12 * scale, py);
                context.moveTo(px, py - 12 * scale);
                context.lineTo(px, py + 12 * scale);
                context.stroke();
              }
            }
            context.restore();
          }
        }
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
      releaseViewport();
    }
    const mime = options.format === 'png' ? 'image/png' : 'image/jpeg';
    const blob = await abortable(
      new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) =>
            b
              ? resolve(b)
              : reject(new ViewerError('Export allocation failed. Try a smaller size.')),
          mime,
          options.quality,
        ),
      ),
      signal,
    );
    if (blob.type !== mime) throw new ViewerError('Browser did not produce the selected format.');
    const decoded = await createImageBitmap(blob);
    const valid = decoded.width === options.width && decoded.height === options.height;
    decoded.close();
    if (!valid) throw new ViewerError('Export dimensions did not match.');
    signal?.throwIfAborted();
    return blob;
  } finally {
    releaseViewport();
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
