import { expect, it } from 'vitest';
import { BlobReader, BlobWriter, ZipWriter } from '@zip.js/zip.js';
import { openZip, extract } from '../src/imaging/sources/zip';
import { dicom } from './fixtures';
it('reads stored and deflated extensionless entries by random access', async () => {
  const w = new ZipWriter(new BlobWriter());
  const original = dicom(0);
  await w.add('nested/001', new BlobReader(new Blob([original])), { level: 0 });
  await w.add('nested/002', new BlobReader(new Blob([dicom(1)])), { level: 6 });
  const { reader, entries } = await openZip(await w.close());
  expect(entries).toHaveLength(2);
  expect(new Uint8Array(await (await extract(entries[0])).arrayBuffer())).toEqual(original);
  expect((await extract(entries[1])).size).toBe(dicom(1).length);
  await reader.close();
});
