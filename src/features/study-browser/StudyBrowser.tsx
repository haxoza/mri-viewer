import { useSession, getSet } from '../../app/store';
import { controllers } from '../../imaging/rendering/controller';
import { removeStudy } from '../import/importer';
import { volumeProblem } from '../../imaging/geometry';
function date(text: string) {
  return /^\d{8}$/.test(text)
    ? `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6)}`
    : 'Unknown date';
}
export function StudyBrowser({ importing }: { importing: boolean }) {
  const studies = useSession((s) => s.studies),
    active = useSession((s) => s.active),
    pane = useSession((s) => s.panes[s.active]);
  const selected = getSet(pane.setId);
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
            <section key={study.uid} className="study">
              <div className="study-title">
                <div>
                  <h3>{study.description}</h3>
                  <small>
                    {date(study.date)} · {study.series.length} series
                  </small>
                </div>
                <button
                  disabled={importing}
                  aria-label={`Remove ${study.description}`}
                  title="Remove examination"
                  onClick={() => void removeStudy(study.uid)}
                >
                  ×
                </button>
              </div>
              {study.series.map((series) => (
                <div key={series.uid} className="series">
                  <div className="series-title">
                    <span className="series-number">{series.number || '–'}</span>
                    <div>
                      <strong>{series.description}</strong>
                      <small>
                        {series.sets.reduce((n, s) => n + s.frames.length, 0)} frames ·{' '}
                        {date(series.date)}
                      </small>
                    </div>
                  </div>
                  {series.sets.map((set, i) => (
                    <button
                      key={set.id}
                      className={`series-set ${pane.setId === set.id ? 'selected' : ''}`}
                      aria-label={`Open ${series.description} ${set.orientation} ${i + 1}`}
                      onClick={() => {
                        void controllers[active].assign(set.id);
                        if (matchMedia('(max-width: 1000px)').matches)
                          useSession.setState({ sidebar: false });
                      }}
                    >
                      <span>
                        {set.orientation}
                        {series.sets.length > 1 ? ` · Stack ${i + 1}` : ''}
                        <small>
                          {set.frames.length} slices
                          {set.frames[0].temporal ? ` · Time ${set.frames[0].temporal}` : ''}
                          {set.frames[0].echo ? ` · Echo ${set.frames[0].echo}` : ''}
                        </small>
                      </span>
                      <span className="arrow">↗</span>
                    </button>
                  ))}
                </div>
              ))}
            </section>
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
