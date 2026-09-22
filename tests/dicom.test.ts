import { expect, it } from 'vitest';
import { indexDataset, readHeader, tags } from '../src/imaging/formats/dicom';
import { dicom } from './fixtures';
it('indexes extensionless Part 10 MR with pixel interpretation and geometry', async () => {
  const d = await readHeader(new Blob([dicom(3, { signed: true, inverted: true })]));
  const [f] = indexDataset(d, 'test');
  expect(f.position).toEqual([0, 0, 6]);
  expect(f.signed).toBe(true);
  expect(f.photometric).toBe('MONOCHROME1');
  expect(f.intercept).toBe(-100);
  expect(f.rows).toBe(32);
  expect(tags(d).find((t) => t.name === 'Rows')?.value).toBe('32');
});
it('reports non-DICOM content without treating it as an image', async () => {
  await expect(readHeader(new Blob(['not dicom']))).rejects.toThrow('non-DICOM');
});

it('keeps Enhanced MR spatial slices together while separating time dimensions', async () => {
  const { enhancedDicom } = await import('./fixtures');
  const { buildCatalog, allSets } = await import('../src/imaging/catalog');
  const frames = indexDataset(await readHeader(new Blob([enhancedDicom()])), 'enhanced');
  const sets = allSets(buildCatalog(frames));
  expect(sets).toHaveLength(2);
  expect(sets.map((s) => s.frames.length)).toEqual([3, 3]);
  expect(sets[0].positions).toEqual([0, 2, 4]);
  expect(frames[4].frameTime).toBe(80);
});
