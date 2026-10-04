import { ScreenshotBar } from '../features/agent/ScreenshotBar';
import { executeCommand } from '../features/agent/commands';
import { closeScreenshot, useScreenshot } from '../features/agent/screenshot';
import { AgentTools } from '../features/agent/AgentTools';
import {
  closeCapture,
  createCapture,
  captureDefaults,
  useCapture,
} from '../features/export/capture';
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
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
  const [dialog, setDialog] = useState<'metadata'>();
  const [exportWorkspace, setExportWorkspace] = useState<HTMLElement | null>(null);
  const captureOpen = useCapture((s) => s.open);
  const screenshot = useScreenshot((s) => s.view);
  useEffect(
    () => () => {
      closeScreenshot();
      closeCapture();
    },
    [],
  );
  const [drop, setDrop] = useState(false);
  const [split, setSplit] = useState(60);
  const files = useRef<HTMLInputElement>(null),
    folder = useRef<HTMLInputElement>(null),
    zip = useRef<HTMLInputElement>(null),
    workspace = useRef<HTMLDivElement>(null),
    openOptions = useRef<HTMLDetailsElement>(null),
    settings = useRef<HTMLDetailsElement>(null),
    sidebarPreferences = useRef({ desktop: sidebar, compact: false }),
    abort = useRef<AbortController | undefined>(undefined);
  const workspaceRef = useCallback((element: HTMLDivElement | null) => {
    workspace.current = element;
    setExportWorkspace(element);
  }, []);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      for (const ref of [openOptions, settings]) {
        if (ref.current?.open && !ref.current.contains(event.target as Node))
          ref.current.open = false;
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (event.target instanceof Element && event.target.closest('dialog')) return;
      for (const ref of [openOptions, settings]) {
        if (ref.current?.open) {
          ref.current.open = false;
          ref.current.querySelector('summary')?.focus();
        }
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, []);
  useEffect(() => {
    const compact = window.matchMedia('(max-width: 1100px)');
    const preferences = sidebarPreferences.current;
    let compactMode = compact.matches;
    useSession.setState({ sidebar: compactMode ? preferences.compact : preferences.desktop });
    const resize = () => {
      if (compact.matches === compactMode) return;
      preferences[compactMode ? 'compact' : 'desktop'] = useSession.getState().sidebar;
      compactMode = compact.matches;
      useSession.setState({ sidebar: compactMode ? preferences.compact : preferences.desktop });
    };
    compact.addEventListener('change', resize);
    return () => compact.removeEventListener('change', resize);
  }, []);
  useEffect(() => {
    if (!progress?.finished || !progress.accepted || progress.cancelled || progress.issues.length)
      return;
    const timer = window.setTimeout(() => setProgress(undefined), 5000);
    return () => window.clearTimeout(timer);
  }, [progress]);
  useEffect(() => {
    if (notice !== 'MPR ready. Reconstructed detail follows the original acquisition resolution.')
      return;
    const timer = window.setTimeout(() => {
      if (useSession.getState().notice === notice) useSession.setState({ notice: undefined });
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  const importing = !!progress && !progress.finished;
  const start = (files: File[]) => {
    if (importing || !files.length) return;
    abort.current = new AbortController();
    void importFiles(files, abort.current.signal, setProgress);
  };
  return (
    <div
      className={`app ${screenshot ? 'screenshot-mode' : ''}`}
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
          <span className="local-badge" title="DICOM files stay in this browser. No uploads.">
            <i />
            On this device
          </span>
        </div>
        {hasStudies && (
          <div className="import-actions">
            <button disabled={importing} onClick={() => folder.current?.click()}>
              Open folder
            </button>
            <details ref={openOptions} className="open-options">
              <summary aria-label="More open options">▾</summary>
              <div className="popover">
                <button disabled={importing} onClick={() => files.current?.click()}>
                  Open files
                </button>
                <button disabled={importing} onClick={() => zip.current?.click()}>
                  Open ZIP
                </button>
              </div>
            </details>
          </div>
        )}
        <div className="header-end">
          {hasStudies && (
            <button
              aria-label="Toggle examinations"
              aria-expanded={sidebar}
              aria-pressed={sidebar}
              onClick={() => useSession.setState({ sidebar: !sidebar })}
            >
              Examinations
            </button>
          )}
          <details ref={settings} className="session-settings">
            <summary>Settings</summary>
            <div className="popover settings-popover">
              <label>
                Memory profile
                <select
                  aria-label="Memory profile"
                  value={profile}
                  onChange={(e) => changeProfile(e.target.value as 'standard' | 'low')}
                >
                  <option value="standard">Standard memory</option>
                  <option value="low">Low memory</option>
                </select>
              </label>
              <AgentTools workspace={workspace} />
            </div>
          </details>
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
      {hasStudies && (
        <Toolbar
          onScreenshot={(scope) => {
            if (workspace.current)
              void executeCommand('capture_view', { scope }, workspace.current).catch((error) =>
                useSession.setState({
                  notice: error instanceof Error ? error.message : 'Screenshot preparation failed.',
                }),
              );
          }}
          onMetadata={() => {
            pause();
            setDialog('metadata');
          }}
          onExport={() => {
            pause();
            if (workspace.current)
              void createCapture(captureDefaults(workspace.current), workspace.current).catch(
                (error) =>
                  useSession.setState({
                    notice: error instanceof Error ? error.message : 'Capture failed.',
                  }),
              );
          }}
        />
      )}
      {screenshot && <ScreenshotBar />}
      <main className={hasStudies && sidebar ? 'with-sidebar' : ''}>
        <div className="status-overlay">
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
        </div>
        <div
          ref={workspaceRef}
          className={`workspace layout-${layout} ${hasStudies ? '' : 'workspace-empty'}`}
          data-screenshot-pane={screenshot?.pane}
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
            <section className="welcome" aria-labelledby="welcome-title">
              <div className="welcome-panel">
                <span className="welcome-icon" aria-hidden="true">
                  ◉
                </span>
                <h1 id="welcome-title">Open an examination</h1>
                <p>View DICOM images and compare series in this browser.</p>
                <div className="welcome-actions">
                  <button
                    className="primary"
                    disabled={importing}
                    onClick={() => folder.current?.click()}
                  >
                    Open folder
                  </button>
                  <button disabled={importing} onClick={() => files.current?.click()}>
                    Open files
                  </button>
                  <button disabled={importing} onClick={() => zip.current?.click()}>
                    Open ZIP
                  </button>
                </div>
                <p className="welcome-drop">
                  Or drop a DICOM folder, files, or ZIP anywhere in this window.
                </p>
                <small>Your images stay on this device. No uploads.</small>
              </div>
            </section>
          )}
        </div>
        {hasStudies && sidebar && <StudyBrowser importing={importing} />}
      </main>
      <footer>
        <span>Session only</span>
        <span>Wheel to browse · Drag with the selected tool · Pinch to zoom</span>
        <span>Personal viewing</span>
      </footer>
      {drop && <div className="drop-overlay">Drop a DICOM folder, files, or ZIP</div>}
      {dialog === 'metadata' && <MetadataDialog onClose={() => setDialog(undefined)} />}
      {captureOpen && exportWorkspace && (
        <ExportDialog workspace={exportWorkspace} onClose={closeCapture} />
      )}
    </div>
  );
}
