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
test('local import, navigation, comparison, MPR, and exact-size export', async ({ page }) => {
  const external: string[] = [];
  page.on('request', (r) => {
    if (
      !r.url().startsWith('http://127.0.0.1:4173') &&
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
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download image' }).click();
  const d = await download;
  expect(d.suggestedFilename()).toBe('mri-view.png');
  const image = await readFile((await d.path())!);
  expect([image.readUInt32BE(16), image.readUInt32BE(20)]).toEqual([800, 600]);
  expect(external).toEqual([]);
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
