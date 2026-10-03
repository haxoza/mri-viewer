import { useId, useMemo, useState, type ReactNode } from 'react';
import { useSession, getSet } from '../../app/store';
import { controllers } from '../../imaging/rendering/controller';
import { removeStudy } from '../import/importer';
import { volumeProblem } from '../../imaging/geometry';
import type { DisplaySet, Series } from '../../imaging/types';
import './study-browser.css';
function Foldable({
  className,
  label,
  title,
  action,
  children,
}: {
  className: string;
  label: string;
  title: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(true);
  const contentId = useId();
  return (
    <section className={className}>
      <div className="foldable-header">
        <button
          className="foldable-toggle"
          aria-label={label}
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={() => setExpanded((value) => !value)}
        >
          <span className="foldable-chevron" aria-hidden="true">
            {expanded ? '▾' : '▸'}
          </span>
          {title}
        </button>
        {action}
      </div>
      <div id={contentId} hidden={!expanded}>
        {children}
      </div>
    </section>
  );
}
function date(text: string) {
  return /^\d{8}$/.test(text)
    ? `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6)}`
    : undefined;
}
function SequenceTitle({ series }: { series: Series }) {
  const seriesDate = date(series.date);
  return (
    <span className="series-title">
      <span className="series-number">{series.number || '–'}</span>
      <span>
        <strong>{series.description}</strong>
        <small>
          {series.sets.reduce((n, s) => n + s.frames.length, 0)} frames
          {seriesDate && ` · ${seriesDate}`}
        </small>
        {series.sets.length === 1 && <small>{series.sets[0].orientation}</small>}
      </span>
    </span>
  );
}
function StackHint({
  set,
  active,
  selected,
}: {
  set: DisplaySet;
  active: number;
  selected: boolean;
}) {
  const problem = useMemo(() => volumeProblem(set), [set]);
  return (
    <span className="series-hint">
      <small className="series-destination">
        {selected ? 'Selected · Pane' : 'Opens in Pane'} {active + 1}
      </small>
      {!problem && (
        <span
          className="series-mpr"
          title="Geometry eligible for MPR. Reconstruction also depends on decoding and available memory."
        >
          MPR eligible
        </span>
      )}
    </span>
  );
}
export function StudyBrowser({ importing }: { importing: boolean }) {
  const studies = useSession((s) => s.studies),
    active = useSession((s) => s.active),
    pane = useSession((s) => s.panes[s.active]);
  const selected = getSet(pane.setId);
  function openStack(id: string) {
    void controllers[active].assign(id);
    if (matchMedia('(max-width: 1100px)').matches) useSession.setState({ sidebar: false });
  }
  return (
    <aside className="study-browser">
      <header>
        <div>
          <span className="eyebrow">LOCAL SESSION</span>
          <h2>
            Examinations <span>{studies.length}</span>
          </h2>
        </div>
        <button
          className="drawer-close"
          aria-label="Close examinations"
          onClick={() => useSession.setState({ sidebar: false })}
        >
          ✕
        </button>
      </header>
      <div className="study-list">
        {!studies.length ? (
          <div className="sidebar-empty">
            <p>Your examinations appear here.</p>
            <small>
              Open a folder, files, or a ZIP archive. All processing stays in this browser.
            </small>
          </div>
        ) : (
          studies.map((study) => (
            <Foldable
              key={study.uid}
              className="study"
              label={`Examination ${study.description}`}
              title={
                <span className="study-title">
                  <strong>{study.description}</strong>
                  <small>
                    {date(study.date) && `${date(study.date)} · `}
                    {study.series.length} series
                  </small>
                </span>
              }
              action={
                <button
                  className="study-remove"
                  disabled={importing}
                  aria-label={`Remove ${study.description}`}
                  title="Remove examination"
                  onClick={() => void removeStudy(study.uid)}
                >
                  ×
                </button>
              }
            >
              {study.series.map((series) =>
                series.sets.length === 1 ? (
                  <button
                    key={series.uid}
                    className={`series series-set single-stack ${pane.setId === series.sets[0].id ? 'selected' : ''}`}
                    aria-label={`Open ${series.description} ${series.sets[0].orientation} 1`}
                    title={`Open stack in Pane ${active + 1}`}
                    aria-pressed={pane.setId === series.sets[0].id}
                    onClick={() => openStack(series.sets[0].id)}
                  >
                    <SequenceTitle series={series} />
                    <StackHint
                      set={series.sets[0]}
                      active={active}
                      selected={pane.setId === series.sets[0].id}
                    />
                  </button>
                ) : (
                  <Foldable
                    key={series.uid}
                    className="series"
                    label={`Sequence ${series.description}`}
                    title={<SequenceTitle series={series} />}
                  >
                    {series.sets.map((set, i) => (
                      <button
                        key={set.id}
                        className={`series-set stack ${pane.setId === set.id ? 'selected' : ''}`}
                        aria-label={`Open ${series.description} ${set.orientation} ${i + 1}`}
                        title={`Open stack in Pane ${active + 1}`}
                        aria-pressed={pane.setId === set.id}
                        onClick={() => openStack(set.id)}
                      >
                        <span>
                          {set.orientation} · Stack {i + 1}
                          <small>
                            {set.frames.length} slices
                            {set.frames[0].temporal ? ` · Time ${set.frames[0].temporal}` : ''}
                            {set.frames[0].echo ? ` · Echo ${set.frames[0].echo}` : ''}
                          </small>
                        </span>
                        <StackHint set={set} active={active} selected={pane.setId === set.id} />
                      </button>
                    ))}
                  </Foldable>
                ),
              )}
            </Foldable>
          ))
        )}
      </div>
      <div className="selected-summary">
        <span className="summary-pane">
          Pane {active + 1} · {selected ? selected.orientation : 'No series selected'}
        </span>
        {selected && (
          <small>
            {selected.frames.length} slices · {selected.frames[0].columns} ×{' '}
            {selected.frames[0].rows}
          </small>
        )}
      </div>
    </aside>
  );
}
