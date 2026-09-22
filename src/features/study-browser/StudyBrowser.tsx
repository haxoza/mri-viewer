import { useId, useState, type ReactNode } from 'react';
import { useSession, getSet } from '../../app/store';
import { controllers } from '../../imaging/rendering/controller';
import { removeStudy } from '../import/importer';
import { volumeProblem } from '../../imaging/geometry';
import type { Series } from '../../imaging/types';
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
    : 'Unknown date';
}
function SequenceTitle({ series }: { series: Series }) {
  return (
    <span className="series-title">
      <span className="series-number">{series.number || '–'}</span>
      <span>
        <strong>{series.description}</strong>
        <small>
          {series.sets.reduce((n, s) => n + s.frames.length, 0)} frames · {date(series.date)}
        </small>
        {series.sets.length === 1 && <small>{series.sets[0].orientation}</small>}
      </span>
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
    if (matchMedia('(max-width: 1000px)').matches) useSession.setState({ sidebar: false });
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
                    {date(study.date)} · {study.series.length} series
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
                    title="Click to open stack"
                    onClick={() => openStack(series.sets[0].id)}
                  >
                    <SequenceTitle series={series} />
                    <span className="arrow" aria-hidden="true">
                      ↗
                    </span>
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
                        title="Click to open stack"
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
                        <span className="arrow" aria-hidden="true">
                          ↗
                        </span>
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
        <span className="eyebrow">SELECTED · PANE {active + 1}</span>
        <strong>{selected?.frames[0].seriesDescription ?? 'No series selected'}</strong>
        {selected && (
          <>
            <small>
              {selected.orientation} · {selected.frames.length} slices ·{' '}
              {selected.frames[0].columns} × {selected.frames[0].rows}
            </small>
            <small>{volumeProblem(selected) ?? 'Geometry eligible for MPR'}</small>
          </>
        )}
      </div>
    </aside>
  );
}
