import { expect, test, type Page } from '@playwright/test';
import { dicom } from '../fixtures';
const files = [
  ...Array.from({ length: 7 }, (_, i) => ({
    name: `a-${i}`,
    mimeType: 'application/dicom',
    buffer: Buffer.from(
      dicom(i, {
        series: 1,
        orientation: [1, 0, 0, 0, 0.8, 0.6],
        position: [0, -0.6 * i * 2, 0.8 * i * 2],
      }),
    ),
  })),
  ...Array.from({ length: 9 }, (_, i) => ({
    name: `b-${i}`,
    mimeType: 'application/dicom',
    buffer: Buffer.from(
      dicom(i, {
        series: 2,
        orientation: [1, 0, 0, 0, 0.6, -0.8],
        position: [0, 0.8 * i * 4 - 0.6 * 31, 0.6 * i * 4 + 0.8 * 31],
      }),
    ),
  })),
  ...Array.from({ length: 7 }, (_, i) => ({
    name: `c-${i}`,
    mimeType: 'application/dicom',
    buffer: Buffer.from(dicom(i, { series: 3, frameOfReference: '1.2.3.777' })),
  })),
];
const pane = (page: Page, i: number) =>
  page.getByRole('region', { name: `Pane ${i}`, exact: true });
const image = (page: Page, i: number) => page.getByLabel(`Image pane ${i}.`, { exact: false });
async function ready(page: Page) {
  await expect(page.locator('.pane-status').filter({ hasText: 'Loading' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
}
async function setup(page: Page) {
  await page.goto('/');
  await page.getByLabel('Open DICOM files').setInputFiles(files);
  await expect(page.getByLabel('Slice number')).toHaveValue('4');
  await page.getByRole('combobox', { name: 'Layout', exact: true }).selectOption('columns-2');
  await image(page, 2).click();
  await page.getByRole('button', { name: /^Open Synthetic volume 2 / }).click();
  await expect(pane(page, 2).locator('.pane-position')).toContainText('5 / 9');
  await page.getByRole('button', { name: 'Native links', exact: true }).click();
  for (const i of [1, 2])
    await page.getByRole('button', { name: `Link pane ${i}`, exact: true }).click();
  await page.getByRole('button', { name: 'Crosshair', exact: true }).click();
  const box = (await image(page, 1).boundingBox())!;
  await image(page, 1).click({ position: { x: box.width / 2, y: box.height / 2 } });
  await ready(page);
}
async function gateRenders(page: Page, indices: number[]) {
  await page.evaluate((indices) => {
    const gates = new Map<number, { release: () => void; rendered: () => boolean }>();
    for (const index of indices) {
      const element = document.querySelectorAll('.imaging-canvas')[index];
      const dispatch = element.dispatchEvent.bind(element);
      let blocked = true;
      let rendered: Event | undefined;
      element.dispatchEvent = (event) => {
        if (blocked && event.type === 'CORNERSTONE_IMAGE_RENDERED') {
          rendered = event;
          return true;
        }
        return dispatch(event);
      };
      gates.set(index, {
        release: () => {
          blocked = false;
          if (rendered) dispatch(rendered);
        },
        rendered: () => !!rendered,
      });
    }
    (window as any).__nativeRenderGates = gates;
  }, indices);
}
async function waitForGatedRender(page: Page, index: number) {
  await expect
    .poll(() => page.evaluate((i) => (window as any).__nativeRenderGates.get(i).rendered(), index))
    .toBe(true);
}
async function releaseRender(page: Page, index: number) {
  await page.evaluate((i) => (window as any).__nativeRenderGates.get(i).release(), index);
}
test('oblique native click, geometric scroll, independent controls, unlink and parallel fallback', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await setup(page);
  await expect(pane(page, 2).locator('.pane-position')).toContainText('5 / 9');
  await expect(page.locator('.native-crosshair circle')).toHaveCount(2);
  await expect(page.locator('.native-crosshair line')).toHaveCount(2);
  await expect(pane(page, 2).locator('.native-status')).toContainText('nearest-slice offset');
  const yBefore = Number(
    await pane(page, 2).locator('.native-crosshair circle').getAttribute('cy'),
  );
  await image(page, 1).press('ArrowDown');
  await ready(page);
  await expect(pane(page, 1).locator('.pane-position')).toContainText('5 / 7');
  // Orthogonal in patient space: source scrolling changes the target crosshair, not its slice index.
  await expect(pane(page, 2).locator('.pane-position')).toContainText('5 / 9');
  await expect
    .poll(async () =>
      Number(await pane(page, 2).locator('.native-crosshair circle').getAttribute('cy')),
    )
    .not.toBe(yBefore);
  const independent = await pane(page, 2).locator('.pane-window').textContent();
  await page.getByRole('button', { name: 'Zoom', exact: true }).click();
  const box = (await image(page, 1).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 30);
  await page.mouse.up();
  await expect(pane(page, 1).locator('.pane-window')).not.toContainText('Zoom 100%');
  await page.getByRole('button', { name: 'Window', exact: true }).click();
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2 - 10);
  await page.mouse.up();
  await image(page, 1).press('ArrowUp');
  await ready(page);
  await expect(pane(page, 2).locator('.pane-window')).toHaveText(independent!);
  const camera = await pane(page, 1).locator('.pane-window').textContent();
  await image(page, 1).press('ArrowDown');
  await ready(page);
  await expect(pane(page, 1).locator('.pane-window')).toHaveText(camera!);
  await page.getByRole('button', { name: 'Link pane 2', exact: true }).click();
  await image(page, 2).press('Home');
  await ready(page);
  await expect(pane(page, 2).locator('.native-crosshair')).toHaveCount(0);
  await expect(pane(page, 1).locator('.pane-position')).toContainText('5 / 7');
  await page.getByRole('button', { name: 'Link pane 2', exact: true }).click();
  await ready(page);
  await page.getByRole('button', { name: 'Native links', exact: true }).click();
  await expect(page.getByText('Stacks are not parallel', { exact: true })).toBeVisible();
  await expect(page.locator('.native-crosshair')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('native links survive every layout, reject foreign coordinates, and coexist with MPR', async ({
  page,
}) => {
  await setup(page);
  for (const layout of [
    'rows-2',
    'left-3',
    'top-3',
    'grid-4',
    'columns-4',
    'rows-4',
    'single',
    'columns-2',
  ]) {
    await page.getByRole('combobox', { name: 'Layout', exact: true }).selectOption(layout);
    await ready(page);
    await expect(pane(page, 1).locator('.native-crosshair circle')).toHaveCount(1);
    if (layout !== 'single')
      await expect(pane(page, 2).locator('.native-crosshair circle')).toHaveCount(1);
  }
  await page.getByRole('combobox', { name: 'Layout', exact: true }).selectOption('left-3');
  await image(page, 3).click();
  await page.getByRole('button', { name: /^Open Synthetic volume 3 / }).click();
  await ready(page);
  await page.getByRole('button', { name: 'Link pane 3', exact: true }).click();
  await image(page, 1).press('ArrowDown');
  await ready(page);
  await expect(pane(page, 3).locator('.native-status')).toContainText('Incompatible coordinates');
  await expect(pane(page, 3).locator('.native-crosshair')).toHaveCount(0);
  await image(page, 1).press('ArrowUp');
  await ready(page);
  await page.getByRole('button', { name: 'MPR', exact: true }).click();
  await expect(page.locator('.pane-description').filter({ hasText: 'reconstruction' })).toHaveCount(
    3,
  );
  await ready(page);
  await expect(page.locator('.crosshair:not(.native-crosshair)')).toHaveCount(3);
  await page.getByRole('button', { name: 'Crosshair', exact: true }).click();
  await image(page, 1).click();
  await ready(page);
});

test('coverage is explicit and rapid manual navigation wins over linked requests', async ({
  page,
}) => {
  await setup(page);
  // The second acquisition extends beyond the first stack's last acquired plane.
  const box = (await image(page, 2).boundingBox())!;
  await image(page, 2).click({ position: { x: box.width / 2, y: box.height / 2 } });
  await ready(page);
  await expect(pane(page, 1).locator('.native-status')).toContainText('Outside acquired coverage');
  await expect(pane(page, 1).locator('.pane-position')).toContainText('7 / 7');
  await expect(pane(page, 1).locator('.native-crosshair .approximate')).toHaveCount(1);
  // Multiple requests within one render frame exercise coalescing and latest intent.
  await image(page, 1).evaluate((element) => {
    for (const key of ['Home', 'End', 'Home'])
      element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
  await ready(page);
  await expect(pane(page, 1).locator('.pane-position')).toContainText('1 / 7');
  await expect(pane(page, 1).locator('.native-status')).toContainText('offset 0.00 mm');
  await expect(pane(page, 1).locator('.native-status')).not.toContainText('Outside');
  // Keep MPR usable while native links remain enabled; no native state replaces its crosshair.
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Download image', exact: true })).toBeEnabled();
  await expect(page.getByRole('dialog').getByRole('alert')).toHaveCount(0);
});

test('off-center clicks select the actual nearest native slice and outside-FOV points are flagged', async ({
  page,
}) => {
  await setup(page);
  const cross = pane(page, 1).locator('.native-crosshair circle');
  const line = pane(page, 1).locator('.native-crosshair line');
  // The fixture's full-width intersection spans 32 mm along the common row axis.
  const scale =
    Math.abs(Number(await line.getAttribute('x2')) - Number(await line.getAttribute('x1'))) / 32;
  const x = Number(await cross.getAttribute('cx')),
    y = Number(await cross.getAttribute('cy'));
  await image(page, 1).click({ position: { x, y: y + 8 * scale } });
  await ready(page);
  await expect(pane(page, 2).locator('.pane-position')).toContainText('7 / 9');
  await page.getByRole('button', { name: 'Pan', exact: true }).click();
  const targetCross = await pane(page, 2).locator('.native-crosshair circle').getAttribute('cx');
  const box = (await image(page, 1).boundingBox())!;
  await page.mouse.move(box.x + x, box.y + y);
  await page.mouse.down();
  await page.mouse.move(box.x + x + 30, box.y + y + 10);
  await page.mouse.up();
  await expect.poll(async () => Number(await cross.getAttribute('cx'))).toBeCloseTo(x + 30, 0);
  await expect(pane(page, 2).locator('.native-crosshair circle')).toHaveAttribute(
    'cx',
    targetCross!,
  );
  await image(page, 2).press('End');
  await ready(page);
  await expect(pane(page, 1).locator('.native-status')).toContainText('Outside acquired coverage');
  await expect(pane(page, 1).locator('.native-crosshair circle')).toHaveCount(0);
});

test('unlinked navigation cannot invalidate an in-flight native leader scroll', async ({
  page,
}) => {
  await setup(page);
  await page.getByRole('combobox', { name: 'Layout', exact: true }).selectOption('left-3');
  await image(page, 3).click();
  await page.getByRole('button', { name: /^Open Synthetic volume 3 / }).click();
  await ready(page);
  await page.evaluate(() => {
    const images = document.querySelectorAll('.imaging-canvas');
    images[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    images[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
  });
  await ready(page);
  await expect(pane(page, 1).locator('.pane-position')).toContainText('7 / 7');
  await expect(pane(page, 3).locator('.pane-position')).toContainText('1 / 7');
  await expect(pane(page, 1).locator('.native-status')).toContainText('offset 0.00 mm');
});

test('relinking during a pending source scroll preserves its requested position', async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(async () => {
    document
      .querySelector('.imaging-canvas')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    const button = document.querySelector<HTMLButtonElement>('[aria-label="Link pane 1"]')!;
    button.click();
    await Promise.resolve();
    button.click();
  });
  await ready(page);
  await expect(pane(page, 1).locator('.pane-position')).toContainText('7 / 7');
});

for (const completed of [false, true])
  test(`hiding a newer native leader restores the ${completed ? 'completed' : 'pending'} surviving scroll`, async ({
    page,
  }) => {
    await setup(page);
    await gateRenders(page, [0, 1]);
    await image(page, 1).press('End');
    await image(page, 2).press('Home');
    await waitForGatedRender(page, 0);
    await waitForGatedRender(page, 1);
    if (completed) {
      await releaseRender(page, 0);
      await expect(pane(page, 1).locator('.pane-position')).toContainText('7 / 7');
    }
    await page.getByRole('combobox', { name: 'Layout', exact: true }).selectOption('single');
    await expect(page.locator('.imaging-canvas')).toHaveCount(1);
    if (!completed) await releaseRender(page, 0);
    await ready(page);
    await expect(pane(page, 1).locator('.pane-position')).toContainText('7 / 7');
    await expect(pane(page, 1).locator('.native-status')).toContainText('offset 0.00 mm');
    await page.getByRole('combobox', { name: 'Layout', exact: true }).selectOption('columns-2');
    await ready(page);
    await expect(pane(page, 1).locator('.pane-position')).toContainText('7 / 7');
    await expect(pane(page, 1).locator('.native-status')).toContainText('offset 0.00 mm');
  });

test('a newer explicit native point wins over a delayed scroll', async ({ page }) => {
  await setup(page);
  await gateRenders(page, [0]);
  await image(page, 1).press('End');
  await waitForGatedRender(page, 0);
  const box = (await image(page, 2).boundingBox())!;
  await image(page, 2).click({ position: { x: box.width / 2, y: box.height / 2 } });
  const chosen = await pane(page, 2).locator('.native-crosshair circle').getAttribute('cy');
  await releaseRender(page, 0);
  await ready(page);
  await expect(pane(page, 2).locator('.native-crosshair circle')).toHaveAttribute('cy', chosen!);
  await expect(pane(page, 2).locator('.native-status')).toContainText('offset 0.00 mm');
  await expect(pane(page, 1).locator('.native-status')).toContainText('Outside acquired coverage');
});

test('unlinking a pending newer leader releases a completed scroll before independent navigation', async ({
  page,
}) => {
  await setup(page);
  await gateRenders(page, [0, 1]);
  await image(page, 1).press('End');
  await image(page, 2).press('Home');
  await waitForGatedRender(page, 0);
  await waitForGatedRender(page, 1);
  await releaseRender(page, 0);
  await expect(pane(page, 1).locator('.pane-position')).toContainText('7 / 7');
  await page.getByRole('button', { name: 'Link pane 2', exact: true }).click();
  await expect(pane(page, 1).locator('.native-status')).toContainText('offset 0.00 mm');
  await image(page, 2).press('End');
  await releaseRender(page, 1);
  await ready(page);
  await expect(pane(page, 2).locator('.pane-position')).toContainText('9 / 9');
  await expect(pane(page, 1).locator('.native-status')).toContainText('offset 0.00 mm');
});

test('enabling native links during a pending scroll initializes its shared point on completion', async ({
  page,
}) => {
  await setup(page);
  await page.getByRole('button', { name: 'Native links', exact: true }).click();
  await gateRenders(page, [0]);
  await image(page, 1).press('End');
  await waitForGatedRender(page, 0);
  await page.getByRole('button', { name: 'Native links', exact: true }).click();
  await releaseRender(page, 0);
  await ready(page);
  await expect(pane(page, 1).locator('.pane-position')).toContainText('7 / 7');
  await expect(pane(page, 1).locator('.native-status')).toContainText('offset 0.00 mm');
});
