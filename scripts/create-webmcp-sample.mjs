// Node.js 24 can import this TypeScript fixture using built-in type stripping.
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { dicom } from '../tests/fixtures.ts';
const parent = resolve('local-data');
await mkdir(parent, { recursive: true });
const directory = await mkdtemp(join(parent, 'synthetic-webmcp-'));
for (let i = 0; i < 7; i++) {
  await writeFile(join(directory, `slice-${i + 1}.dcm`), dicom(i), { flag: 'wx' });
}
console.log(`Synthetic sample created: ${directory}`);
console.log('Use Open folder in the viewer to load it. These generated files contain no patient data.');
