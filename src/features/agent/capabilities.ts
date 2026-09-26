import type { ModelContext } from './webmcp';
interface CapabilityHost {
  modelContext?: Partial<ModelContext>;
}
function inspect(host: CapabilityHost) {
  try {
    const api = host.modelContext;
    return {
      api,
      exposed: api != null,
      register: typeof api?.registerTool === 'function',
      unregister: typeof api?.unregisterTool === 'function',
      blocked: false,
    };
  } catch {
    return { api: undefined, exposed: false, register: false, unregister: false, blocked: true };
  }
}
/** Probe capabilities only. Never read page URLs, examination data or browser storage. */
export function probeWebMcp() {
  const documentApi = inspect(document as Document & CapabilityHost);
  const navigatorApi = inspect(navigator as Navigator & CapabilityHost);
  const topLevel = window.top === window;
  const available = topLevel && documentApi.register;
  let reason = '';
  if (!topLevel)
    reason = 'The viewer is inside a frame. Open its localhost URL as a top-level browser tab.';
  else if (documentApi.blocked) reason = 'The browser blocked access to document.modelContext.';
  else if (!documentApi.exposed)
    reason = 'The browser has not exposed document.modelContext to this page.';
  else if (!documentApi.register)
    reason = 'document.modelContext exists, but registerTool is missing.';
  if (!available && navigatorApi.register)
    reason +=
      ' A navigator.modelContext API is present; the viewer currently uses the documented document API.';
  const diagnostics = [
    'WebMCP capability check v1',
    `Top-level page: ${topLevel}`,
    `Secure context: ${window.isSecureContext === true}`,
    `document.modelContext: ${documentApi.blocked ? 'access blocked' : documentApi.exposed ? 'present' : 'missing'}`,
    `document registerTool: ${documentApi.register}`,
    `document unregisterTool: ${documentApi.unregister}`,
    `navigator.modelContext: ${navigatorApi.blocked ? 'access blocked' : navigatorApi.exposed ? 'present' : 'missing'}`,
    `navigator registerTool: ${navigatorApi.register}`,
    `navigator unregisterTool: ${navigatorApi.unregister}`,
  ].join('\n');
  return {
    available,
    reason,
    diagnostics,
    api: available ? (documentApi.api as ModelContext) : undefined,
  };
}
