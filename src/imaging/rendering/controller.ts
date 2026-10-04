import { clearMarks } from '../../features/annotations/model';
import {
  RenderingEngine,
  Enums,
  StackViewport,
  VolumeViewport,
  utilities,
  cache,
  type Types,
} from '@cornerstonejs/core';
import { getSet, notify, paneCount, useSession, type Layout } from '../../app/store';
import type { DisplaySet, Plane, Vec3 } from '../types';
import { nearestLinked, dot, mprPlaneOrder } from '../geometry';
import { initialize, loadFrame, retryFrame } from './runtime';
import { volumes } from './volumes';
import { renderAndWait } from './render';
import { clamp, nextCine } from '../tools/navigation';
export type View = StackViewport | VolumeViewport;
interface Saved {
  index: number;
  camera?: Types.ICamera;
  properties?: ReturnType<StackViewport['getProperties']>;
}
let engine: RenderingEngine | undefined;
let resizeFrame: number | undefined;
function scheduleResize() {
  if (resizeFrame !== undefined) return;
  // Cornerstone skips resize camera updates when a render is already queued.
  // Let that render finish before resizing, and coalesce all pane observers.
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = undefined;
    const cameras = controllers.flatMap((controller) => {
      const viewport = controller.viewport;
      const pane = useSession.getState().panes[controller.index];
      return viewport instanceof VolumeViewport &&
        pane.displayed >= 0 &&
        !pane.error &&
        viewport.getDefaultActor()
        ? [{ viewport, camera: viewport.getCamera() }]
        : [];
    });
    // Preserve the camera: it also contains the reconstructed slice position.
    engine?.resize(true, true);
    // Navigation can queue another render after the preceding frame finishes.
    // Refresh the fitted reference even when Cornerstone skips that resize,
    // then restore the exact camera so pixels and slice positions stay fixed.
    for (const { viewport, camera } of cameras) {
      viewport.resetCamera({
        resetRotation: false,
        resetOrientation: false,
        resetAspectRatio: false,
        suppressEvents: true,
      });
      viewport.setCamera(camera);
    }
    engine?.render();
  });
}
export const crosshairs = new Map<string, Vec3>();
const patch = (i: number, p: Parameters<ReturnType<typeof useSession.getState>['patch']>[1]) =>
  useSession.getState().patch(i, p);
export class ViewportController {
  element?: HTMLDivElement;
  viewport?: View;
  generation = 0;
  private busy = false;
  private wanted?: number;
  private currentKey = '';
  private saved = new Map<string, Saved>();
  private observer?: ResizeObserver;
  private abort?: AbortController;
  constructor(readonly index: number) {}
  async mount(element: HTMLDivElement) {
    this.element = element;
    await initialize(useSession.getState().profile);
    if (this.element !== element) return;
    engine ??= new RenderingEngine('local-viewer');
    this.observer = new ResizeObserver(scheduleResize);
    this.observer.observe(element);
    element.addEventListener(Enums.Events.IMAGE_RENDERED, this.onRender);
    const p = useSession.getState().panes[this.index];
    if (p.setId) await this.assign(p.setId, p.mode, true);
  }
  private onRender = () => {
    const v = this.viewport;
    if (!v) return;
    const range = v.getProperties()?.voiRange;
    patch(this.index, {
      window: range
        ? `${Math.round(range.upper - range.lower)} / ${Math.round((range.upper + range.lower) / 2)}`
        : undefined,
      zoom: v.getZoom(),
    });
  };
  private save() {
    const p = useSession.getState().panes[this.index];
    if (this.currentKey && this.viewport)
      this.saved.set(this.currentKey, {
        index: Math.max(p.displayed, 0),
        camera: this.viewport.getCamera(),
        properties: this.viewport.getProperties() ?? undefined,
      });
  }
  unmount() {
    this.save();
    this.generation++;
    this.abort?.abort();
    this.wanted = undefined;
    this.observer?.disconnect();
    if (this.element) this.element.removeEventListener(Enums.Events.IMAGE_RENDERED, this.onRender);
    if (this.viewport) engine?.disableElement(`pane-${this.index}`);
    this.viewport = undefined;
    this.element = undefined;
    volumes.release(this.index);
    patch(this.index, { playing: false, pending: false });
  }
  async assign(setId: string, mode: 'stack' | Plane = 'stack', restore = false) {
    const set = getSet(setId);
    if (!set) return;
    this.save();
    this.abort?.abort();
    this.abort = new AbortController();
    const token = ++this.generation;
    this.wanted = undefined;
    const old = useSession.getState().panes[this.index];
    if (old.setId !== setId || old.mode !== mode) patch(this.index, { playing: false });
    const key = `${setId}/${mode}`,
      saved = this.saved.get(key);
    let target =
      saved?.index ?? (restore ? old.requested : Math.floor((set.frames.length - 1) / 2));
    if (!restore && old.setId && old.setId !== setId) {
      const prior = getSet(old.setId);
      const point = prior?.frames[Math.max(0, old.displayed)]?.position;
      if (point && prior && prior.seriesUID === set.seriesUID && old.mode === 'stack')
        target = nearestLinked(prior, set, point).index ?? target;
    }
    patch(this.index, {
      setId,
      mode,
      requested: target,
      total: mode === 'stack' ? set.frames.length : 0,
      displayed: -1,
      pending: true,
      error: undefined,
      linkStatus: undefined,
      step: undefined,
      relative: undefined,
    });
    if (!this.element) return;
    try {
      await initialize(useSession.getState().profile);
      if (token !== this.generation) return;
      if (this.viewport) {
        engine!.disableElement(`pane-${this.index}`);
        this.viewport = undefined;
      }
      // Keep the shared volume alive while switching between its planes.
      const sameVolume = old.setId === setId && mode !== 'stack';
      if (!sameVolume) volumes.release(this.index);
      let volumeId: string | undefined;
      if (mode !== 'stack') {
        volumeId = await volumes.prepare(
          set,
          useSession.getState().profile,
          this.abort.signal,
          (n) => patch(this.index, { error: undefined, linkStatus: `Preparing MPR ${n}%` }),
        );
        if (token !== this.generation) return;
        volumes.attach(setId, this.index);
      } else await loadFrame(set.frames[target].id);
      if (token !== this.generation) return;
      engine!.enableElement({
        viewportId: `pane-${this.index}`,
        type: mode === 'stack' ? Enums.ViewportType.STACK : Enums.ViewportType.ORTHOGRAPHIC,
        element: this.element!,
        defaultOptions: {
          background: [0, 0, 0],
          ...(mode !== 'stack'
            ? {
                orientation: {
                  axial: Enums.OrientationAxis.AXIAL,
                  sagittal: Enums.OrientationAxis.SAGITTAL,
                  coronal: Enums.OrientationAxis.CORONAL,
                }[mode],
              }
            : {}),
        },
      });
      this.viewport = engine!.getViewport(`pane-${this.index}`) as View;
      this.currentKey = key;
      if (this.viewport instanceof StackViewport)
        await this.viewport.setStack(
          set.frames.map((f) => f.id),
          target,
        );
      else {
        await this.viewport.setVolumes([{ volumeId: volumeId! }]);
        if (!crosshairs.has(setId))
          crosshairs.set(setId, [...this.viewport.getCamera().focalPoint!] as Vec3);
        this.viewport.jumpToWorld(crosshairs.get(setId)!);
        target = this.viewport.getSliceIndex();
        if (saved) await utilities.jumpToSlice(this.element!, { imageIndex: saved.index });
        const f = set.frames[0];
        if (f.windowWidth && f.windowCenter !== undefined)
          this.viewport.setProperties({
            voiRange: {
              lower: f.windowCenter - f.windowWidth / 2,
              upper: f.windowCenter + f.windowWidth / 2,
            },
            invert: f.photometric === 'MONOCHROME1',
          });
      }
      if (token !== this.generation) return;
      if (saved?.camera) this.viewport.setCamera(saved.camera);
      if (saved?.properties) this.viewport.setProperties(saved.properties);
      await renderAndWait(this.viewport, this.abort.signal);
      if (token !== this.generation) return;
      patch(this.index, {
        displayed: target,
        requested: target,
        total: this.viewport.getNumberOfSlices(),
        pending: false,
        linkStatus: undefined,
      });
      this.updatePosition();
      if (useSession.getState().panes[this.index].linked) {
        const leader = controllers.find(
          (c) =>
            c.index !== this.index && useSession.getState().panes[c.index].linked && c.viewport,
        );
        if (leader) sync(leader.index);
      }
    } catch (error) {
      if (token !== this.generation) return;
      patch(this.index, {
        pending: false,
        error:
          error instanceof Error
            ? error.message
            : 'Image could not be loaded. Try another slice or retry.',
      });
    }
  }
  async navigate(index: number, manual = true, linked = false) {
    const p = useSession.getState().panes[this.index];
    if (manual) pause(this.index);
    if (this.abort?.signal.aborted) this.abort = new AbortController();
    if (!this.viewport || !p.total) return;
    index = clamp(index, p.total);
    this.wanted = index;
    patch(this.index, { requested: index, pending: true, error: undefined, linkStatus: undefined });
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.wanted !== undefined) {
        const target: number = this.wanted;
        this.wanted = undefined;
        const token = this.generation;
        const v = this.viewport;
        const state = useSession.getState().panes[this.index];
        const set = getSet(state.setId);
        if (!set || !v) break;
        try {
          if (v instanceof StackViewport) {
            await loadFrame(set.frames[target].id);
            if (token !== this.generation) break;
            if (this.wanted !== undefined) continue;
            await v.setImageIdIndex(target);
          } else await utilities.jumpToSlice(this.element!, { imageIndex: target });
          if (token !== this.generation) break;
          await renderAndWait(v, this.abort?.signal);
          if (token !== this.generation) break;
          patch(this.index, { displayed: target, pending: this.wanted !== undefined });
          this.updatePosition();
          if (v instanceof VolumeViewport) {
            const point = crosshairs.get(set.id) ?? v.getCamera().focalPoint!;
            const camera = v.getCamera();
            const normal = camera.viewPlaneNormal!;
            const delta = dot(camera.focalPoint!, normal) - dot(point, normal);
            crosshairs.set(set.id, point.map((x, k) => x + delta * normal[k]) as Vec3);
            updateCrosshairs(set.id, this.index);
          }
          if (!linked) sync(this.index);
          if (v instanceof StackViewport && this.wanted === undefined) {
            const neighbor = target + (target >= state.displayed ? 1 : -1);
            if (set.frames[neighbor]) void loadFrame(set.frames[neighbor].id).catch(() => {});
          }
        } catch {
          if (token === this.generation)
            patch(this.index, {
              pending: false,
              error: `Could not decode target ${target + 1}. Retry or choose another position.`,
            });
        }
      }
    } finally {
      this.busy = false;
      if (this.wanted !== undefined) void this.navigate(this.wanted, false, linked);
    }
  }
  updatePosition() {
    const v = this.viewport,
      p = useSession.getState().panes[this.index],
      s = getSet(p.setId);
    if (!v || !s) return;
    if (v instanceof VolumeViewport) {
      const volumeId = volumes.volumes.get(s.id)?.id;
      if (!volumeId) return;
      const info = utilities.getVolumeViewportScrollInfo(v, volumeId);
      patch(this.index, {
        displayed: info.currentStepIndex,
        requested: info.currentStepIndex,
        total: info.numScrollSteps + 1,
        step: info.sliceRangeInfo.spacingInNormalDirection,
        relative: info.currentStepIndex * info.sliceRangeInfo.spacingInNormalDirection,
      });
    } else
      patch(this.index, {
        relative: s.geometry ? s.positions[p.displayed] - s.positions[0] : undefined,
      });
  }
  cancelPending() {
    this.generation++;
    this.abort?.abort();
    this.wanted = undefined;
    patch(this.index, {
      pending: false,
      displayed: -1,
      playing: false,
      error: 'View operation cancelled. Retry or choose another position.',
    });
  }
  retry() {
    const p = useSession.getState().panes[this.index],
      s = getSet(p.setId);
    if (s?.frames[p.requested]) retryFrame(s.frames[p.requested].id);
    if (this.viewport) void this.navigate(p.requested);
    else if (p.setId) void this.assign(p.setId, p.mode, true);
  }
  reset(window = true) {
    const v = this.viewport;
    if (!v) return;
    const camera = v.getCamera();
    v.resetCamera({ resetPan: true, resetZoom: true, resetToCenter: false });
    if (v instanceof VolumeViewport) {
      const fresh = v.getCamera();
      const n = fresh.viewPlaneNormal!;
      const distance = dot(camera.focalPoint!, n) - dot(fresh.focalPoint!, n);
      v.setCamera({
        focalPoint: fresh.focalPoint!.map((x, i) => x + n[i] * distance) as Vec3,
        position: fresh.position!.map((x, i) => x + n[i] * distance) as Vec3,
      });
    }
    if (window) v.resetProperties();
    v.render();
  }
  clear() {
    clearMarks(this.index);
    this.generation++;
    this.abort?.abort();
    this.wanted = undefined;
    if (this.viewport) engine?.disableElement(`pane-${this.index}`);
    this.viewport = undefined;
    volumes.release(this.index);
    this.saved.clear();
    patch(this.index, {
      setId: undefined,
      displayed: -1,
      requested: 0,
      total: 0,
      playing: false,
      pending: false,
      error: undefined,
    });
  }
}
export const controllers = Array.from({ length: 4 }, (_, i) => new ViewportController(i));
let playbackEpoch = 0;
export function pause(index?: number) {
  playbackEpoch++;
  const s = useSession.getState();
  s.panes.forEach((p, i) => {
    if (index === undefined || i === index || (s.panes[index].linked && p.linked))
      patch(i, { playing: false });
  });
}
export function sync(source: number) {
  const state = useSession.getState(),
    p = state.panes[source],
    set = getSet(p.setId);
  if (!p.linked || !set || p.mode !== 'stack' || p.displayed < 0) return;
  const point = set.frames[p.displayed]?.position;
  if (!point) return;
  state.panes.forEach((target, i) => {
    if (i === source || !target.linked || !controllers[i].viewport) return;
    const targetSet = getSet(target.setId);
    if (!targetSet) return;
    if (target.mode !== 'stack') {
      patch(i, { linkStatus: 'Use the shared MPR crosshair for reconstructed planes' });
      return;
    }
    const match = nearestLinked(set, targetSet, point);
    patch(i, { linkStatus: match.reason });
    if (match.index !== undefined) void controllers[i].navigate(match.index, false, true);
  });
}
export function updateCrosshairs(setId: string, source?: number) {
  const point = crosshairs.get(setId);
  if (!point) return;
  controllers.forEach((c, i) => {
    const p = useSession.getState().panes[i];
    if (p.setId !== setId || !(c.viewport instanceof VolumeViewport)) return;
    if (i !== source) {
      c.viewport.jumpToWorld(point);
      c.updatePosition();
    }
    c.viewport.render();
  });
}
export function chooseCrosshair(index: number, x: number, y: number) {
  const c = controllers[index],
    p = useSession.getState().panes[index];
  if (!(c.viewport instanceof VolumeViewport) || !p.setId) return;
  pause(index);
  const image = c.viewport.getImageData();
  const point = c.viewport.canvasToWorld([x, y]);
  if (!image?.imageData) return;
  const ijk = utilities.transformWorldToIndexContinuous(image.imageData, point) as Vec3;
  const bounded = ijk.map((n, i) => Math.max(0, Math.min(image.dimensions[i] - 1, n))) as Vec3;
  crosshairs.set(p.setId, utilities.transformIndexToWorld(image.imageData, bounded));
  updateCrosshairs(p.setId);
}
export function changeLayout(layout: Layout) {
  pause();
  useSession.setState((s) => ({ layout, active: Math.min(s.active, paneCount(layout) - 1) }));
}
let mprAbort: AbortController | undefined;
export function cancelMpr() {
  mprAbort?.abort();
}
export async function openMpr(signal?: AbortSignal) {
  const s = useSession.getState(),
    set = getSet(s.panes[s.active].setId);
  if (!set) return;
  pause();
  mprAbort?.abort();
  mprAbort = new AbortController();
  const preparation = mprAbort;
  const cancel = () => preparation.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    notify('Preparing shared MPR volume…');
    await volumes.prepare(set, s.profile, preparation.signal, (n) =>
      notify(`Preparing shared MPR volume: ${n}%`),
    );
    preparation.signal.throwIfAborted();
    signal?.throwIfAborted();
    // Reserve all references before assigning, so replacing an existing pane cannot evict it.
    [0, 1, 2].forEach((i) => volumes.attach(set.id, i));
    changeLayout('left-3');
    useSession.setState({ active: 0 });
    for (const [i, mode] of mprPlaneOrder(set.normal!).entries()) {
      preparation.signal.throwIfAborted();
      signal?.throwIfAborted();
      await controllers[i].assign(set.id, mode);
    }
    if ([0, 1, 2].some((i) => useSession.getState().panes[i].error))
      throw new Error('A reconstructed pane could not initialize. Retry it or return to Stack.');
    notify('MPR ready. Reconstructed detail follows the original acquisition resolution.');
  } catch (error) {
    notify(error instanceof Error ? error.message : 'MPR preparation failed.');
    if (signal) throw error;
  } finally {
    signal?.removeEventListener('abort', cancel);
    // Cancellation can leave reservations for planes that were never assigned.
    // Only prune this preparation's reservations, not a newer MPR operation's.
    if (mprAbort === preparation) {
      const volume = volumes.volumes.get(set.id);
      if (volume) {
        for (const index of volume.refs) {
          const pane = useSession.getState().panes[index];
          if (
            pane.setId !== set.id ||
            pane.mode === 'stack' ||
            !(controllers[index].viewport instanceof VolumeViewport)
          )
            volume.refs.delete(index);
        }
        if (!volume.refs.size) volumes.remove(set.id);
      }
    }
  }
}
const clocks = new Map<number, { last: number; frames: number; start: number }>();
setInterval(() => {
  const state = useSession.getState();
  const now = performance.now();
  state.panes.forEach((p, i) => {
    if (!p.playing || document.hidden || !controllers[i].viewport) {
      clocks.delete(i);
      return;
    }
    if (p.linked && state.panes.some((q, j) => j < i && q.playing && q.linked)) return;
    let clock = clocks.get(i);
    if (!clock) {
      clock = { last: now, frames: 0, start: now };
      clocks.set(i, clock);
    }
    const set = getSet(p.setId);
    const timing = set?.frames[p.displayed]?.frameTime;
    const interval = timing ? timing * (12 / p.fps) : 1000 / p.fps;
    if (
      now - clock.last < interval ||
      p.pending ||
      (p.linked && state.panes.some((q) => q.linked && q.pending))
    )
      return;
    clock.last = now;
    if (p.temporal && set) {
      const siblings = getSetSiblings(set);
      const at = siblings.findIndex((x) => x.id === set.id);
      const next = nextCine(at, siblings.length, p.reverse, p.loop, p.bounce);
      patch(i, { reverse: next.reverse });
      if (next.stop) {
        pause(i);
        return;
      }
      const epoch = playbackEpoch;
      void controllers[i].assign(siblings[next.index].id).then(() => {
        if (epoch === playbackEpoch && !useSession.getState().panes[i].error)
          patch(i, { playing: true });
      });
    } else {
      const next = nextCine(p.displayed, p.total, p.reverse, p.loop, p.bounce);
      patch(i, { reverse: next.reverse });
      if (next.stop) {
        pause(i);
        return;
      }
      void controllers[i].navigate(next.index, false);
    }
    clock.frames++;
    if (now - clock.start > 1000) {
      patch(i, { achieved: (clock.frames * 1000) / (now - clock.start) });
      clock.frames = 0;
      clock.start = now;
    }
  });
}, 16);
export function getSetSiblings(set: DisplaySet) {
  return (
    useSession
      .getState()
      .studies.flatMap((s) => s.series)
      .find((s) => s.uid === set.seriesUID)
      ?.sets.filter(
        (s) =>
          s.orientation === set.orientation &&
          s.frames[0].echo === set.frames[0].echo &&
          s.frames[0].diffusion === set.frames[0].diffusion,
      )
      .sort((a, b) => Number(a.frames[0].temporal) - Number(b.frames[0].temporal)) ?? [set]
  );
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pause();
});
export function togglePlay(index: number) {
  const p = useSession.getState().panes[index];
  if (p.playing) {
    pause(index);
    return;
  }
  pause();
  patch(index, { playing: true });
}
export function changeProfile(profile: 'standard' | 'low') {
  pause();
  for (const c of controllers) c.clear();
  cache.purgeCache();
  useSession.setState({ profile });
  void initialize(profile);
  cache.setMaxCacheSize(profile === 'low' ? 128 * 1024 ** 2 : 256 * 1024 ** 2);
  notify('Memory profile changed. Select a series to continue.');
}
