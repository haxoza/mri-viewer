import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { dicom } from '../fixtures';
const files = Array.from({ length: 7 }, (_, i) => ({
  name: `synthetic-${i}`,
  mimeType: 'application/dicom',
  buffer: Buffer.from(dicom(i)),
}));
interface Result {
  ok: boolean;
  error?: string;
  result: any;
}
async function call(page: Page, name: string, args: object = {}): Promise<Result> {
  return page.evaluate(
    async ({ name, args }) => {
      const context = (document as any).modelContext;
      return context.tools.get(name).execute(args, { signal: new AbortController().signal });
    },
    { name, args },
  );
}
async function openSettings(page: Page) {
  const settings = page.locator('.session-settings');
  if (!(await settings.evaluate((element) => element.hasAttribute('open'))))
    await page.getByText('Settings', { exact: true }).click();
}
async function toggleAgentTools(page: Page) {
  await openSettings(page);
  const trigger = page.getByRole('button', { name: 'Agent tools', exact: true });
  const closing = (await trigger.getAttribute('aria-expanded')) === 'true';
  await trigger.click();
  if (closing) await page.getByText('Settings', { exact: true }).click();
}
async function setup(page: Page) {
  await page.addInitScript(() => {
    const tools = new Map();
    const blobs = new Map<string, Blob>();
    const revoked = new Set<string>();
    const create = URL.createObjectURL.bind(URL),
      revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      const url = create(blob);
      if (blob instanceof Blob) blobs.set(url, blob);
      return url;
    };
    URL.revokeObjectURL = (url) => {
      revoked.add(url);
      blobs.delete(url);
      revoke(url);
    };
    (window as any).__captureBlobs = blobs;
    (window as any).__revoked = revoked;
    Object.defineProperty(document, 'modelContext', {
      configurable: true,
      value: {
        tools,
        registerTool(tool: any) {
          if (tools.has(tool.name)) throw new Error('Duplicate registration');
          tools.set(tool.name, tool);
        },
        unregisterTool(name: string) {
          tools.delete(name);
        },
      },
    });
  });
  await page.goto('/');
  await page.getByLabel('Open DICOM files').setInputFiles(files);
  await expect(page.getByLabel('Slice number')).toHaveValue('4');
  await toggleAgentTools(page);
  await page.getByLabel('Enable agent tools').click();
  await expect(page.getByText('Enabled for this session')).toBeVisible();
  await toggleAgentTools(page);
}
test('tool catalog, validation, one-based navigation, annotations, frozen captures and disable', async ({
  page,
}) => {
  await setup(page);
  expect(await page.evaluate(() => (document as any).modelContext.tools.size)).toBe(12);
  const initial = await call(page, 'get_viewer_state');
  expect(initial.ok).toBe(true);
  const serialized = JSON.stringify(initial);
  expect(serialized).not.toMatch(/Synthetic|Patient|studyUID|seriesUID|sopUID|synthetic-/);
  expect(initial.result.panes[0].displayed).toBe(4);
  expect((await call(page, 'set_slice', { pane: 1, position: 0 })).ok).toBe(false);
  expect((await call(page, 'set_slice', { pane: 1, position: 8 })).ok).toBe(false);
  expect((await call(page, 'set_active_pane', { pane: 2 })).ok).toBe(false);
  expect((await call(page, 'set_layout', { layout: 'invalid' })).ok).toBe(false);
  expect((await call(page, 'set_view', { pane: 1, width: 100 })).ok).toBe(false);
  expect((await call(page, 'set_crosshair', { pane: 1, x: 0.5, y: 0.5 })).ok).toBe(false);
  expect((await call(page, 'set_slice', { pane: 1, position: 2 })).ok).toBe(true);
  await expect(page.getByLabel('Slice number')).toHaveValue('2');
  const mark = { id: 'region', x: 0.5, y: 0.5, rx: 0.12, ry: 0.17, color: 'red' };
  expect((await call(page, 'edit_annotations', { pane: 1, action: 'add', ellipse: mark })).ok).toBe(
    true,
  );
  await expect(page.locator('.annotations ellipse')).toHaveCount(1);
  expect(
    (await call(page, 'set_view', { pane: 1, zoom: 1.5, width: 300, center: 120, dx: 15, dy: -10 }))
      .ok,
  ).toBe(true);
  const capture = await call(page, 'capture_view', {});
  expect(capture.ok, capture.error).toBe(true);
  expect(capture.result.live).toBe(true);
  expect(capture.result.panes[0]).toMatchObject({
    pane: 1,
    displayed: 2,
    label: 'View 1',
    annotations: [mark],
  });
  await expect(page.getByText('Ready for screenshot', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeHidden();
  await expect(page.locator('.capture-preview')).toHaveCount(0);
  await expect(page.locator('.pane-top')).toContainText('View 1');
  await expect(page.locator('.pane-top')).not.toContainText('Synthetic');
  expect(JSON.stringify(capture)).not.toMatch(
    /Synthetic|Patient|studyUID|seriesUID|sopUID|synthetic-/,
  );
  expect((await call(page, 'get_viewer_state')).result.screenshot.changed).toBe(false);
  await call(page, 'close_capture');
  // Frozen downloads remain a separate, unchanged contract.
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await expect(page.locator('.capture-preview img')).toBeVisible();
  const url = await page.locator('.capture-preview img').getAttribute('src');
  const frozenBytes = await page.evaluate(
    async (url) =>
      Array.from(new Uint8Array(await (window as any).__captureBlobs.get(url).arrayBuffer())),
    url,
  );
  expect((await call(page, 'set_slice', { pane: 1, position: 6 })).ok).toBe(true);
  await expect(page.locator('.capture-preview img')).toHaveAttribute('src', url!);
  await expect(page.locator('.capture-preview figcaption')).toContainText('acquired 2/7');
  expect((await call(page, 'get_viewer_state')).result.panes[0].annotations).toEqual([mark]);
  await expect(page.getByText('Viewer changed – this preview is unchanged.')).toBeVisible();
  expect((await call(page, 'capture_view')).ok).toBe(false);
  await page.getByLabel('Export width').fill('500');
  await expect(page.getByText('Output settings changed', { exact: false })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download image' }).click();
  expect(Array.from(await readFile((await (await download).path())!))).toEqual(frozenBytes);
  expect(await page.evaluate((url) => (window as any).__revoked.has(url), url)).toBe(true);
  expect((await call(page, 'edit_annotations', { pane: 1, action: 'clear' })).ok).toBe(true);
  expect((await call(page, 'edit_annotations', { pane: 1, action: 'undo' })).ok).toBe(true);
  expect((await call(page, 'get_viewer_state')).result.panes[0].annotations).toEqual([mark]);
  await toggleAgentTools(page);
  await page.getByLabel('Disable agent tools').click();
  await expect.poll(() => page.evaluate(() => (document as any).modelContext.tools.size)).toBe(0);
  await page.getByLabel('Enable agent tools').click();
  await expect.poll(() => page.evaluate(() => (document as any).modelContext.tools.size)).toBe(12);
});

test('serialized commands settle linked panes and MPR; workspace excludes hidden panes', async ({
  page,
}) => {
  await setup(page);
  const set = (await call(page, 'get_viewer_state')).result.studies[0].series[0].displaySets[0].id;
  expect((await call(page, 'set_layout', { layout: 'columns-2' })).ok).toBe(true);
  expect((await call(page, 'assign_view', { pane: 2, displaySet: set, mode: 'acquired' })).ok).toBe(
    true,
  );
  await call(page, 'set_linked', { pane: 1, linked: true });
  await call(page, 'set_linked', { pane: 2, linked: true });
  const results = await Promise.all([
    call(page, 'set_slice', { pane: 1, position: 1 }),
    call(page, 'set_slice', { pane: 1, position: 7 }),
  ]);
  expect(results.map((r) => r.ok)).toEqual([true, true]);
  expect(results[0].result.panes.map((p: any) => p.displayed)).toEqual([1, 1]);
  expect(results[1].result.panes.map((p: any) => p.displayed)).toEqual([7, 7]);
  expect((await call(page, 'open_mpr', { pane: 1 })).ok).toBe(true);
  expect((await call(page, 'set_crosshair', { pane: 1, x: 0.45, y: 0.45 })).ok).toBe(true);
  for (const layout of ['grid-4', 'left-3', 'columns-2', 'single']) {
    expect((await call(page, 'set_layout', { layout })).ok).toBe(true);
    if (layout === 'grid-4')
      expect(
        (await call(page, 'assign_view', { pane: 4, displaySet: set, mode: 'acquired' })).ok,
      ).toBe(true);
    const captured = await call(page, 'capture_view', { scope: 'workspace' });
    expect(captured.ok, captured.error).toBe(true);
    expect(captured.result.panes.length).toBe(
      layout === 'grid-4' ? 4 : layout === 'single' ? 1 : Number(layout.at(-1)),
    );
    expect((await call(page, 'close_capture')).ok).toBe(true);
  }
});

test('unsupported browser retains annotation, preview, and export workflow', async ({ page }) => {
  await page.goto('/');
  await toggleAgentTools(page);
  await expect(page.getByLabel('Enable agent tools')).toBeDisabled();
  await toggleAgentTools(page);
  await expect(page.getByRole('button', { name: 'Screenshot view', exact: true })).toHaveCount(0);
  await page.getByLabel('Open DICOM files').setInputFiles(files);
  await expect(page.getByLabel('Slice number')).toHaveValue('4');
  const screenshotButton = page.getByRole('button', { name: 'Screenshot view', exact: true });
  await screenshotButton.click();
  await expect(page.getByRole('menu', { name: 'Screenshot view' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(screenshotButton).toBeFocused();
  await expect(screenshotButton).toHaveAttribute('aria-expanded', 'false');
  await screenshotButton.click();
  await page.locator('.brand').click();
  await expect(screenshotButton).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByLabel('Slice number')).toHaveValue('4');
  await page.getByRole('button', { name: 'Ellipse', exact: true }).click();
  const box = (await page.locator('.annotations').boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('.annotations ellipse')).toHaveCount(1);
  await page.getByRole('button', { name: 'Slices', exact: true }).click();
  await page.getByRole('button', { name: 'Next slice', exact: true }).click();
  await expect(page.locator('.annotations ellipse')).toHaveCount(1);
  // Manual screenshot preparation also works without a WebMCP bridge or opt-in.
  await page.getByLabel('Layout', { exact: true }).selectOption('columns-2');
  for (const scope of ['Active pane', 'Whole workspace']) {
    await page.getByText('Screenshot view', { exact: true }).click();
    await page.getByRole('menuitem', { name: scope, exact: true }).click();
    await expect(page.getByText('Ready for screenshot', { exact: false })).toBeVisible();
    await expect(page.locator('.app-header')).toBeHidden();
    await expect(page.locator('.annotations ellipse').first()).toBeVisible();
    if (scope === 'Active pane') {
      await expect(page.locator('.viewport').nth(1)).toBeHidden();
      await page.keyboard.press('Escape');
    } else {
      await expect(page.locator('.viewport').nth(1)).toBeVisible();
      await page.getByRole('button', { name: 'Restore controls' }).click();
    }
    await expect(page.getByText('Screenshot view', { exact: true })).toBeFocused();
    await expect(page.locator('.app-header')).toBeVisible();
    await expect(page.getByLabel('Layout', { exact: true })).toHaveValue('columns-2');
  }
  await page.getByLabel('Layout', { exact: true }).selectOption('single');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await expect(page.locator('.capture-preview img')).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Remove Synthetic examination', exact: true }).click();
  await expect(page.locator('.annotations ellipse')).toHaveCount(0);
});

test('human supersession, Escape, disable and abort cancel screenshot preparation', async ({
  page,
}) => {
  await setup(page);
  for (const action of ['human', 'escape', 'disable', 'abort']) {
    await page.evaluate(() => {
      // Hold animation frames to exercise cancellation during renderer/layout settlement.
      const original = window.requestAnimationFrame;
      const held: FrameRequestCallback[] = [];
      window.requestAnimationFrame = (callback) => {
        held.push(callback);
        return 0;
      };
      (window as any).__finishCapture = () => {
        window.requestAnimationFrame = original;
        held.forEach((callback) => original(callback));
      };
      const abort = new AbortController();
      (window as any).__abortTool = abort;
      (window as any).__pendingCapture = (document as any).modelContext.tools
        .get('capture_view')
        .execute({}, { signal: abort.signal });
    });
    await expect(page.locator('.screenshot-mode')).toHaveCount(1);
    if (action === 'human')
      await page.getByRole('button', { name: 'Restore controls' }).click({ force: true });
    else if (action === 'escape') await page.keyboard.press('Escape');
    else if (action === 'disable') {
      // The normal control remains mounted while hidden. Dispatch the same React click.
      await page
        .getByLabel('Disable agent tools')
        .evaluate((input: HTMLButtonElement) => input.click());
    } else await page.evaluate(() => (window as any).__abortTool.abort());
    const result = await page.evaluate(() => (window as any).__pendingCapture);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/cancel|supersed/i);
    await page.evaluate(() => (window as any).__finishCapture());
    await expect(page.locator('.screenshot-mode')).toHaveCount(0);
    await expect(page.locator('.capture-preview')).toHaveCount(0);
    if (action === 'disable') {
      await toggleAgentTools(page);
      await page.getByLabel('Enable agent tools').click();
      await expect(page.getByText('Enabled for this session')).toBeVisible();
      await toggleAgentTools(page);
    }
    expect((await call(page, 'set_slice', { pane: 1, position: 2 })).ok).toBe(true);
  }
});

test('reconstruction failures report unsupported geometry and memory; acquired viewing recovers', async ({
  page,
}) => {
  await setup(page);
  // A second, deliberately short stack fails geometry validation without allocation.
  const short = [0, 1].map((i) => ({
    name: `short-${i}`,
    mimeType: 'application/dicom',
    buffer: Buffer.from(dicom(i, { series: 2 })),
  }));
  await page.getByLabel('Open DICOM files').setInputFiles(short);
  await expect(page.getByText('2 frames imported')).toBeVisible();
  let catalog = (await call(page, 'get_viewer_state')).result.studies[0].series;
  const first = catalog[0].displaySets[0].id,
    second = catalog[1].displaySets[0].id;
  expect(
    (await call(page, 'assign_view', { pane: 1, displaySet: second, mode: 'acquired' })).ok,
  ).toBe(true);
  expect((await call(page, 'open_mpr', { pane: 1 })).error).toContain(
    'does not support reconstruction',
  );
  const rest = [2, 3, 4, 5, 6].map((i) => ({
    name: `rest-${i}`,
    mimeType: 'application/dicom',
    buffer: Buffer.from(dicom(i, { series: 2 })),
  }));
  await page.getByLabel('Open DICOM files').setInputFiles(rest);
  await expect(page.getByText('5 frames imported')).toBeVisible();
  catalog = (await call(page, 'get_viewer_state')).result.studies[0].series;
  await openSettings(page);
  await page.getByLabel('Memory profile').selectOption('low');
  await page.getByText('Settings', { exact: true }).click();
  expect((await call(page, 'assign_view', { pane: 1, displaySet: first, mode: 'axial' })).ok).toBe(
    true,
  );
  expect((await call(page, 'set_layout', { layout: 'columns-2' })).ok).toBe(true);
  const result = await call(page, 'assign_view', {
    pane: 2,
    displaySet: catalog[1].displaySets[0].id,
    mode: 'axial',
  });
  expect(result.ok).toBe(false);
  expect(result.error).toContain('memory profile');
  expect(
    (
      await call(page, 'assign_view', {
        pane: 2,
        displaySet: catalog[1].displaySets[0].id,
        mode: 'acquired',
      })
    ).ok,
  ).toBe(true);
});

test.describe('high-DPI capture', () => {
  test.use({ deviceScaleFactor: 2 });
  test('preserves aspect ratio, colored marks, and local-only processing', async ({
    page,
    baseURL,
  }) => {
    const external: string[] = [];
    page.on('request', (request) => {
      if (
        new URL(request.url()).origin !== new URL(baseURL!).origin &&
        !request.url().startsWith('blob:') &&
        !request.url().startsWith('data:')
      )
        external.push(request.url());
    });
    await setup(page);
    await call(page, 'edit_annotations', {
      pane: 1,
      action: 'add',
      ellipse: { id: 'dpi', x: 0.5, y: 0.5, rx: 0.2, ry: 0.1, color: 'cyan' },
    });
    const result = await call(page, 'capture_view', { pane: 1 });
    expect(result.ok).toBe(true);
    const bounds = (await page.locator('.imaging-canvas').boundingBox())!;
    expect(result.result.width / result.result.height).toBeCloseTo(bounds.width / bounds.height, 2);
    await call(page, 'close_capture');
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const colors = await page.locator('.capture-preview img').evaluate(async (image) => {
      const source = image as HTMLImageElement;
      await source.decode();
      const canvas = document.createElement('canvas');
      canvas.width = source.naturalWidth;
      canvas.height = source.naturalHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(source, 0, 0);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let cyan = 0,
        grayscale = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] < 40 && pixels[i + 1] > 180 && pixels[i + 2] > 180) cyan++;
        if (
          pixels[i] > 30 &&
          pixels[i] < 230 &&
          pixels[i] === pixels[i + 1] &&
          pixels[i] === pixels[i + 2]
        )
          grayscale++;
      }
      return { cyan, grayscale };
    });
    expect(colors.cyan).toBeGreaterThan(100);
    expect(colors.grayscale).toBeGreaterThan(1000);
    const storage = await page.evaluate(() => ({
      local: Object.entries(localStorage),
      session: sessionStorage.length,
    }));
    expect(storage.session).toBe(0);
    // Existing dependencies persist logger levels and GPU capability probes,
    // never examination payloads, marks or captures.
    for (const [key, value] of storage.local) {
      expect(key).toMatch(/^(loglevel(?::.*)?|cornerstone3D\.renderingCapabilities)$/);
      if (key.startsWith('loglevel'))
        expect(value).toMatch(/^(TRACE|DEBUG|INFO|WARN|ERROR|SILENT)$/);
    }
    expect(JSON.stringify(storage)).not.toMatch(/Synthetic|synthetic-|local:|studyUID|seriesUID/);
    expect(JSON.stringify(storage)).not.toContain(result.result.captureId);
    expect(external).toEqual([]);
  });
});

test('agent control detects late browser injection without loading files or refreshing', async ({
  page,
}) => {
  await page.goto('/');
  await toggleAgentTools(page);
  await expect(page.getByLabel('Enable agent tools')).toBeDisabled();
  await page.getByText('Connection diagnostics', { exact: true }).click();
  await expect(
    page.getByText('The browser has not exposed document.modelContext to this page.'),
  ).toBeVisible();
  await expect(page.getByLabel('WebMCP diagnostics')).toContainText(
    'document.modelContext: missing',
  );
  await page.evaluate(() => {
    Object.defineProperty(document, 'modelContext', {
      configurable: true,
      value: { registerTool() {}, unregisterTool() {} },
    });
  });
  await expect(page.getByText('Agent tools are available in this browser.')).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await toggleAgentTools(page);
  await expect(page.getByLabel('Enable agent tools')).toBeEnabled();
  await page.getByLabel('Enable agent tools').click();
  await expect(page.getByText('Enabled for this session')).toBeVisible();
});

test('screenshot isolates the requested pane, tracks live changes and restores layout without remounting', async ({
  page,
}) => {
  await setup(page);
  const set = (await call(page, 'get_viewer_state')).result.panes[0].displaySet;
  await call(page, 'set_layout', { layout: 'columns-2' });
  await call(page, 'assign_view', { pane: 2, displaySet: set, mode: 'acquired' });
  await call(page, 'set_slice', { pane: 2, position: 2 });
  await call(page, 'edit_annotations', {
    pane: 2,
    action: 'add',
    ellipse: {
      id: 'target',
      x: 0.5,
      y: 0.5,
      rx: 0.12,
      ry: 0.17,
      color: 'red',
    },
  });
  const before = (await call(page, 'get_viewer_state')).result;
  const size = (await page.locator('.imaging-canvas').nth(1).boundingBox())!;
  await page.evaluate(() => {
    (window as any).__panes = Array.from(document.querySelectorAll('.imaging-canvas'));
    (window as any).__canvases = Array.from(document.querySelectorAll('.imaging-canvas canvas'));
  });
  const captured = await call(page, 'capture_view', { pane: 2 });
  expect(captured.ok, captured.error).toBe(true);
  expect(captured.result.panes.map((p: any) => p.pane)).toEqual([2]);
  expect(captured.result.width).toBeGreaterThan(size.width);
  await expect(page.getByRole('button', { name: 'Restore controls' })).toBeFocused();
  await expect(page.locator('.viewport').nth(0)).toBeHidden();
  await expect(page.locator('.viewport').nth(1)).toBeVisible();
  await expect(page.locator('.viewport').nth(1)).toContainText('Slice 2 / 7');
  await expect(page.locator('.viewport').nth(1)).toContainText('1 screen mark');
  await expect(page.getByText('Ready for screenshot', { exact: false })).toBeVisible();
  expect((await call(page, 'get_viewer_state')).result.screenshot.changed).toBe(false);
  expect((await call(page, 'set_slice', { pane: 2, position: 3 })).ok).toBe(true);
  await expect(page.locator('.viewport').nth(1)).toContainText('Slice 3 / 7');
  await expect(page.getByText('Changed since preparation', { exact: false })).toBeVisible();
  await call(page, 'capture_view', { pane: 2 });
  await expect(page.getByText('Ready for screenshot', { exact: false })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.app-header')).toBeVisible();
  await expect(page.locator('.study-browser')).toBeVisible();
  expect((await call(page, 'get_viewer_state')).result.layout).toBe(before.layout);
  expect(
    await page.evaluate(
      () =>
        (window as any).__panes.every(
          (el: Element, i: number) => el === document.querySelectorAll('.imaging-canvas')[i],
        ) &&
        (window as any).__canvases.every(
          (el: Element, i: number) => el === document.querySelectorAll('.imaging-canvas canvas')[i],
        ),
    ),
  ).toBe(true);
  await call(page, 'capture_view', { scope: 'workspace' });
  await expect(page.locator('.viewport').nth(0)).toBeVisible();
  await expect(page.locator('.viewport').nth(1)).toBeVisible();
  await page.getByRole('button', { name: 'Restore controls' }).click();
  await expect(page.locator('.screenshot-mode')).toHaveCount(0);
});

test('MPR screenshot resize and restoration preserve positions and rendered pixels', async ({
  page,
}) => {
  await setup(page);
  expect((await call(page, 'open_mpr', { pane: 1 })).ok).toBe(true);
  const state = (await call(page, 'get_viewer_state')).result;
  const pixels = () =>
    page
      .locator('.imaging-canvas canvas')
      .evaluateAll((elements) => elements.map((el) => (el as HTMLCanvasElement).toDataURL()));
  const before = await pixels();
  const positions = state.panes.map((p: any) => p.displayed);
  for (const args of [{ pane: 2 }, { scope: 'workspace' }, { pane: 3 }]) {
    const captured = await call(page, 'capture_view', args);
    expect(captured.ok, captured.error).toBe(true);
    expect(
      (await call(page, 'get_viewer_state')).result.panes.map((p: any) => p.displayed),
    ).toEqual(positions);
    expect((await call(page, 'close_capture')).ok).toBe(true);
    await expect.poll(pixels).toEqual(before);
  }
});

test('slow frozen export encoding is cancelled without replacing the existing preview', async ({
  page,
}) => {
  await setup(page);
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const preview = page.locator('.capture-preview img');
  await expect(preview).toBeVisible();
  const originalUrl = await preview.getAttribute('src');
  await expect(page.getByText('Viewer changed – this preview is unchanged.')).toHaveCount(0);
  await page.evaluate(() => {
    const original = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback, ...args) {
      (window as any).__finishEncoding = () => original.call(this, callback, ...args);
      HTMLCanvasElement.prototype.toBlob = original;
    };
  });
  await page.getByRole('button', { name: 'Refresh preview' }).click();
  await expect
    .poll(() => page.evaluate(() => typeof (window as any).__finishEncoding))
    .toBe('function');
  // A new view supersedes the pending frozen capture; its old image remains downloadable.
  expect((await call(page, 'set_slice', { pane: 1, position: 2 })).ok).toBe(true);
  await page.evaluate(() => (window as any).__finishEncoding());
  await expect(page.getByRole('alert')).toContainText('superseded');
  await expect(preview).toHaveAttribute('src', originalUrl!);
  expect(await page.evaluate((url) => (window as any).__revoked.has(url), originalUrl)).toBe(false);
  await page.getByRole('button', { name: 'Close dialog' }).click();
  expect(await page.evaluate((url) => (window as any).__revoked.has(url), originalUrl)).toBe(true);
});
