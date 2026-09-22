import { describe, expect, it } from 'vitest';
import { buildCatalog, allSets } from '../src/imaging/catalog';
import { nearestLinked, volumeProblem } from '../src/imaging/geometry';
import { frame } from './fixtures';
const stack = (indices: number[]) => allSets(buildCatalog(indices.map((i) => frame(i))))[0];
describe('catalog and patient-space geometry', () => {
  it('groups by identity, splits localizers and dimensions, and sorts spatially', () => {
    const frames = [
      frame(2),
      frame(0),
      frame(1),
      frame(4, { orientation: [0, 1, 0, 0, 0, 1] }),
      frame(5, { temporal: '2' }),
      frame(6, { echo: '2' }),
    ];
    const studies = buildCatalog(frames);
    expect(studies).toHaveLength(1);
    expect(studies[0].series).toHaveLength(1);
    const sets = allSets(studies);
    expect(sets).toHaveLength(4);
    expect(sets[0].frames.map((f) => f.instance)).toEqual([0, 1, 2]);
    expect(volumeProblem(sets[0])).toBeUndefined();
  });
  it('keeps index-only stacks available and rejects unsafe volumes', () => {
    const missing = allSets(
      buildCatalog([frame(2, { position: undefined }), frame(1, { position: undefined })]),
    )[0];
    expect(missing.geometry).toBe(false);
    expect(missing.warning).toContain('Spatial order unavailable');
    expect(volumeProblem(missing)).toBeDefined();
    expect(volumeProblem(stack([0, 1, 3]))).toContain('nonuniform');
  });
  it('links physical positions across different spacing and flags uncovered positions', () => {
    const a = stack([0, 1, 2, 3, 4]);
    const b = allSets(
      buildCatalog([0, 1, 2].map((i) => frame(i, { seriesUID: 'other', position: [0, 0, i * 4] }))),
    )[0];
    expect(nearestLinked(a, b, [0, 0, 4]).index).toBe(1);
    expect(nearestLinked(a, b, [0, 0, 20]).reason).toBe('Out of range');
    b.frames[0].frameOfReference = 'different';
    expect(nearestLinked(a, b, [0, 0, 4]).reason).toContain('frame of reference');
  });
});

it('does not claim a spatial match for duplicate slice positions', () => {
  const source = stack([0, 1, 2]);
  const target = allSets(buildCatalog([frame(0), frame(1, { position: [0, 0, 0] }), frame(2)]))[0];
  expect(nearestLinked(source, target, [0, 0, 0]).reason).toContain('Repeated');
});
