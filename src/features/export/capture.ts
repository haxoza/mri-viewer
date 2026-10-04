import { ViewerError } from '../../app/errors';
import { create } from 'zustand';
import { paneCount, useSession } from '../../app/store';
import { controllers, pause } from '../../imaging/rendering/controller';
import { budgets } from '../../imaging/types';
import { interactionCancellation, settle } from '../../app/settlement';
import { exportImage, type ExportOptions } from './service';
import { useMarks } from '../annotations/model';
export interface Capture {
  signature: string;
  id: string;
  url: string;
  blob: Blob;
  width: number;
  height: number;
  options: ExportOptions;
  panes: { pane: number; mode: string; position: number; total: number }[];
}
export const useCapture = create<{ capture?: Capture; open: boolean }>(() => ({ open: false }));
let current: AbortController | undefined;
let queue: Promise<unknown> = Promise.resolve();
export function closeCapture() {
  current?.abort();
  const previous = useCapture.getState().capture;
  if (previous) URL.revokeObjectURL(previous.url);
  useCapture.setState({ capture: undefined, open: false });
}
export function captureDefaults(
  workspace: HTMLElement,
  scope: 'active' | 'workspace' = 'active',
  pane?: number,
): ExportOptions {
  const element =
    scope === 'workspace' ? workspace : controllers[pane ?? useSession.getState().active].element;
  if (!element) throw new ViewerError('Pane unavailable.');
  const r = element.getBoundingClientRect(),
    b = budgets[useSession.getState().profile];
  const scale = Math.min(
    1,
    b.exportSide / r.width,
    b.exportSide / r.height,
    Math.sqrt(b.exportPixels / (r.width * r.height)),
  );
  return {
    scope,
    pane,
    width: Math.max(1, Math.floor(r.width * scale)),
    height: Math.max(1, Math.floor(r.height * scale)),
    format: 'png',
    quality: 0.92,
    overlays: true,
  };
}
export function viewSignature() {
  const s = useSession.getState();
  return JSON.stringify({
    layout: s.layout,
    active: s.active,
    marks: useMarks.getState().panes,
    panes: s.panes.map((p, i) => ({
      set: p.setId,
      mode: p.mode,
      requested: p.requested,
      displayed: p.displayed,
      pending: p.pending,
      error: p.error,
      generation: controllers[i].generation,
      camera: controllers[i].viewport?.getCamera(),
      properties: controllers[i].viewport?.getProperties(),
      rect: controllers[i].element?.getBoundingClientRect().toJSON(),
    })),
  });
}
export function createCapture(
  options: ExportOptions,
  workspace: HTMLElement,
  external?: AbortSignal,
  ignoreInteractionsWithin?: HTMLElement,
): Promise<Capture> {
  current?.abort();
  const local = new AbortController();
  current = local;
  const signal = AbortSignal.any([
    local.signal,
    AbortSignal.timeout(60000),
    ...(external ? [external] : []),
  ]);
  const run = async () => {
    signal.throwIfAborted();
    // The export dialog cancels option changes through its signal; other dialog
    // interactions (such as locking the aspect ratio) should not cancel a render.
    const cleanup = interactionCancellation(local, ignoreInteractionsWithin);
    try {
      pause();
      await settle(signal);
      const state = useSession.getState();
      const panes = state.panes.slice(0, paneCount(state.layout)).flatMap((p, i) =>
        p.setId && (options.scope === 'workspace' || i === (options.pane ?? state.active))
          ? [
              {
                pane: i + 1,
                mode: p.mode === 'stack' ? 'acquired' : p.mode,
                position: p.displayed + 1,
                total: p.total,
              },
            ]
          : [],
      );
      const before = viewSignature();
      const blob = await exportImage(options, workspace, signal);
      signal.throwIfAborted();
      if (viewSignature() !== before) throw new ViewerError('Capture superseded. Please retry.');
      const capture: Capture = {
        signature: before,
        id: crypto.randomUUID(),
        url: URL.createObjectURL(blob),
        blob,
        width: options.width,
        height: options.height,
        options: { ...options },
        panes,
      };
      const previous = useCapture.getState().capture;
      if (previous) URL.revokeObjectURL(previous.url);
      useCapture.setState({ capture, open: true });
      return capture;
    } finally {
      cleanup();
      if (current === local) current = undefined;
    }
  };
  const result = queue.then(run, run);
  queue = result.catch(() => {});
  return result;
}
