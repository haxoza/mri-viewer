import { useEffect, useState } from 'react';
import type { Plane } from '../../imaging/types';
import { getSet, useSession, type Layout, type Tool } from '../../app/store';
import {
  changeLayout,
  controllers,
  getSetSiblings,
  openMpr,
  togglePlay,
} from '../../imaging/rendering/controller';
import { parseIndex } from '../../imaging/tools/navigation';
export function Toolbar({
  onMetadata,
  onExport,
}: {
  onMetadata: () => void;
  onExport: () => void;
}) {
  const active = useSession((s) => s.active),
    p = useSession((s) => s.panes[s.active]),
    tool = useSession((s) => s.tool),
    layout = useSession((s) => s.layout);
  const c = controllers[active],
    set = getSet(p.setId);
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
    if (index !== undefined) void c.navigate(index);
  };
  const siblings = set ? getSetSiblings(set) : [];
  return (
    <>
      <div className="tools">
        <div className="tool-group">
          {(['slices', 'pan', 'zoom', 'window', 'crosshair'] as Tool[]).map((t) => (
            <button
              key={t}
              disabled={t === 'crosshair' && p.mode === 'stack'}
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
                }[t]
              }
            </button>
          ))}
        </div>
        <div className="tool-group">
          <button disabled={!set || p.pending} onClick={() => c.reset(false)}>
            Fit
          </button>
          <button disabled={!set || p.pending} onClick={() => c.reset()}>
            Reset
          </button>
        </div>
        <div className="tool-group">
          <label className="inline-label">
            Layout
            <select
              aria-label="Layout"
              value={layout}
              onChange={(e) => changeLayout(e.target.value as Layout)}
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
          <button disabled={!set || p.pending} onClick={() => void openMpr()}>
            MPR
          </button>
          {set && (
            <select
              aria-label="Viewport mode"
              value={p.mode}
              disabled={p.pending}
              onChange={(e) => void c.assign(p.setId!, e.target.value as 'stack' | Plane)}
            >
              <option value="stack">Acquired stack</option>
              <option value="axial">Axial MPR</option>
              <option value="sagittal">Sagittal MPR</option>
              <option value="coronal">Coronal MPR</option>
            </select>
          )}
        </div>
        <div className="tool-group trailing">
          <button disabled={!set || p.displayed < 0} onClick={onMetadata}>
            Metadata
          </button>
          <button disabled={!set || p.pending || p.displayed < 0} onClick={onExport}>
            Export
          </button>
        </div>
      </div>
      <div className="navigation">
        <span className="active-caption">
          PANE {active + 1}
          <small>{p.mode === 'stack' ? 'Slice' : 'Plane position'}</small>
        </span>
        <button
          aria-label="First slice"
          disabled={!p.total || p.requested === 0}
          onClick={() => void c.navigate(0)}
        >
          Ⅰ‹
        </button>
        <button
          aria-label="Previous slice"
          disabled={!p.total || p.requested === 0}
          onClick={() => void c.navigate(p.requested - 1)}
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
          disabled={p.total < 2}
          onChange={(e) => void c.navigate(Number(e.target.value))}
        />
        <div className="index-input">
          <input
            aria-label="Slice number"
            aria-invalid={invalid}
            inputMode="numeric"
            value={input}
            disabled={!p.total}
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
          disabled={!p.total || p.requested >= p.total - 1}
          onClick={() => void c.navigate(p.requested + 1)}
        >
          ›
        </button>
        <button
          aria-label="Last slice"
          disabled={!p.total || p.requested >= p.total - 1}
          onClick={() => void c.navigate(p.total - 1)}
        >
          ›Ⅰ
        </button>
        <div className="cine-controls">
          <button
            aria-label={p.playing ? 'Pause cine' : 'Play cine'}
            disabled={!set || p.total < 2}
            className={p.playing ? 'selected' : ''}
            onClick={() => togglePlay(active)}
          >
            {p.playing ? 'Ⅱ' : '▶'}
          </button>
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
          <details>
            <summary aria-label="Playback options">Playback</summary>
            <div className="popover">
              {(['reverse', 'loop', 'bounce'] as const).map((key) => (
                <label className="check" key={key}>
                  <input
                    type="checkbox"
                    checked={p[key]}
                    onChange={(e) =>
                      useSession.getState().patch(active, { [key]: e.target.checked })
                    }
                  />
                  {key}
                </label>
              ))}
              <label className="check">
                <input
                  type="checkbox"
                  disabled={siblings.length < 2 || p.mode !== 'stack'}
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
            </div>
          </details>
        </div>
        {siblings.length > 1 && (
          <label className="inline-label">
            Time
            <select value={p.setId} onChange={(e) => void c.assign(e.target.value)}>
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
