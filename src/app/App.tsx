import { useRef, useState, type CSSProperties } from 'react';
import { paneCount, useSession } from './store';
import { importFiles, droppedFiles, type ImportProgress } from '../features/import/importer';
import { StudyBrowser } from '../features/study-browser/StudyBrowser';
import { Toolbar } from '../features/viewer/Toolbar';
import { Viewport } from '../features/viewer/Viewport';
import { MetadataDialog } from '../features/metadata/MetadataDialog';
import { ExportDialog } from '../features/export/ExportDialog';
import { cancelMpr, changeProfile, pause } from '../imaging/rendering/controller';
export default function App() {
  const layout = useSession((s) => s.layout),
    sidebar = useSession((s) => s.sidebar),
    profile = useSession((s) => s.profile),
    notice = useSession((s) => s.notice),
    hasStudies = useSession((s) => s.studies.length > 0);
  const [progress, setProgress] = useState<ImportProgress>();
  const [dialog, setDialog] = useState<'metadata' | 'export'>();
  const [exportWorkspace, setExportWorkspace] = useState<HTMLElement>();
  const [drop, setDrop] = useState(false);
  const [split, setSplit] = useState(60);
  const files = useRef<HTMLInputElement>(null),
    folder = useRef<HTMLInputElement>(null),
    zip = useRef<HTMLInputElement>(null),
    workspace = useRef<HTMLDivElement>(null),
    abort = useRef<AbortController | undefined>(undefined);
  const importing = !!progress && !progress.finished;
  const start = (files: File[]) => {
    if (importing || !files.length) return;
    abort.current = new AbortController();
    void importFiles(files, abort.current.signal, setProgress);
  };
  return (
    <div
      className="app"
      onDragOver={(e) => {
        e.preventDefault();
        if (!importing) setDrop(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrop(false);
      }}
      onDrop={async (e) => {
        e.preventDefault();
        setDrop(false);
        if (!importing) {
          try {
            start(await droppedFiles(e.dataTransfer.items));
          } catch {
            useSession.setState({
              notice: 'Could not read the dropped directory. Use Open folder instead.',
            });
          }
        }
      }}
    >
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark">◉</span>
          <div>
            Local MRI <span>VIEWER</span>
          </div>
          <span className="local-badge">
            <i />
            On this device
          </span>
        </div>
        <div className="import-actions">
          <button disabled={importing} onClick={() => folder.current?.click()}>
            Open folder
          </button>
          <button disabled={importing} onClick={() => files.current?.click()}>
            Open files
          </button>
          <button disabled={importing} onClick={() => zip.current?.click()}>
            Open ZIP
          </button>
        </div>
        <div className="header-end">
          <select
            aria-label="Memory profile"
            value={profile}
            onChange={(e) => changeProfile(e.target.value as 'standard' | 'low')}
          >
            <option value="standard">Standard memory</option>
            <option value="low">Low memory</option>
          </select>
          <button
            aria-label="Toggle examinations"
            aria-expanded={sidebar}
            onClick={() => useSession.setState({ sidebar: !sidebar })}
          >
            Examinations
          </button>
        </div>
      </header>
      <input
        ref={files}
        className="file-input"
        aria-label="Open DICOM files"
        type="file"
        multiple
        onChange={(e) => {
          start(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />
      <input
        ref={folder}
        className="file-input"
        aria-label="Open DICOM folder"
        type="file"
        multiple
        {...{ webkitdirectory: '' }}
        onChange={(e) => {
          start(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />
      <input
        ref={zip}
        className="file-input"
        aria-label="Open DICOM ZIP"
        type="file"
        accept=".zip"
        multiple
        onChange={(e) => {
          start(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />
      <Toolbar
        onMetadata={() => {
          pause();
          setDialog('metadata');
        }}
        onExport={() => {
          pause();
          setExportWorkspace(workspace.current ?? undefined);
          setDialog('export');
        }}
      />
      {progress && (
        <div className="import-status" role="status">
          <span>
            {progress.finished
              ? `${progress.accepted} frames imported${progress.cancelled ? ' · cancelled, partial results retained' : ''}`
              : `Indexing ${progress.done} / ${progress.total} files…`}
          </span>
          <progress max={Math.max(1, progress.total)} value={progress.done} />
          {progress.duplicates > 0 && <span>{progress.duplicates} duplicates skipped</span>}
          {progress.issues.length > 0 && (
            <details>
              <summary>{progress.issues.length} import issues</summary>
              <div className="popover import-issues">
                {progress.issues.map((issue, i) => (
                  <p key={i}>{issue}</p>
                ))}
              </div>
            </details>
          )}
          {!progress.finished ? (
            <button onClick={() => abort.current?.abort()}>Cancel import</button>
          ) : (
            <button aria-label="Dismiss import status" onClick={() => setProgress(undefined)}>
              ✕
            </button>
          )}
        </div>
      )}
      {notice && (
        <div className="notice" role="status">
          <span>{notice}</span>
          {notice.startsWith('Preparing') && (
            <button
              onClick={() => {
                cancelMpr();
                useSession.setState({
                  notice: 'MPR preparation cancelled. Stack viewing remains available.',
                });
              }}
            >
              Cancel MPR
            </button>
          )}
          <button
            aria-label="Dismiss notice"
            onClick={() => useSession.setState({ notice: undefined })}
          >
            ✕
          </button>
        </div>
      )}
      <main className={sidebar ? 'with-sidebar' : ''}>
        <div
          ref={workspace}
          className={`workspace layout-${layout}`}
          style={{ '--split': `${split}%`, '--rest': `${100 - split}%` } as CSSProperties}
        >
          {Array.from({ length: paneCount(layout) }, (_, i) => (
            <Viewport key={i} index={i} />
          ))}
          {(layout === 'left-3' ||
            layout === 'top-3' ||
            layout === 'columns-2' ||
            layout === 'rows-2' ||
            layout === 'grid-4') && (
            <div
              className={`splitter ${layout === 'top-3' || layout === 'rows-2' ? 'horizontal' : ''}`}
              role="separator"
              aria-label="Resize viewports"
              aria-valuemin={25}
              aria-valuemax={75}
              aria-valuenow={split}
              tabIndex={0}
              onKeyDown={(e) => {
                if (['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'].includes(e.key)) {
                  e.preventDefault();
                  setSplit((s) =>
                    Math.max(
                      25,
                      Math.min(75, s + (['ArrowLeft', 'ArrowUp'].includes(e.key) ? -2 : 2)),
                    ),
                  );
                }
              }}
              onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
              onPointerMove={(e) => {
                if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
                const r = workspace.current!.getBoundingClientRect(),
                  horizontal = layout === 'top-3' || layout === 'rows-2';
                setSplit(
                  Math.max(
                    25,
                    Math.min(
                      75,
                      (horizontal
                        ? (e.clientY - r.top) / r.height
                        : (e.clientX - r.left) / r.width) * 100,
                    ),
                  ),
                );
              }}
            />
          )}
          {!hasStudies && (
            <div className="welcome">
              <div className="welcome-orbit">◉</div>
              <span className="eyebrow">YOUR IMAGES. YOUR DEVICE.</span>
              <h1>
                A clearer view,
                <br />
                kept local.
              </h1>
              <p>
                Explore MRI examinations, compare sequences,
                <br />
                and reconstruct in three planes.
              </p>
              <button className="primary" onClick={() => folder.current?.click()}>
                Open an examination
              </button>
              <small>
                Choose a folder, individual DICOM files, or a ZIP.
                <br />
                You can also drop files anywhere in this window.
              </small>
            </div>
          )}
        </div>
        {sidebar && <StudyBrowser importing={importing} />}
      </main>
      <footer>
        <span>Session only · No uploads</span>
        <span>Wheel to browse · Drag with the selected tool · Pinch to zoom</span>
        <span>Personal viewing</span>
      </footer>
      {drop && <div className="drop-overlay">Drop a DICOM folder, files, or ZIP</div>}
      {dialog === 'metadata' && <MetadataDialog onClose={() => setDialog(undefined)} />}
      {dialog === 'export' && exportWorkspace && (
        <ExportDialog workspace={exportWorkspace} onClose={() => setDialog(undefined)} />
      )}
    </div>
  );
}
