import { expect, test } from '@playwright/test';
import { dicom } from '../fixtures';

const files = Array.from({ length: 7 }, (_, i) => ({
  name: `slice-${i}.dcm`,
  mimeType: 'application/dicom',
  buffer: Buffer.from(dicom(i)),
}));

for (const width of [1024, 820, 1100, 1200]) {
  test(`Toolbar popovers remain reachable after wrapping at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await page.getByLabel('Open DICOM files').setInputFiles(files);
    await expect(page.getByLabel('Slice number')).toHaveValue('4');

    const trigger = page.getByLabel('Marks', { exact: true });
    const popover = page.locator('.toolbar-marks .toolbar-popover-content');
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(popover).toBeVisible();
    const expectInViewport = async (element: typeof popover, viewportWidth: number) => {
      await expect
        .poll(async () => {
          const bounds = (await element.boundingBox())!;
          return bounds.x >= 0 && bounds.x + bounds.width <= viewportWidth;
        })
        .toBe(true);
    };
    await expectInViewport(popover, width);
    const resizedWidth = width === 1024 ? 1200 : 1024;
    await page.setViewportSize({ width: resizedWidth, height: 900 });
    await expectInViewport(popover, resizedWidth);

    await page.getByLabel('Mark color', { exact: true }).selectOption('cyan');
    await expect(trigger).toContainText('cyan');
    await page.keyboard.press('Escape');
    await expect(popover).toBeHidden();
    await expect(trigger).toBeFocused();

    const screenshot = page.getByRole('button', { name: 'Screenshot view', exact: true });
    const menu = page.getByRole('menu', { name: 'Screenshot view' });
    await screenshot.focus();
    await page.keyboard.press('ArrowDown');
    await expect(menu).toBeVisible();
    await expectInViewport(menu, resizedWidth);
    await expect(page.getByRole('menuitem', { name: 'Active pane' })).toBeFocused();
    await page.setViewportSize({ width, height: 900 });
    await expectInViewport(menu, width);
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitem', { name: 'Whole workspace' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(screenshot).toBeFocused();
  });
}
