import { useScreenshot } from '../agent/screenshot';
import { viewLabel } from '../agent/labels';
import { useMarks } from '../annotations/model';
import { viewerActions } from '../../app/actions';
import { useEffect, useRef, useState } from 'react';
import { VolumeViewport, Enums } from '@cornerstonejs/core';
import { useSession, getSet } from '../../app/store';
import {
  controllers,
  crosshairs,
  chooseCrosshair,
  togglePlay,
} from '../../imaging/rendering/controller';
import { WheelSteps } from '../../imaging/tools/navigation';
import { direction } from '../../imaging/geometry';
import { panView, zoomView, windowView } from '../../app/viewActions';
import { AnnotationOverlay } from '../annotations/AnnotationOverlay';
import { NativeOverlay } from './NativeOverlay';
import './viewport.css';
export function Viewport({ index }: { index: number }) {
  const element = useRef<HTMLDivElement>(null);
  const p = useSession((s) => s.panes[index]);
  const active = useSession((s) => s.active === index);
  const set = getSet(p.setId);
  const screenshot = useScreenshot((s) => s.view);
  const marks = useMarks((s) => s.panes[index]);
  const c = controllers[index];
  const [cross, setCross] = useState<number[]>();
  useEffect(() => {
    const el = element.current!;
    void c
      .mount(el)
      .catch(() =>
        useSession
          .getState()
          .patch(index, { error: 'Rendering initialization failed. WebGL 2 is required for MPR.' }),
      );
    const wheel = new WheelSteps();
    const points = new Map<number, { x: number; y: number }>();
    let dy = 0;
    let multi = false;
    const activate = () => viewerActions.setActivePane(index);
    const updateCross = () => {
      const pane = useSession.getState().panes[index],
        point = crosshairs.get(pane.setId!);
      setCross(
        c.viewport instanceof VolumeViewport && point ? c.viewport.worldToCanvas(point) : undefined,
      );
    };
    el.addEventListener(Enums.Events.IMAGE_RENDERED, updateCross);
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      event.preventDefault();
      activate();
      const steps = wheel.consume(
        event.deltaY,
        event.deltaMode,
        useSession.getState().sensitivity,
        event.timeStamp,
      );
      if (steps) void c.navigate(useSession.getState().panes[index].requested + steps);
    };
    const pan = (dx: number, dy: number) => panView(index, dx, dy);
    const zoom = (factor: number) => zoomView(index, (c.viewport?.getZoom() ?? 1) * factor);
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      activate();
      el.focus({ preventScroll: true });
      el.setPointerCapture(e.pointerId);
      points.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (points.size === 1) {
        dy = 0;
        multi = false;
      } else {
        multi = true;
        dy = 0;
      }
      if (points.size === 1 && useSession.getState().tool === 'crosshair') {
        const r = el.getBoundingClientRect();
        chooseCrosshair(index, e.clientX - r.left, e.clientY - r.top);
      }
    };
    const onMove = (e: PointerEvent) => {
      const old = points.get(e.pointerId);
      if (!old) return;
      const before = [...points.values()];
      const dx = e.clientX - old.x,
        deltaY = e.clientY - old.y;
      points.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const after = [...points.values()];
      if (points.size === 2) {
        const distance = (a: typeof before) => Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
        const d = distance(before);
        if (d > 1) zoom(distance(after) / d);
        pan(dx / 2, deltaY / 2);
        return;
      }
      if (multi || points.size !== 1) return;
      const state = useSession.getState(),
        tool = state.tool,
        v = c.viewport;
      if (!v) return;
      if (tool === 'slices') {
        dy -= deltaY;
        const steps = Math.trunc(dy / 12);
        if (steps) {
          dy -= steps * 12;
          void c.navigate(state.panes[index].requested + steps);
        }
      } else if (tool === 'pan') pan(dx, deltaY);
      else if (tool === 'zoom') zoom(Math.exp(-deltaY / 150));
      else if (tool === 'window') {
        const range = v.getProperties()?.voiRange;
        if (range) {
          const width = Math.max(1, range.upper - range.lower + dx * 3),
            center = (range.upper + range.lower) / 2 + deltaY * 3;
          windowView(index, width, center);
        }
      } else {
        const r = el.getBoundingClientRect();
        chooseCrosshair(index, e.clientX - r.left, e.clientY - r.top);
      }
    };
    const onUp = (e: PointerEvent) => {
      points.delete(e.pointerId);
      dy = 0;
      if (!points.size) multi = false;
    };
    const contextLost = (e: Event) => {
      e.preventDefault();
      useSession.getState().patch(index, {
        playing: false,
        error: 'Graphics context lost. Reload the application and reopen the examination.',
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('webglcontextlost', contextLost, true);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener(Enums.Events.IMAGE_RENDERED, updateCross);
      el.removeEventListener('webglcontextlost', contextLost, true);
      c.unmount();
    };
  }, [c, index]);
  const frame = set?.frames[p.mode === 'stack' ? Math.max(0, p.displayed) : 0];
  return (
    <section
      className={`viewport ${active ? 'active' : ''} ${screenshot?.pane === index ? 'screenshot-target' : ''}`}
      inert={screenshot?.pane !== undefined && screenshot.pane !== index}
      aria-label={`Pane ${index + 1}`}
      onPointerDown={() => viewerActions.setActivePane(index)}
    >
      <div
        ref={element}
        className="imaging-canvas"
        tabIndex={0}
        role="application"
        aria-label={`Image pane ${index + 1}. Arrow keys change slice; Space plays cine.`}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget || e.ctrlKey || e.metaKey || e.altKey) return;
          const actions: Record<string, number> = {
            ArrowUp: p.requested - 1,
            ArrowDown: p.requested + 1,
            PageUp: p.requested - 10,
            PageDown: p.requested + 10,
            Home: 0,
            End: p.total - 1,
          };
          if (e.key in actions) {
            e.preventDefault();
            void c.navigate(actions[e.key]);
          } else if (e.key === ' ') {
            e.preventDefault();
            togglePlay(index);
          }
        }}
      />
      {!set && (
        <div className="empty-pane">
          <span className="pane-number">0{index + 1}</span>
          <p>Select a series to view it here</p>
        </div>
      )}
      <div className="pane-top">
        <span className="pane-badge">{index + 1}</span>
        <span className="pane-identity">
          <span className="pane-title">
            {set
              ? screenshot
                ? viewLabel(p.setId)
                : frame?.seriesDescription
              : 'No series selected'}
          </span>
          <small className="pane-description">
            {p.mode === 'stack' ? set?.orientation : `${p.mode} · reconstruction`}
          </small>
        </span>
        {screenshot && set && (
          <span className="screenshot-marks">
            {marks.length} screen {marks.length === 1 ? 'mark' : 'marks'}
          </span>
        )}
        {set && (
          <button
            className={`pane-link ${p.linked ? 'selected' : ''}`}
            aria-label={`Link pane ${index + 1}`}
            aria-pressed={p.linked}
            title={
              p.mode === 'stack'
                ? `${p.linked ? 'Unlink' : 'Link'} slice position with other linked stack panes`
                : 'Link applies to stack slice positions. MPR planes share the crosshair.'
            }
            onClick={() => viewerActions.setLinked(index, !p.linked)}
          >
            Link
            <span className="pane-link-state"> {p.linked ? 'on' : 'off'}</span>
          </button>
        )}
      </div>
      {set && (
        <>
          <span className="orientation top">
            {p.mode === 'stack'
              ? frame?.orientation
                ? direction(frame.orientation.slice(3).map((v) => -v))
                : ''
              : p.mode === 'axial'
                ? 'A'
                : 'S'}
          </span>
          <span className="orientation left">
            {p.mode === 'stack'
              ? frame?.orientation
                ? direction(frame.orientation.slice(0, 3).map((v) => -v))
                : ''
              : p.mode === 'sagittal'
                ? 'A'
                : 'R'}
          </span>
          <div className="pane-bottom">
            <span className="pane-position">
              <span className="pane-position-label">
                {p.mode === 'stack' ? 'Slice' : 'Plane position'}
              </span>{' '}
              {p.displayed < 0 ? '–' : p.displayed + 1} / {p.total || '–'}
              {p.relative !== undefined && Number.isFinite(p.relative) && (
                <small className="pane-detail">
                  Relative {p.relative.toFixed(1)} mm
                  {set.normal && p.mode === 'stack' ? ` · toward ${direction(set.normal)}` : ''}
                  {p.step ? ` · ${p.step.toFixed(2)} mm / step` : ''}
                </small>
              )}
            </span>
            <span className="pane-window">
              W / C {p.window ?? '–'}
              <small className="pane-detail">
                Zoom {p.zoom ? `${Math.round(p.zoom * 100)}%` : '–'}
              </small>
            </span>
          </div>
        </>
      )}
      <AnnotationOverlay index={index} />
      <NativeOverlay index={index} />
      {cross && p.mode !== 'stack' && (
        <svg className="crosshair" aria-hidden="true">
          <path d={`M ${cross[0]} 0 V 10000 M 0 ${cross[1]} H 10000`} />
          <circle cx={cross[0]} cy={cross[1]} r="5" />
        </svg>
      )}
      {(p.pending || p.error || p.linkStatus || set?.warning) && (
        <div className="pane-status" role="status">
          {p.pending
            ? `Loading target ${p.requested + 1}…`
            : screenshot
              ? p.error
                ? 'Rendering failed'
                : p.linkStatus
                  ? 'Link unavailable'
                  : 'Geometry warning'
              : (p.error ?? p.linkStatus ?? set?.warning)}
          {p.error && <button onClick={() => c.retry()}>Retry</button>}
        </div>
      )}
    </section>
  );
}
