// Opt-in, local-only verification. No screenshots, traces, metadata, or filenames are emitted.
import { chromium } from 'playwright';
import { readdir, open, readFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Writable } from 'node:stream';
import { ZipWriter, BlobReader } from '@zip.js/zip.js';
import path from 'node:path';
const root = path.resolve(process.argv[2] ?? 'local-data/dicom');
const baseURL = process.env.VIEWER_URL ?? 'http://127.0.0.1:4173';
const files = [];
async function visit(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, e.name);
    if (e.isDirectory()) await visit(file);
    else {
      const f = await open(file, 'r');
      try {
        const buffer = Buffer.alloc(132);
        await f.read(buffer, 0, 132, 0);
        if (buffer.toString('ascii', 128, 132) === 'DICM') files.push(file);
      } finally {
        await f.close();
      }
    }
  }
}
await visit(root);
let temporary;
let selection = files;
if (process.argv.includes('--zip')) {
  await mkdir('local-data/verification', { recursive: true });
  temporary = await mkdtemp('local-data/verification/zip-');
  const archive = path.resolve(temporary, 'sample.zip');
  const writer = new ZipWriter(Writable.toWeb(createWriteStream(archive)));
  for (let i = 0; i < files.length; i++)
    await writer.add(`dicom/${i}`, new BlobReader(new Blob([await readFile(files[i])])), {
      level: 0,
    });
  await writer.close();
  selection = [archive];
}
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  let external = 0;
  page.on('pageerror', () => errors.push('runtime'));
  page.on('request', (r) => {
    if (
      !r.url().startsWith(baseURL) &&
      !r.url().startsWith('blob:') &&
      !r.url().startsWith('data:')
    )
      external++;
  });
  await page.goto(baseURL);
  const start = performance.now();
  await page.getByLabel('Open DICOM files').setInputFiles(selection);
  await page.waitForFunction(
    () => document.querySelector('.import-status')?.textContent?.includes('frames imported'),
    {},
    { timeout: 120000 },
  );
  await page.waitForFunction(
    () => Number(document.querySelector('input[aria-label="Slice number"]')?.value) > 0,
  );
  const importMs = Math.round(performance.now() - start);
  const series = await page.locator('.series').count();
  const sets = await page.locator('.series-set').count();
  let decoded = 0;
  for (let s = 0; s < sets; s++) {
    await page.locator('.series-set').nth(s).click();
    await page.waitForFunction(
      () => !document.querySelector('.pane-status')?.textContent?.includes('Loading'),
    );
    const total = Number(await page.locator('.slice-slider').getAttribute('max')) + 1;
    for (let i = 1; i <= total; i++) {
      await page.getByLabel('Slice number').fill(String(i));
      await page.getByLabel('Slice number').press('Enter');
      await page.waitForFunction(
        (index) =>
          document.querySelector('.pane-bottom')?.textContent?.startsWith(`Slice ${index} /`),
        i,
        { timeout: 15000 },
      );
      if (await page.getByRole('button', { name: 'Retry', exact: true }).count())
        throw new Error('decode failed');
      decoded++;
    }
  }
  await page
    .locator('.series-set')
    .nth(Math.min(3, sets - 1))
    .click();
  await page.getByRole('button', { name: 'MPR', exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelectorAll('.pane-bottom').length === 3 &&
      Array.from(document.querySelectorAll('.pane-bottom')).every((e) =>
        /^Plane position \d/.test(e.textContent),
      ),
    {},
    { timeout: 120000 },
  );
  if (errors.length || external) throw new Error('runtime or external request');
  console.log(
    JSON.stringify({
      source: process.argv.includes('--zip') ? 'zip' : 'files',
      files: files.length,
      series,
      displaySets: sets,
      decoded,
      importMs,
      mprPlanes: 3,
      externalRequests: external,
      runtimeErrors: errors.length,
    }),
  );
} catch {
  console.error('Private sample verification failed. No private artifacts were recorded.');
  process.exitCode = 1;
} finally {
  await browser.close();
  if (temporary) await rm(temporary, { recursive: true });
}
