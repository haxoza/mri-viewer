import { useMarks } from '../annotations/model';
import { useEffect, useRef, useState } from 'react';
import { Dialog } from '../../app/Dialog';
import { useSession } from '../../app/store';
import { controllers } from '../../imaging/rendering/controller';
import { download, type ExportOptions } from './service';
import { captureDefaults, createCapture, useCapture, viewSignature } from './capture';
export function ExportDialog({
  workspace,
  onClose,
}: {
  workspace: HTMLElement;
  onClose: () => void;
}) {
  const capture = useCapture((s) => s.capture);
  useSession();
  useMarks();
  const [options, setOptions] = useState<ExportOptions>(
    () => capture?.options ?? captureDefaults(workspace),
  );
  const active = controllers[options.pane ?? useSession.getState().active].element;
  const [locked, setLocked] = useState(true);
  const [result, setResult] = useState<{
    options: ExportOptions;
    attempt: number;
    error: string;
  }>();
  const [attempt, setAttempt] = useState(0);
  const previewRef = useRef<HTMLElement>(null);
  const settingsChanged = JSON.stringify(options) !== JSON.stringify(capture?.options);
  // Tie completion to this edit so an older render cannot enable a stale download.
  const finished = result?.options === options && result.attempt === attempt;
  const error = finished ? result.error : '';
  const busy = (settingsChanged || attempt > 0) && !finished;
  useEffect(() => {
    if (
      !attempt &&
      JSON.stringify(options) === JSON.stringify(useCapture.getState().capture?.options)
    ) {
      return;
    }
    const controller = new AbortController();
    // Coalesce typing and slider changes; cleanup cancels superseded captures.
    const timer = setTimeout(() => {
      void createCapture(
        options,
        workspace,
        controller.signal,
        previewRef.current?.closest('dialog') ?? undefined,
      )
        .then(() => {
          if (!controller.signal.aborted) setResult({ options, attempt, error: '' });
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted)
            setResult({
              options,
              attempt,
              error: error instanceof Error ? error.message : 'Export failed. Try a smaller size.',
            });
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [options, workspace, attempt]);
  const ratio = () => {
    const r =
      options.scope === 'active'
        ? (active ?? workspace).getBoundingClientRect()
        : workspace.getBoundingClientRect();
    return r.width / r.height;
  };
  const size = (width: number, height: number) => setOptions((o) => ({ ...o, width, height }));
  return (
    <Dialog title="Export image" onClose={onClose}>
      {capture && (
        <figure ref={previewRef} className="capture-preview">
          <img src={capture.url} alt={`Frozen capture ${capture.id}`} />
          <span className="capture-preview-status" role="status">
            {busy ? 'Updating preview…' : ''}
          </span>
          <figcaption>
            Capture {capture.id} · {capture.width} × {capture.height}
            <br />
            {capture.panes
              .map((p) => `Pane ${p.pane}: ${p.mode} ${p.position}/${p.total}`)
              .join(' · ')}
            <br />
            Preview updates automatically when output settings change.
          </figcaption>
        </figure>
      )}
      {capture && capture.signature !== viewSignature() && (
        <p role="status" className="capture-change">
          Viewer changed – this preview is unchanged.
        </p>
      )}
      <div className="form-row">
        <label>
          Capture
          <select
            value={options.scope}
            onChange={(e) => {
              const scope = e.target.value as ExportOptions['scope'],
                r =
                  scope === 'active'
                    ? (active ?? workspace).getBoundingClientRect()
                    : workspace.getBoundingClientRect();
              setOptions((o) => ({
                ...o,
                scope,
                pane: undefined,
                width: Math.round(r.width),
                height: Math.round(r.height),
              }));
            }}
          >
            <option value="active">
              {options.pane === undefined ? 'Active viewport' : `Pane ${options.pane + 1}`}
            </option>
            <option value="workspace">Whole imaging workspace</option>
          </select>
        </label>
        <label>
          Format
          <select
            value={options.format}
            onChange={(e) =>
              setOptions((o) => ({ ...o, format: e.target.value as ExportOptions['format'] }))
            }
          >
            <option value="png">PNG</option>
            <option value="jpeg">JPEG</option>
          </select>
        </label>
      </div>
      <div className="form-row">
        <button
          onClick={() => {
            const r =
              options.scope === 'active'
                ? (active ?? workspace).getBoundingClientRect()
                : workspace.getBoundingClientRect();
            size(Math.round(r.width), Math.round(r.height));
          }}
        >
          Screen size
        </button>
        <button
          onClick={() => {
            const r =
              options.scope === 'active'
                ? (active ?? workspace).getBoundingClientRect()
                : workspace.getBoundingClientRect();
            size(Math.round(r.width * 2), Math.round(r.height * 2));
          }}
        >
          2×
        </button>
      </div>
      <div className="form-row">
        <label>
          Width
          <input
            aria-label="Export width"
            type="number"
            min="1"
            value={options.width}
            onChange={(e) =>
              size(
                Number(e.target.value),
                locked ? Math.round(Number(e.target.value) / ratio()) : options.height,
              )
            }
          />
        </label>
        <span>×</span>
        <label>
          Height
          <input
            aria-label="Export height"
            type="number"
            min="1"
            value={options.height}
            onChange={(e) =>
              size(
                locked ? Math.round(Number(e.target.value) * ratio()) : options.width,
                Number(e.target.value),
              )
            }
          />
        </label>
      </div>
      <label className="check">
        <input type="checkbox" checked={locked} onChange={(e) => setLocked(e.target.checked)} />
        Lock aspect ratio
      </label>
      {options.format === 'jpeg' && (
        <label>
          JPEG quality {Math.round(options.quality * 100)}%
          <input
            type="range"
            min="0.1"
            max="1"
            step="0.01"
            value={options.quality}
            onChange={(e) => setOptions((o) => ({ ...o, quality: Number(e.target.value) }))}
          />
        </label>
      )}
      <label className="check">
        <input
          type="checkbox"
          checked={options.overlays}
          onChange={(e) => setOptions((o) => ({ ...o, overlays: e.target.checked }))}
        />
        Include position and crosshair overlays
      </label>
      <p className="muted">
        Rendered at the selected size with the current crop and windowing. Different aspect ratios
        add black margins. Identifiers burned into source pixels remain in exported images.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {(error || (capture && capture.signature !== viewSignature())) && (
        <button className="full" disabled={busy} onClick={() => setAttempt((n) => n + 1)}>
          {error ? 'Retry preview' : 'Capture current view'}
        </button>
      )}
      <button
        className="primary full"
        disabled={!capture || busy || settingsChanged}
        onClick={() => {
          if (capture) {
            download(capture.blob, capture.options.format);
            onClose();
          }
        }}
      >
        Download image
      </button>
    </Dialog>
  );
}
