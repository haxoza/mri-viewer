import { useState } from 'react';
import { Dialog } from '../../app/Dialog';
import { useSession } from '../../app/store';
import { controllers } from '../../imaging/rendering/controller';
import { download, exportImage, type ExportOptions } from './service';
export function ExportDialog({
  workspace,
  onClose,
}: {
  workspace: HTMLElement;
  onClose: () => void;
}) {
  const active = controllers[useSession.getState().active].element!;
  const rect = active.getBoundingClientRect();
  const [options, setOptions] = useState<ExportOptions>({
    scope: 'active',
    format: 'png',
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    quality: 0.92,
    overlays: false,
  });
  const [locked, setLocked] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const ratio = () => {
    const r =
      options.scope === 'active'
        ? active.getBoundingClientRect()
        : workspace.getBoundingClientRect();
    return r.width / r.height;
  };
  const size = (width: number, height: number) => setOptions((o) => ({ ...o, width, height }));
  return (
    <Dialog
      title="Export image"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="form-row">
        <label>
          Capture
          <select
            value={options.scope}
            onChange={(e) => {
              const scope = e.target.value as ExportOptions['scope'],
                r =
                  scope === 'active'
                    ? active.getBoundingClientRect()
                    : workspace.getBoundingClientRect();
              setOptions((o) => ({
                ...o,
                scope,
                width: Math.round(r.width),
                height: Math.round(r.height),
              }));
            }}
          >
            <option value="active">Active viewport</option>
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
                ? active.getBoundingClientRect()
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
                ? active.getBoundingClientRect()
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
      <button
        className="primary full"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            download(await exportImage(options, workspace), options.format);
            onClose();
          } catch (error) {
            setError(error instanceof Error ? error.message : 'Export failed. Try a smaller size.');
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Rendering…' : 'Download image'}
      </button>
    </Dialog>
  );
}
