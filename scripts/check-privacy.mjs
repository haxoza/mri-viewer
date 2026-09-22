import { execFileSync } from 'node:child_process';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
const files = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { encoding: 'utf8' },
)
  .split('\0')
  .filter(Boolean);
let failures = 0;
for (const file of files) {
  if (
    /(^|\/)(local-data|exports|private)(\/|$)|\.(dcm|dicom|ima|nii|nii\.gz|nrrd|nhdr|mha|mhd|mgz|mgh|zip|pdf)$/i.test(
      file,
    ) ||
    /(^|\/)DICOMDIR$/i.test(file)
  ) {
    console.error('Private medical path is tracked or eligible for tracking.');
    failures++;
    continue;
  }
  const data = await readFile(file).catch(() => null);
  if (!data) continue;
  if (data.length >= 132 && data.toString('ascii', 128, 132) === 'DICM') {
    console.error('DICOM content detected outside ignored private storage.');
    failures++;
  }
}
async function inspectDist(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (['local-data', 'exports', 'private'].includes(e.name)) {
        failures++;
        console.error('Private directory in build.');
      }
      await inspectDist(p);
    } else {
      const b = await readFile(p);
      if (b.length >= 132 && b.toString('ascii', 128, 132) === 'DICM') {
        failures++;
        console.error('DICOM content in build.');
      }
    }
  }
}
if (await stat('dist').catch(() => null)) await inspectDist('dist');
if (failures) process.exit(1);
console.log(
  'Privacy guard passed: no medical files are tracked, eligible for tracking, or included in dist.',
);
