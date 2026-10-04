import { viewerActions } from '../../app/actions';
import { ActionMenu } from '../../app/ActionMenu';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Plane } from '../../imaging/types';
import { getSet, paneCount, useSession, type Layout, type Tool } from '../../app/store';
import { getSetSiblings, togglePlay, setNativeLinks } from '../../imaging/rendering/controller';
import { editMarks, useMarks, type MarkColor } from '../annotations/model';
import { parseIndex } from '../../imaging/tools/navigation';
import { volumeProblem } from '../../imaging/geometry';
import { usePopoverPosition } from '../../app/usePopoverPosition';
import './toolbar.css';

function ToolbarPopover({
  label,
  name,
  disabled = false,
  className = '',
  children,
}: {
  label: ReactNode;
  name: string;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const root = useRef<HTMLDetailsElement>(null);
  const position = usePopoverPosition(root, '.toolbar-popover-content');
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) root.current.open = false;
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, []);
  return (
    <details
      ref={root}
      className={`toolbar-popover ${className}`}
      onToggle={position}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && event.currentTarget.open) {
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.open = false;
          event.currentTarget.querySelector('summary')?.focus();
        }
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node))
          event.currentTarget.open = false;
      }}
    >
      <summary
        aria-label={name}
        aria-disabled={disabled || undefined}
        onClick={(event) => {
          if (disabled) event.preventDefault();
        }}
      >
        {label}
      </summary>
      <fieldset className="popover toolbar-popover-content" disabled={disabled}>
        {children}
      </fieldset>
    </details>
  );
}
export function Toolbar({
  onMetadata,
  onExport,
  onScreenshot,
}: {
  onMetadata: () => void;
  onExport: () => void;
  onScreenshot: (scope: 'active' | 'workspace') => void;
}) {
  const active = useSession((s) => s.active),
    p = useSession((s) => s.panes[s.active]),
    tool = useSession((s) => s.tool),
    layout = useSession((s) => s.layout);
  const nativeLinks = useSession((s) => s.nativeLinks);
  const color = useMarks((s) => s.color);
  const hasMarks = useMarks((s) => s.panes[active].length > 0);
  const canUndoMarks = useMarks((s) => s.history[active].length > 0);
  const hasWorkspaceImage = useSession((s) =>
    s.panes.slice(0, paneCount(s.layout)).some((pane) => pane.setId && pane.displayed >= 0),
  );
  const set = getSet(p.setId);
  const hasImage = !!set && p.displayed >= 0;
  const mprProblem = useMemo(() => (set ? volumeProblem(set) : undefined), [set]);
  const mprDisabledReason = !hasImage
    ? 'Select a series to prepare MPR views.'
    : p.pending
      ? 'Wait for the active image to finish loading.'
      : mprProblem;
  const crosshairDisabledReason = !hasImage
    ? 'Select a series to use the crosshair.'
    : p.mode === 'stack' && !(nativeLinks && p.linked)
      ? 'Enable Native links and link this pane, or use MPR.'
      : undefined;
  const [input, setInput] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  useEffect(() => {
    // The input follows settled renderer state, independently of its editable draft.
    // oxlint-disable-next-line react/set-state-in-effect
    setInput(p.displayed < 0 ? '' : String(p.displayed + 1));
    setInvalid(false);
    const timer = setTimeout(
      () =>
        setAnnouncement(
          `${p.mode === 'stack' ? 'Slice' : 'Plane position'} ${p.displayed + 1} of ${p.total}`,
        ),
      250,
    );
    return () => clearTimeout(timer);
  }, [p.displayed, p.total, p.mode]);
  const submit = () => {
    const index = parseIndex(input, p.total);
    setInvalid(index === undefined);
    if (index !== undefined) void viewerActions.setSlice(active, index);
  };
  const siblings = set ? getSetSiblings(set) : [];
  return (
    <>
      <div className="tools viewer-toolbar" aria-label="Viewing controls">
        <div className="tool-group viewer-tool-segments" role="group" aria-label="Image tools">
          {(['slices', 'pan', 'zoom', 'window', 'crosshair', 'ellipse'] as Tool[]).map((t) => (
            <button
              key={t}
              disabled={!hasImage || (t === 'crosshair' && !!crosshairDisabledReason)}
              title={t === 'crosshair' ? crosshairDisabledReason : undefined}
              className={tool === t ? 'selected' : ''}
              aria-pressed={tool === t}
              onClick={() => useSession.setState({ tool: t })}
            >
              {
                {
                  slices: 'Slices',
                  pan: 'Pan',
                  zoom: 'Zoom',
                  window: 'Window',
                  crosshair: 'Crosshair',
                  ellipse: 'Ellipse',
                }[t]
              }
            </button>
          ))}
        </div>
        <div className="tool-group toolbar-reset" role="group" aria-label="Image framing">
          <button
            disabled={!hasImage || p.pending}
            onClick={() => viewerActions.reset(active, false)}
          >
            Fit
          </button>
          <button disabled={!hasImage || p.pending} onClick={() => viewerActions.reset(active)}>
            Reset
          </button>
        </div>
        <div className="tool-group toolbar-views" role="group" aria-label="Layout and view">
          <label className="inline-label toolbar-layout">
            Layout
            <select
              aria-label="Layout"
              value={layout}
              onChange={(e) => viewerActions.setLayout(e.target.value as Layout)}
            >
              <option value="single">1 · Single</option>
              <option value="columns-2">2 · Side by side</option>
              <option value="rows-2">2 · Stacked</option>
              <option value="left-3">3 · Large left</option>
              <option value="top-3">3 · Large top</option>
              <option value="grid-4">4 · Grid</option>
              <option value="columns-4">4 · Columns</option>
              <option value="rows-4">4 · Rows</option>
            </select>
          </label>
          <button
            disabled={!!mprDisabledReason}
            title={mprDisabledReason ?? 'Open three shared MPR views'}
            aria-pressed={hasImage && p.mode !== 'stack'}
            onClick={() => void viewerActions.openMpr()}
          >
            MPR
          </button>
          <button
            aria-pressed={nativeLinks}
            onClick={() => setNativeLinks(!nativeLinks)}
            title="Experimental patient-space linking of acquired stacks; use each pane's Link button"
          >
            Native links
          </button>
          <label className="inline-label toolbar-view">
            View
            <select
              aria-label="Viewport mode"
              value={p.mode}
              disabled={!set || p.pending}
              onChange={(e) =>
                void viewerActions.assignView(active, p.setId!, e.target.value as 'stack' | Plane)
              }
            >
              <option value="stack">Acquired stack</option>
              <option value="axial" disabled={!!mprProblem} title={mprProblem}>
                Axial MPR
              </option>
              <option value="sagittal" disabled={!!mprProblem} title={mprProblem}>
                Sagittal MPR
              </option>
              <option value="coronal" disabled={!!mprProblem} title={mprProblem}>
                Coronal MPR
              </option>
            </select>
          </label>
        </div>
        <div className="tool-group toolbar-marks">
          <ToolbarPopover
            name="Marks"
            disabled={!hasImage}
            label={
              <>
                <span className={`mark-swatch mark-swatch-${color}`} aria-hidden="true" />
                Marks
                <span className="mark-color-name">{color}</span>
              </>
            }
          >
            <label className="inline-label">
              Mark color
              <select
                aria-label="Mark color"
                value={color}
                onChange={(e) => useMarks.setState({ color: e.target.value as MarkColor })}
              >
                <option value="red">Red</option>
                <option value="yellow">Yellow</option>
                <option value="cyan">Cyan</option>
              </select>
            </label>
            <button
              disabled={!hasImage || !canUndoMarks}
              onClick={() => editMarks(active, { action: 'undo' })}
            >
              Undo mark
            </button>
            <button
              disabled={!hasImage || !hasMarks}
              onClick={() => editMarks(active, { action: 'clear' })}
            >
              Clear marks
            </button>
            <small>
              Screen marks stay fixed through navigation; no anatomical tracking or measurements.
            </small>
          </ToolbarPopover>
        </div>
        <fieldset
          className="tool-group trailing toolbar-captures"
          disabled={!hasWorkspaceImage}
          aria-label="Capture and information"
        >
          <ActionMenu label="Screenshot view">
            {(close) => (
              <>
                <button
                  role="menuitem"
                  disabled={!set || p.pending || p.displayed < 0}
                  onClick={() => {
                    close();
                    onScreenshot('active');
                  }}
                >
                  Active pane
                </button>
                <button
                  role="menuitem"
                  disabled={!hasWorkspaceImage}
                  onClick={() => {
                    close();
                    onScreenshot('workspace');
                  }}
                >
                  Whole workspace
                </button>
              </>
            )}
          </ActionMenu>
          <button disabled={!set || p.displayed < 0} onClick={onMetadata}>
            Metadata
          </button>
          <button disabled={!set || p.pending || p.displayed < 0} onClick={onExport}>
            Export
          </button>
        </fieldset>
      </div>
      {nativeLinks && (
        <div className="native-link-notice">
          Native links · experiment. Link each stack, then click with Crosshair. Scrolling moves the
          shared point onto the selected slice. Unlink for independent navigation. Coordinates do
          not verify anatomical alignment after motion. No registration or fusion; not for
          diagnosis.
        </div>
      )}
      <div className="navigation viewer-navigation" aria-label="Slice navigation and cine">
        <span className="active-caption">
          Pane {active + 1} · {p.mode === 'stack' ? 'Slice' : 'Plane position'}
        </span>
        <button
          aria-label="First slice"
          disabled={!hasImage || !p.total || p.requested === 0}
          onClick={() => void viewerActions.setSlice(active, 0)}
        >
          Ⅰ‹
        </button>
        <button
          aria-label="Previous slice"
          disabled={!hasImage || !p.total || p.requested === 0}
          onClick={() => void viewerActions.setSlice(active, p.requested - 1)}
        >
          ‹
        </button>
        <input
          className="slice-slider"
          aria-label={p.mode === 'stack' ? 'Slice position' : 'Plane position'}
          type="range"
          min="0"
          max={Math.max(0, p.total - 1)}
          value={p.requested}
          disabled={!hasImage || p.total < 2}
          onChange={(e) => void viewerActions.setSlice(active, Number(e.target.value))}
        />
        <div className="index-input">
          <input
            aria-label="Slice number"
            aria-invalid={invalid}
            inputMode="numeric"
            value={input}
            disabled={!hasImage || !p.total}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
              if (e.key === 'Escape') {
                setInput(String(p.displayed + 1));
                setInvalid(false);
              }
            }}
            onBlur={() => {
              if (input !== String(p.displayed + 1)) submit();
            }}
          />
          <span>/ {p.total || '–'}</span>
          {invalid && <small role="alert">Enter 1–{p.total}</small>}
        </div>
        <button
          aria-label="Next slice"
          disabled={!hasImage || !p.total || p.requested >= p.total - 1}
          onClick={() => void viewerActions.setSlice(active, p.requested + 1)}
        >
          ›
        </button>
        <button
          aria-label="Last slice"
          disabled={!hasImage || !p.total || p.requested >= p.total - 1}
          onClick={() => void viewerActions.setSlice(active, p.total - 1)}
        >
          ›Ⅰ
        </button>
        <div className="cine-controls">
          <button
            aria-label={p.playing ? 'Pause cine' : 'Play cine'}
            disabled={!hasImage || p.total < 2}
            className={p.playing ? 'selected' : ''}
            aria-pressed={p.playing}
            onClick={() => togglePlay(active)}
          >
            {p.playing ? 'Ⅱ' : '▶'}
          </button>
          <ToolbarPopover label="Playback options" name="Playback options" disabled={!hasImage}>
            <label className="inline-label">
              <input
                aria-label="Cine frames per second"
                type="number"
                min="1"
                max="60"
                value={p.fps}
                onChange={(e) =>
                  useSession
                    .getState()
                    .patch(active, { fps: Math.max(1, Math.min(60, Number(e.target.value))) })
                }
              />
              fps
            </label>
            {(['reverse', 'loop', 'bounce'] as const).map((key) => (
              <label className="check" key={key}>
                <input
                  type="checkbox"
                  checked={p[key]}
                  onChange={(e) => useSession.getState().patch(active, { [key]: e.target.checked })}
                />
                {key}
              </label>
            ))}
            <label className="check">
              <input
                type="checkbox"
                disabled={!hasImage || siblings.length < 2 || p.mode !== 'stack'}
                checked={p.temporal}
                onChange={(e) =>
                  useSession.getState().patch(active, { temporal: e.target.checked })
                }
              />
              Time playback at fixed position
            </label>
            <small>Achieved {p.achieved.toFixed(1)} fps</small>
            <label>
              Scroll sensitivity
              <input
                aria-label="Scroll sensitivity"
                type="range"
                min="20"
                max="140"
                defaultValue={useSession.getState().sensitivity}
                onChange={(e) => useSession.setState({ sensitivity: Number(e.target.value) })}
              />
            </label>
          </ToolbarPopover>
        </div>
        {siblings.length > 1 && (
          <label className="inline-label">
            Time
            <select
              disabled={!hasImage || p.pending}
              value={p.setId}
              onChange={(e) => void viewerActions.assignView(active, e.target.value)}
            >
              {siblings.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.frames[0].temporal || 'Unknown'}
                </option>
              ))}
            </select>
          </label>
        )}
        <span className="sr-only" aria-live="polite">
          {announcement}
        </span>
      </div>
    </>
  );
}
