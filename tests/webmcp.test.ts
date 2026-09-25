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
