// Opt-in local verification: no identifiers, filenames, screenshots, traces or metadata dumps.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import dicomParser from 'dicom-parser';
import { chromium } from 'playwright';
const root = process.argv[2];
const names = ['t2_tse_cor_FOV250', 't2_tse_tra_FOV250'];
if (process.argv.includes('--three')) names.push('t1_tse_fs_cor_CM');
const series = names.map(() => []);
const baseURL = process.env.VIEWER_URL ?? 'http://127.0.0.1:4173';
let browser;
let stage = 'scan';
function ensure(condition) {
  if (!condition) throw new Error('Verification failed');
}
async function visit(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await visit(file);
      continue;
    }
    const bytes = await readFile(file);
    if (bytes.length < 132 || bytes.toString('ascii', 128, 132) !== 'DICM') continue;
    const data = dicomParser.parseDicom(bytes, { untilTag: 'x7fe00010' });
    const index = names.indexOf(data.string('x0008103e')?.trim());
    if (index < 0) continue;
    const numbers = (tag) => data.string(tag)?.split('\\').map(Number);
    series[index].push({
      file,
      rows: data.uint16('x00280010'),
      columns: data.uint16('x00280011'),
      spacing: numbers('x00280030'),
      thickness: numbers('x00180050')?.[0],
      position: numbers('x00200032'),
      orientation: numbers('x00200037'),
      study: data.string('x0020000d'),
      reference: data.string('x00200052'),
    });
  }
}
try {
  ensure(root);
  await visit(root);
  stage = 'pair counts';
  const first = series[0][0];
  ensure(series.every((s) => s.length === 60));
  stage = 'dimensions and geometry';
  for (const [index, s] of series.entries())
    for (const f of s) {
      ensure(
        (index >= 2 || f.rows === 704) &&
          (index >= 2 || f.columns === 704) &&
          f.spacing.every((v) => (index >= 2 ? v > 0 : Math.abs(v - 0.355) < 0.001)),
      );
      ensure(
        f.thickness === 3 &&
          f.study &&
          f.study === first.study &&
          f.reference &&
          f.reference === first.reference,
      );
      const [a, b, c, d, e, g] = f.orientation;
      const n = [b * g - c * e, c * d - a * g, a * e - b * d];
      ensure(Math.max(...n.map(Math.abs)) < 0.99999);
    }
  stage = 'browser launch';
  browser = await chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  let errors = 0,
    external = 0;
  page.on('pageerror', () => errors++);
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (!url.startsWith(baseURL) && !url.startsWith('blob:') && !url.startsWith('data:')) {
      external++;
      await route.abort();
    } else await route.continue();
  });
  stage = 'browser import';
  await page.goto(baseURL);
  await page.getByLabel('Open DICOM files').setInputFiles(series.flat().map((f) => f.file));
  await page.waitForFunction(
    (count) =>
      document.querySelector('.import-status')?.textContent?.includes(`${count} frames imported`),
    names.length * 60,
    { timeout: 120000 },
  );
  stage = 'native interactions';
  await page
    .getByRole('combobox', { name: 'Layout', exact: true })
    .selectOption(names.length === 3 ? 'left-3' : 'columns-2');
  for (let i = 0; i < names.length; i++) {
    await page.getByLabel(`Image pane ${i + 1}.`, { exact: false }).click();
    await page.getByRole('button', { name: new RegExp(`^Open ${names[i]}`) }).click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('.pane-position')[n]?.textContent?.includes('/ 60'),
      i,
    );
  }
  await page.getByRole('button', { name: 'Native links', exact: true }).click();
  for (const i of names.map((_, i) => i + 1))
    await page.getByRole('button', { name: `Link pane ${i}`, exact: true }).click();
  await page.getByRole('button', { name: 'Crosshair', exact: true }).click();
  for (const i of names.map((_, i) => i + 1)) {
    const pane = page.getByLabel(`Image pane ${i}.`, { exact: false });
    const box = await pane.boundingBox();
    await pane.click({ position: { x: box.width * 0.5, y: box.height * 0.5 } });
    await page.waitForFunction(
      (count) =>
        Array.from(document.querySelectorAll('.native-status')).filter((e) =>
          e.textContent.includes('offset'),
        ).length === count,
      names.length,
    );
    await pane.press('ArrowDown');
    await page.waitForFunction(
      () =>
        !Array.from(document.querySelectorAll('.pane-status')).some((e) =>
          e.textContent.includes('Loading'),
        ),
    );
  }
  ensure((await page.locator('.native-crosshair circle').count()) === names.length);
  ensure((await page.locator('.native-crosshair line').count()) === (names.length === 3 ? 4 : 2));
  if (names.length === 3)
    ensure(
      (await page.locator('.native-reference-status').filter({ hasText: 'same plane' }).count()) ===
        2,
    );
  ensure(errors === 0 && external === 0);
  console.log(
    `Private sample verified: ${names.length} native stacks; shared study/reference, oblique geometry. Click/scroll and crosshair/reference checks passed. No external requests or runtime errors.`,
  );
} catch {
  console.error(
    `Private native verification failed at ${stage}. No private artifacts were recorded.`,
  );
  process.exitCode = 1;
} finally {
  await browser?.close();
}
