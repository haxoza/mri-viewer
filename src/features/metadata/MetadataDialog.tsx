import { useEffect, useState } from 'react';
import { Dialog } from '../../app/Dialog';
import { getSet, useSession } from '../../app/store';
import { sources } from '../../imaging/sources/registry';
import type { TagRow } from '../../imaging/types';
export function MetadataDialog({ onClose }: { onClose: () => void }) {
  const state = useSession.getState(),
    pane = state.panes[state.active],
    set = getSet(pane.setId)!;
  const [index, setIndex] = useState(
    pane.mode === 'stack' ? Math.max(0, Math.min(pane.displayed, set.frames.length - 1)) : 0,
  );
  const [rows, setRows] = useState<TagRow[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [scroll, setScroll] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const frame = set.frames[index];
  const seriesFrames = state.studies
    .flatMap((s) => s.series)
    .find((s) => s.uid === set.seriesUID)!
    .sets.flatMap((s) => s.frames);
  const summaryKeys = [
    'seriesDescription',
    'rows',
    'columns',
    'photometric',
    'syntax',
    'echo',
    'windowCenter',
    'windowWidth',
  ] as const;
  useEffect(() => {
    let live = true;
    // Synchronize the loading indicator with a new worker metadata request.
    // oxlint-disable-next-line react/set-state-in-effect
    setLoading(true);
    setError('');
    sources.tags(frame.sourceId).then(
      (rows) => {
        if (live) {
          setRows(rows);
          setLoading(false);
        }
      },
      () => {
        if (live) {
          setError('Could not read instance metadata.');
          setLoading(false);
        }
      },
    );
    return () => {
      live = false;
    };
  }, [frame.sourceId]);
  const term = search.toLowerCase();
  const visible = rows.filter((r) =>
    term
      ? [r.tag, r.name, r.value, r.vr].some((v) => v.toLowerCase().includes(term))
      : r.depth === 0 ||
        [...r.path.matchAll(/\[\d+\]/g)].every((match) =>
          expanded.has(r.path.slice(0, match.index)),
        ),
  );
  const start = Math.max(0, Math.floor(scroll / 48) - 5);
  const slice = visible.slice(start, start + 24);
  return (
    <Dialog title="DICOM metadata" onClose={onClose} wide>
      <p className="muted">
        Values belong to this source instance and may vary across the series. Reconstructions do not
        create new DICOM instances.
      </p>
      <details className="metadata-summary">
        <summary>Common and varying series values</summary>
        <dl>
          {summaryKeys.map((key) => {
            const values = new Set(seriesFrames.map((f) => f[key]));
            return (
              <div key={key}>
                <dt>{key}</dt>
                <dd>
                  {values.size === 1
                    ? `Common: ${frame[key] ?? 'Unknown'}`
                    : `Varies across instances / frames (${values.size} values)`}
                </dd>
              </div>
            );
          })}
        </dl>
      </details>
      <div className="form-row">
        <label>
          Source instance / frame
          <select value={index} onChange={(e) => setIndex(Number(e.target.value))}>
            {set.frames.map((f, i) => (
              <option key={f.id} value={i}>
                Slice {i + 1} · instance {f.instance} · frame {f.frame + 1}
              </option>
            ))}
          </select>
        </label>
        <label className="grow">
          Search tags
          <input
            aria-label="Search tags"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setScroll(0);
            }}
            placeholder="Tag, name, VR, or value"
          />
        </label>
      </div>
      <p className="muted">
        Series: {frame.seriesDescription} · {frame.rows} × {frame.columns} · {frame.photometric}
      </p>
      {error && <p role="alert">{error}</p>}
      {loading ? (
        <p>Reading metadata…</p>
      ) : (
        <>
          <div className="tag-head">
            <span>Tag / name</span>
            <span>VR</span>
            <span>Value</span>
          </div>
          <div className="tag-scroll" onScroll={(e) => setScroll(e.currentTarget.scrollTop)}>
            <div style={{ height: visible.length * 48, position: 'relative' }}>
              {slice.map((r, i) => (
                <div
                  className="tag-row"
                  key={r.path}
                  style={{ top: (start + i) * 48, paddingLeft: 12 + Math.min(r.depth, 5) * 12 }}
                >
                  <span title={`${r.tag} ${r.name}`}>
                    {r.value.includes('sequence item') ? (
                      <button
                        className="sequence-toggle"
                        onClick={() =>
                          setExpanded((old) => {
                            const next = new Set(old);
                            if (next.has(r.path)) next.delete(r.path);
                            else next.add(r.path);
                            return next;
                          })
                        }
                      >
                        {expanded.has(r.path) ? '▾' : '▸'} {r.name}
                      </button>
                    ) : (
                      r.name
                    )}
                    <small>{r.tag}</small>
                  </span>
                  <code>{r.vr}</code>
                  <span title={r.value}>{r.value}</span>
                </div>
              ))}
            </div>
          </div>
          <p className="muted">
            {visible.length} tags shown · Binary values are summarized. Expand functional groups to
            inspect shared and per-frame values.
          </p>
        </>
      )}
    </Dialog>
  );
}
