import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
const pageErrors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on('pageerror', (e) => errors.push(e.message));
});
test.afterEach(({ page }) => {
  expect(pageErrors.get(page)).toEqual([]);
});
import { dicom } from '../fixtures';
const files = Array.from({ length: 7 }, (_, i) => ({
  name: `slice-${6 - i}`,
  mimeType: 'application/dicom',
  buffer: Buffer.from(dicom(6 - i)),
}));
async function refreshPreview(page: Page) {
  const preview = page.locator('.capture-preview img');
  const previous = await preview.getAttribute('src');
  await page.getByRole('button', { name: 'Refresh preview' }).click();
  // Capture has a 60-second budget; software rendering on CI can exceed the
  // default five-second assertion timeout. Wait for completion or an error,
  // then verify a new capture so a failed refresh cannot download stale pixels.
  await expect(page.getByRole('button', { name: 'Refresh preview' })).toBeEnabled({
    timeout: 65000,
  });
  await expect(page.getByRole('dialog', { name: 'Export image' }).getByRole('alert')).toHaveCount(
    0,
  );
  await expect(preview).not.toHaveAttribute('src', previous!);
  await expect(page.getByRole('button', { name: 'Download image' })).toBeEnabled();
}
test('local import, navigation, comparison, MPR, and exact-size export', async ({
  page,
  baseURL,
}) => {
  test.slow();
  const external: string[] = [];
  page.on('request', (r) => {
    if (
      new URL(r.url()).origin !== new URL(baseURL!).origin &&
      !r.url().startsWith('blob:') &&
      !r.url().startsWith('data:')
    )
      external.push(r.url());
  });
  await page.goto('/');
  await page.getByLabel('Open DICOM files').setInputFiles(files);
  await expect(page.getByText('7 frames imported')).toBeVisible();
  await expect(page.getByLabel('Slice number')).toHaveValue('4');
  const examination = page.getByRole('button', {
    name: 'Examination Synthetic examination',
    exact: true,
  });
  const stack = page.getByRole('button', { name: 'Stack Synthetic volume 1 Axial 1', exact: true });
  const openStack = page.getByRole('button', {
    name: 'Open Synthetic volume 1 Axial 1',
    exact: true,
  });
  await expect(stack).toHaveCount(0);
  await expect(page.locator('.study-list .stack')).toHaveCount(0);
  await examination.click();
  await expect(openStack).toBeHidden();
  await examination.focus();
  await page.keyboard.press('Enter');
  await expect(openStack).toBeVisible();
  await openStack.click();
  await expect(page.getByLabel('Slice number')).toHaveValue('4');
  await page.getByRole('button', { name: 'Next slice', exact: true }).click();
  await expect(page.getByLabel('Slice number')).toHaveValue('5');
  await page.getByLabel('Image pane 1.', { exact: false }).focus();
  await page.keyboard.press('End');
  await expect(page.getByLabel('Slice number')).toHaveValue('7');
  await expect(page.getByRole('button', { name: 'Next slice', exact: true })).toBeDisabled();
  await page.getByLabel('Layout').selectOption('grid-4');
  await expect(page.getByRole('region', { name: 'Pane 4', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'MPR', exact: true }).click();
  await expect(page.getByText('axial · reconstruction')).toBeVisible();
  await expect(page.getByText('sagittal · reconstruction')).toBeVisible();
  await expect(page.getByText('coronal · reconstruction')).toBeVisible();
  await expect(page.locator('.pane-status')).toHaveCount(0);
  // Regression: clicking outside the image used to leave the shared crosshair
  // outside the volume even though each individual plane clamped its camera.
  await page.getByRole('button', { name: 'Crosshair', exact: true }).click();
  await page.getByLabel('Image pane 1.', { exact: false }).click({ position: { x: 2, y: 100 } });
  await expect
    .poll(() =>
      page.locator('.crosshair').evaluateAll((elements) =>
        elements.every((svg) => {
          const circle = svg.querySelector('circle')!;
          const bounds = svg.getBoundingClientRect();
          return (
            Number(circle.getAttribute('cx')) >= 0 &&
            Number(circle.getAttribute('cx')) <= bounds.width &&
            Number(circle.getAttribute('cy')) >= 0 &&
            Number(circle.getAttribute('cy')) <= bounds.height
          );
        }),
      ),
    )
    .toBe(true);

  await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByLabel('Export width').fill('800');
  await page.getByLabel('Lock aspect ratio').uncheck();
  await page.getByLabel('Export height').fill('600');
  await refreshPreview(page);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download image' }).click();
  const d = await download;
  expect(d.suggestedFilename()).toBe('mri-view.png');
  const image = await readFile((await d.path())!);
  expect([image.readUInt32BE(16), image.readUInt32BE(20)]).toEqual([800, 600]);
  await expectImagePixels(page, image);
  const regions = await page.locator('.imaging-canvas').evaluateAll((elements) => {
    const bounds = document.querySelector('.workspace')!.getBoundingClientRect();
    return elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        x: (rect.left - bounds.left) / bounds.width,
        y: (rect.top - bounds.top) / bounds.height,
        width: rect.width / bounds.width,
        height: rect.height / bounds.height,
      };
    });
  });
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByLabel(/^Capture/).selectOption('workspace');
  await page.getByLabel(/^Format/).selectOption('jpeg');
  await page.getByRole('button', { name: '2×', exact: true }).click();
  await refreshPreview(page);
  const workspaceDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download image' }).click();
  const jpeg = await workspaceDownload;
  expect(jpeg.suggestedFilename()).toBe('mri-view.jpg');
  await expectImagePixels(page, await readFile((await jpeg.path())!), regions);
  // Export cleanup must leave the viewer's shared volume and engine usable.
  await page.getByLabel('Image pane 1.', { exact: false }).focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.pane-status')).toHaveCount(0);
  for (const canvas of await page.locator('.imaging-canvas canvas').all()) {
    const pixels = await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL());
    await expectImagePixels(page, Buffer.from(pixels.split(',')[1], 'base64'));
  }
  expect(external).toEqual([]);
});

async function expectImagePixels(
  page: Page,
  image: Buffer,
  regions = [{ x: 0, y: 0, width: 1, height: 1 }],
) {
  const litFractions = await page.evaluate(
    async ({ base64, regions }) => {
      const blob = new Blob([Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))]);
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      return regions.map((region) => {
        const pixels = context.getImageData(
          Math.round(region.x * canvas.width),
          Math.round(region.y * canvas.height),
          Math.round(region.width * canvas.width),
          Math.round(region.height * canvas.height),
        ).data;
        let lit = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i] > 30 && pixels[i + 1] > 30 && pixels[i + 2] > 30) lit++;
        }
        return lit / (pixels.length / 4);
      });
    },
    { base64: image.toString('base64'), regions },
  );
  for (const litFraction of litFractions) expect(litFraction).toBeGreaterThan(0.05);
}

test('MPR export preserves every pane when rendered again', async ({ page }) => {
  test.slow();
  await page.goto('/');
  await page.getByLabel('Open DICOM files').setInputFiles(files);
  await expect(page.getByLabel('Slice number')).toHaveValue('4');
  await page.getByRole('button', { name: 'MPR', exact: true }).click();
  await expect(page.locator('.pane-status')).toHaveCount(0);
  await expect(page.getByText('coronal · reconstruction')).toBeVisible();
  for (const index of [1, 2, 3]) {
    await page.getByLabel(`Image pane ${index}.`, { exact: false }).focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('.pane-status')).toHaveCount(0);
  }
  // Snap the shared crosshair to each plane's slice grid before comparing pixels.
  for (const index of [1, 2, 3]) {
    await page.getByLabel(`Image pane ${index}.`, { exact: false }).focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('.pane-status')).toHaveCount(0);
    await page.keyboard.press('ArrowUp');
    await expect(page.locator('.pane-status')).toHaveCount(0);
  }
  await page.getByLabel('Image pane 1.', { exact: false }).focus();
  const pixels = () =>
    page
      .locator('.imaging-canvas canvas')
      .evaluateAll((elements) =>
        Promise.all(
          elements.map(async (element) =>
            Array.from(
              new Uint8Array(
                await crypto.subtle.digest(
                  'SHA-256',
                  new TextEncoder().encode((element as HTMLCanvasElement).toDataURL()),
                ),
              ),
            ).join(','),
          ),
        ),
      );
  // Let scheduled renders finish before capturing the reference pixels.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const before = await pixels();
  const positions = await page.locator('.pane-bottom').allTextContents();
  for (const scope of ['active', 'workspace']) {
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    await page.getByLabel(/^Capture/).selectOption(scope);
    await page.getByRole('button', { name: '2×', exact: true }).click();
    await refreshPreview(page);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download image' }).click();
    await download;
    expect(await pixels()).toEqual(before);
    expect(await page.locator('.pane-bottom').allTextContents()).toEqual(positions);
    // Repaint each pane without changing its final slice.
    for (const index of [1, 2, 3]) {
      await page.getByLabel(`Image pane ${index}.`, { exact: false }).focus();
      await page.keyboard.press('ArrowDown');
      await expect(page.locator('.pane-status')).toHaveCount(0);
      await page.keyboard.press('ArrowUp');
      await expect(page.locator('.pane-status')).toHaveCount(0);
    }
    await expect.poll(pixels).toEqual(before);
    await page.getByLabel('Image pane 1.', { exact: false }).focus();
  }
});

for (const mode of ['stack', 'MPR', 'single MPR']) {
  test(`window resize preserves slices and navigation in ${mode}`, async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Open DICOM files').setInputFiles(files);
    await expect(page.getByLabel('Slice number')).toHaveValue('4');
    if (mode !== 'stack') {
      await page.getByRole('button', { name: 'MPR', exact: true }).click();
      await expect(page.getByText('coronal · reconstruction')).toBeVisible();
      await expect(page.locator('.pane-status')).toHaveCount(0);
      if (mode === 'single MPR') await page.getByLabel('Layout').selectOption('single');
    }
    const settle = async () => {
      await expect(page.locator('.pane-status')).toHaveCount(0);
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
    };
    // Move away from the initial slices and align all reconstructed planes to
    // the slice grid before recording their rendered images.
    const paneCount = mode === 'MPR' ? 3 : 1;
    for (let index = 1; index <= paneCount; index++) {
      await page.getByLabel(`Image pane ${index}.`, { exact: false }).focus();
      await page.keyboard.press('ArrowDown');
      await settle();
    }
    await page.getByRole('button', { name: 'Zoom', exact: true }).click();
    const pane = page.getByLabel('Image pane 1.', { exact: false });
    const rect = (await pane.boundingBox())!;
    const x = rect.x + rect.width / 2,
      y = rect.y + rect.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y - 30, { steps: 3 });
    await page.mouse.up();
    await settle();
    await page.getByLabel('Image pane 1.', { exact: false }).focus();
    const pixels = () =>
      page.locator('.imaging-canvas canvas').evaluateAll((canvases) =>
        Promise.all(
          canvases.map(async (canvas) => {
            const digest = await crypto.subtle.digest(
              'SHA-256',
              new TextEncoder().encode((canvas as HTMLCanvasElement).toDataURL()),
            );
            return Array.from(new Uint8Array(digest)).join(',');
          }),
        ),
      );
    // Record the next slice too, so scrolling after resize must advance from
    // the displayed slice instead of jumping back to stale navigation state.
    await page.keyboard.press('ArrowDown');
    await settle();
    const next = await pixels();
    await page.keyboard.press('ArrowUp');
    await settle();
    const before = await pixels();
    const positions = await page.locator('.pane-bottom').allTextContents();
    for (const size of [
      { width: 1100, height: 800 },
      { width: 1600, height: 1100 },
      { width: 1440, height: 1000 },
    ]) {
      await page.setViewportSize(size);
      await settle();
      // Zoom is relative to the fitted image and can change with aspect ratio.
      const slicePositions = (texts: string[]) => texts.map((text) => text.split('Zoom')[0]);
      expect(slicePositions(await page.locator('.pane-bottom').allTextContents())).toEqual(
        slicePositions(positions),
      );
    }
    // Returning to the original dimensions makes an exact image comparison possible.
    await expect.poll(pixels).toEqual(before);
    expect(await page.locator('.pane-bottom').allTextContents()).toEqual(positions);
    await page.keyboard.press('ArrowDown');
    await settle();
    await expect.poll(pixels).toEqual(next);
  });
}

test('stack exports contain slice pixels in PNG and JPEG', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Open DICOM files').setInputFiles(files);
  await expect(page.locator('.pane-bottom')).toContainText('Slice 4 / 7');
  for (const format of ['png', 'jpeg']) {
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    await page.getByLabel(/^Format/).selectOption(format);
    await refreshPreview(page);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download image' }).click();
    await expectImagePixels(page, await readFile((await (await download).path())!));
  }
});
test('metadata and keyboard focus do not navigate the viewer', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Open DICOM files').setInputFiles(files);
  await expect(page.getByLabel('Slice number')).toHaveValue('4');
  await page.getByRole('button', { name: 'Metadata', exact: true }).click();
  await page.getByLabel('Search tags').fill('Image Position');
  await expect(page.locator('.tag-row')).toContainText('Image Position Patient');
  await expect(page.locator('.tag-row')).toContainText('0\\0\\6');
  await page.keyboard.press('ArrowDown');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.getByLabel('Slice number')).toHaveValue('4');
});

test('ZIP import matches files, deduplicates, and navigates with the network offline', async ({
  page,
  context,
}) => {
  const { ZipWriter, BlobWriter, BlobReader } = await import('@zip.js/zip.js');
  const writer = new ZipWriter(new BlobWriter());
  for (let i = 0; i < 7; i++)
    await writer.add(`nested/${i}`, new BlobReader(new Blob([dicom(i)])), { level: i % 2 ? 6 : 0 });
  const archive = Buffer.from(await (await writer.close()).arrayBuffer());
  await page.goto('/');
  await page
    .getByLabel('Open DICOM ZIP')
    .setInputFiles({ name: 'synthetic.zip', mimeType: 'application/zip', buffer: archive });
  await expect(page.getByLabel('Slice number')).toHaveValue('4');
  const pixels = () =>
    page.locator('.imaging-canvas canvas').evaluate(async (canvas: HTMLCanvasElement) => {
      const digest = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(canvas.toDataURL()),
      );
      return Array.from(new Uint8Array(digest))
        .map((x) => x.toString(16).padStart(2, '0'))
        .join('');
    });
  const fromZip = await pixels();
  await page.getByLabel('Open DICOM files').setInputFiles(files);
  await expect(page.getByText('7 duplicates skipped')).toBeVisible();
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Last slice', exact: true }).click();
  await expect(page.locator('.pane-bottom')).toContainText('Slice 7 / 7');
  await page.getByLabel('Slice number').fill('4');
  await page.getByLabel('Slice number').press('Enter');
  await expect(page.locator('.pane-bottom')).toContainText('Slice 4 / 7');
  expect(await pixels()).toBe(fromZip);
  await page.getByRole('button', { name: 'Remove Synthetic examination' }).click();
  await expect(page.getByText('No series selected').first()).toBeVisible();
});

test('linked panes follow position and retain assignment through layout changes', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('Open DICOM files').setInputFiles([
    ...files,
    ...Array.from({ length: 7 }, (_, i) => ({
      name: `other-${i}`,
      mimeType: 'application/dicom',
      buffer: Buffer.from(dicom(i, { series: 2 })),
    })),
  ]);
  await expect(page.getByLabel('Slice number')).toHaveValue('4');
  await page.getByLabel('Layout').selectOption('columns-2');
  await page.getByLabel('Image pane 2.', { exact: false }).click();
  await page.getByRole('button', { name: 'Open Synthetic volume 2 Axial 1' }).click();
  await expect(page.getByLabel('Slice number')).toHaveValue('4');
  await page.getByRole('button', { name: 'Link pane 1', exact: true }).click();
  await page.getByRole('button', { name: 'Link pane 2', exact: true }).click();
  await page.getByRole('button', { name: 'Last slice', exact: true }).click();
  await expect(page.locator('.pane-bottom').nth(0)).toContainText('Slice 7 / 7');
  await expect(page.locator('.pane-bottom').nth(1)).toContainText('Slice 7 / 7');
  await page.getByLabel('Layout').selectOption('single');
  await page.getByLabel('Layout').selectOption('columns-2');
  await expect(page.locator('.pane-bottom').nth(1)).toContainText('Slice 7 / 7');
  await page.getByLabel('Image pane 1.', { exact: false }).focus();
  await page.keyboard.press('Home');
  await page.keyboard.press('End');
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.pane-bottom').nth(0)).toContainText('Slice 2 / 7');
  await expect(page.locator('.pane-bottom').nth(1)).toContainText('Slice 2 / 7');
});

test('Enhanced MR separates spatial and temporal controls', async ({ page }) => {
  const { enhancedDicom } = await import('../fixtures');
  await page.goto('/');
  await page.getByLabel('Open DICOM files').setInputFiles({
    name: 'enhanced',
    mimeType: 'application/dicom',
    buffer: Buffer.from(enhancedDicom()),
  });
  await expect(page.getByLabel('Slice number')).toHaveValue('2');
  const sequence = page.locator('.series > .foldable-header .foldable-toggle');
  const stack = page.locator('button.stack').first();
  await expect(stack).toHaveAttribute('title', 'Click to open stack');
  await expect(stack).toContainText('Axial · Stack 1');
  await sequence.click();
  await expect(stack).toBeHidden();
  await sequence.focus();
  await page.keyboard.press('Enter');
  await expect(stack).toBeVisible();
  await stack.click();
  await expect(page.locator('.pane-bottom')).toContainText('Slice 2 / 3');
  await page.getByRole('combobox', { name: 'Time', exact: true }).selectOption({ label: '2' });
  await expect(page.locator('.pane-bottom')).toContainText('Slice 2 / 3');
  await page.getByRole('button', { name: 'Last slice', exact: true }).click();
  await expect(page.locator('.pane-bottom')).toContainText('Slice 3 / 3');
  await expect(
    page.getByRole('combobox', { name: 'Time', exact: true }).locator('option:checked'),
  ).toHaveText('2');
});

test('touch slice dragging cancels on pinch, and manual navigation pauses cine', async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.goto('/');
  await page.getByLabel('Open DICOM files').setInputFiles(files);
  await expect(page.locator('.pane-bottom')).toContainText('Slice 4 / 7');
  await page.getByRole('button', { name: 'Close examinations' }).click();
  const canvas = page.getByLabel('Image pane 1.', { exact: false });
  const rect = (await canvas.boundingBox())!;
  const x = rect.x + rect.width / 2,
    y = rect.y + rect.height / 2;
  const touch = await context.newCDPSession(page);
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y, id: 1 }],
  });
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x, y: y - 24, id: 1 }],
  });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('.pane-bottom')).toContainText('Slice 6 / 7');
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x: x - 30, y, id: 1 },
      { x: x + 30, y, id: 2 },
    ],
  });
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [
      { x: x - 60, y: y - 50, id: 1 },
      { x: x + 60, y: y - 50, id: 2 },
    ],
  });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('.pane-bottom')).toContainText('Slice 6 / 7');
  await page.getByRole('button', { name: 'Play cine' }).click();
  await expect(page.getByRole('button', { name: 'Pause cine' })).toBeVisible();
  await page.getByRole('button', { name: 'First slice', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play cine' })).toBeVisible();
  await expect(page.locator('.pane-bottom')).toContainText('Slice 1 / 7');
});

test('preview refresh waits for encoding beyond the default assertion timeout', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('Open DICOM files').setInputFiles(files);
  await expect(page.getByLabel('Slice number')).toHaveValue('4');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await expect(page.locator('.capture-preview img')).toBeVisible();
  const previous = await page.locator('.capture-preview img').getAttribute('src');
  await page.evaluate(() => {
    const original = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback, ...args) {
      HTMLCanvasElement.prototype.toBlob = original;
      original.call(this, (blob) => setTimeout(() => callback(blob), 6000), ...args);
    };
  });
  await refreshPreview(page);
  await expect(page.locator('.capture-preview img')).not.toHaveAttribute('src', previous!);
});
