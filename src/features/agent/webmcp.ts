import { closeScreenshot } from './screenshot';
import { probeWebMcp } from './capabilities';
import { ViewerError, memoryError } from '../../app/errors';
import { executeCommand, schemas, type CommandName } from './commands';
export interface SiteTool {
  name: string;
  description: string;
  inputSchema: object;
  annotations: { readOnlyHint: boolean };
  execute: (args: never, options?: { signal?: AbortSignal }) => Promise<unknown>;
}
export interface ModelContext {
  registerTool: (tool: SiteTool, options?: { signal?: AbortSignal }) => void | Promise<void>;
  // Older implementations may expose this; current WebMCP removes tools via signal.
  unregisterTool?: (name: string) => void | Promise<void>;
}
export function modelContext(): ModelContext | undefined {
  return probeWebMcp().api;
}
const descriptions: Record<CommandName, string> = {
  get_viewer_state:
    'Read the session catalog and visible pane state. Aliases are session-only; positions and panes are one-based. No patient metadata is returned.',
  set_layout: 'Choose a supported workspace layout. Hidden panes are unavailable to tools.',
  set_active_pane: 'Select a visible pane numbered 1–4.',
  assign_view:
    'Assign a display-set alias from get_viewer_state to a visible pane in acquired or reconstructed mode.',
  set_slice:
    'Navigate to an absolute one-based slice or reconstructed-plane position; wait for linked panes.',
  set_view:
    'Apply window width/center, absolute zoom (0.05–30), pan delta dx/dy in CSS pixels, fit or reset.',
  set_linked: 'Enable or disable existing positional linking on a visible pane.',
  open_mpr:
    'Open the selected pane as three reconstructed planes. May fail if geometry or memory is insufficient.',
  set_crosshair: 'Move the shared MPR crosshair at normalized pane coordinates x/y (0–1).',
  edit_annotations:
    'Edit colored ellipses in normalized pane coordinates. These are fixed screen marks, without anatomical tracking or measurements. Undo or clear marks in one pane.',
  capture_view:
    'Prepare the active pane, a specified visible pane, or workspace for a browser screenshot. Pause cine, hide app controls, maximize panes, retain safe labels and screen marks, and wait for rendering. Returns context, not image bytes. The view is live: navigation updates it. Take a browser screenshot, then call close_capture to restore controls. Pixels may contain burned-in identifiers and enter the agent conversation. Close any dialog first.',
  close_capture:
    'Restore normal viewer controls after capture_view. Also closes any frozen Export preview and releases its image.',
};
// Serialize registration and teardown too: an asynchronous registration may finish
// after disable/unmount, and must not leave a late tool registered.
let lifecycle: Promise<unknown> = Promise.resolve();
export function registerAgentTools(
  workspace: HTMLElement,
  onStatus: (status: string) => void,
): () => void {
  const api = modelContext(),
    lifetime = new AbortController();
  if (!api) {
    onStatus('Unavailable in this browser');
    return () => {};
  }
  const registered: string[] = [];
  const remove = async () => {
    lifetime.abort();
    closeScreenshot();
    if (api.unregisterTool) {
      for (const name of registered.splice(0)) await api.unregisterTool(name);
    } else registered.length = 0;
  };
  const install = async () => {
    try {
      for (const name of Object.keys(schemas) as CommandName[]) {
        if (lifetime.signal.aborted) break;
        await api.registerTool(
          {
            name,
            description: descriptions[name],
            inputSchema: schemas[name],
            annotations: { readOnlyHint: name === 'get_viewer_state' },
            execute: async (args, options) => {
              const signal = AbortSignal.any([
                lifetime.signal,
                ...(options?.signal ? [options.signal] : []),
              ]);
              try {
                signal.throwIfAborted();
                return { ok: true, result: await executeCommand(name, args, workspace, signal) };
              } catch (error) {
                // Never return arbitrary renderer errors that may contain source IDs.
                const reason = signal.aborted
                  ? 'Cancelled or superseded; read current state before continuing.'
                  : error instanceof DOMException && error.name === 'TimeoutError'
                    ? 'Operation timed out. Read current state before retrying.'
                    : error instanceof DOMException && error.name === 'AbortError'
                      ? 'Operation cancelled. Read current state before retrying.'
                      : error instanceof ViewerError
                        ? error.message
                        : error instanceof Error && error.message === memoryError
                          ? memoryError
                          : 'Viewer operation failed. Check pane readiness, geometry and memory.';
                return { ok: false, error: reason };
              }
            },
          },
          { signal: lifetime.signal },
        );
        registered.push(name);
      }
      if (lifetime.signal.aborted) await remove();
      else onStatus('Enabled for this session');
    } catch {
      lifetime.abort();
      closeScreenshot();
      await remove();
      onStatus('Registration failed; manual viewing remains available');
    }
  };
  lifecycle = lifecycle.then(install, install);
  return () => {
    lifetime.abort();
    closeScreenshot();
    lifecycle = lifecycle.then(remove, remove);
  };
}
