import { afterEach, expect, test, vi } from 'vitest';
vi.mock('../src/features/agent/commands', () => ({
  schemas: {
    get_viewer_state: { type: 'object', properties: {} },
    set_slice: { type: 'object', properties: {} },
  },
  executeCommand: vi.fn(async () => ({ ready: true })),
}));
import { registerAgentTools, type SiteTool } from '../src/features/agent/webmcp';
afterEach(() => vi.unstubAllGlobals());
test('disable during asynchronous registration removes late tools before re-enabling', async () => {
  const tools = new Map<string, SiteTool>();
  let finish: (() => void) | undefined;
  let delay = true;
  const api = {
    registerTool: vi.fn(async (tool: SiteTool) => {
      if (delay) {
        delay = false;
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
      }
      if (tools.has(tool.name)) throw new Error('Duplicate');
      tools.set(tool.name, tool);
    }),
    unregisterTool: vi.fn(async (name: string) => {
      tools.delete(name);
    }),
  };
  const window = {};
  Object.assign(window, { top: window });
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', { modelContext: api });
  const status = vi.fn();
  const stop = registerAgentTools({} as HTMLElement, status);
  await vi.waitFor(() => expect(finish).toBeDefined());
  stop();
  const stopAgain = registerAgentTools({} as HTMLElement, status);
  finish!();
  await vi.waitFor(() => expect(tools.size).toBe(2));
  expect(status).toHaveBeenCalledTimes(1);
  const stale = tools.get('get_viewer_state')!;
  stopAgain();
  await vi.waitFor(() => expect(tools.size).toBe(0));
  expect(await stale.execute({} as never)).toMatchObject({ ok: false });
});
test('partial registration failure rolls back registered tools', async () => {
  const tools = new Map<string, SiteTool>();
  const window = {};
  Object.assign(window, { top: window });
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', {
    modelContext: {
      registerTool: async (tool: SiteTool) => {
        if (tools.size) throw new Error('Unavailable');
        tools.set(tool.name, tool);
      },
      unregisterTool: async (name: string) => {
        tools.delete(name);
      },
    },
  });
  const status = vi.fn();
  const stop = registerAgentTools({} as HTMLElement, status);
  await vi.waitFor(() =>
    expect(status).toHaveBeenCalledWith(expect.stringContaining('Registration failed')),
  );
  expect(tools.size).toBe(0);
  stop();
});

test('capability diagnostics distinguish missing, blocked and framed APIs', async () => {
  const { probeWebMcp } = await import('../src/features/agent/capabilities');
  const window = { isSecureContext: true };
  Object.assign(window, { top: window });
  vi.stubGlobal('window', window);
  vi.stubGlobal('navigator', {});
  vi.stubGlobal('document', {});
  expect(probeWebMcp()).toMatchObject({
    available: false,
    reason: expect.stringContaining('has not exposed'),
  });
  const api = { registerTool() {} };
  vi.stubGlobal('document', { modelContext: api });
  expect(probeWebMcp()).toMatchObject({ available: true, api });
  Object.assign(window, { top: {} });
  expect(probeWebMcp()).toMatchObject({
    available: false,
    reason: expect.stringContaining('inside a frame'),
  });
  Object.assign(window, { top: window });
  vi.stubGlobal('document', {
    get modelContext() {
      throw new Error('blocked');
    },
  });
  expect(probeWebMcp()).toMatchObject({
    available: false,
    reason: expect.stringContaining('blocked access'),
  });
  vi.stubGlobal('document', {});
  vi.stubGlobal('navigator', { modelContext: api });
  expect(probeWebMcp()).toMatchObject({
    available: false,
    reason: expect.stringContaining('navigator.modelContext API is present'),
  });
  expect(probeWebMcp().diagnostics).not.toMatch(/https?:|patient|study|series/);
});

test('registration signal removes tools without unregisterTool', async () => {
  const tools = new Map<string, SiteTool>();
  const api = {
    registerTool: vi.fn(async (tool: SiteTool, options?: { signal?: AbortSignal }) => {
      if (options?.signal?.aborted) throw options.signal.reason;
      tools.set(tool.name, tool);
      options?.signal?.addEventListener('abort', () => tools.delete(tool.name), { once: true });
    }),
  };
  const window = {};
  Object.assign(window, { top: window });
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', { modelContext: api });
  const status = vi.fn();
  const stop = registerAgentTools({} as HTMLElement, status);
  await vi.waitFor(() => expect(tools.size).toBe(2));
  expect(api.registerTool).toHaveBeenCalledWith(
    expect.objectContaining({ name: 'get_viewer_state' }),
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  stop();
  await vi.waitFor(() => expect(tools.size).toBe(0));
});
