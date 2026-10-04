import { describe, expect, it } from 'vitest';
import { allSets, buildCatalog } from '../src/imaging/catalog';
import { nearestLinked } from '../src/imaging/geometry';
import {
  insideNativeImage,
  nativeIntersection,
  nativeReference,
  nearestNative,
  patientToPixel,
  pixelToPatient,
  planeOffset,
  projectToNativePlane,
} from '../src/imaging/nativeGeometry';
import type { Frame, Vec3 } from '../src/imaging/types';
import { frame } from './fixtures';
const stack = (frames: Frame[]) => allSets(buildCatalog(frames))[0];
const axial = stack([0, 1, 2, 3].map((i) => frame(i)));
const coronal = stack(
  [0, 1, 2].map((i) =>
    frame(i, { seriesUID: 'other', orientation: [1, 0, 0, 0, 0, -1], position: [0, i * 3, 10] }),
  ),
);

describe('native series geometry', () => {
  it('selects across nonparallel acquisitions without changing parallel linking', () => {
    expect(nearestLinked(axial, coronal, [4, 4, 4]).reason).toContain('not parallel');
    expect(nearestNative(axial, coronal, [4, 4, 4])).toEqual({
      index: 1,
      offset: 1,
      outside: false,
    });
    expect(nearestNative(axial, coronal, [4, 4.5, 4]).index).toBe(1);
    expect(nearestNative(axial, coronal, [4, 6, 4]).offset).toBe(0);
  });
  it('distinguishes out of stack range and out of image footprint, retaining nearest image', () => {
    expect(nearestNative(axial, coronal, [4, 20, 4])).toEqual({
      index: 2,
      offset: 14,
      outside: true,
    });
    expect(nearestNative(axial, coronal, [100, 3, 4]).outside).toBe(true);
    expect(nearestNative(axial, coronal, [4, 3, 40]).outside).toBe(true);
  });
  it('uses actual oblique planes and anisotropic row/column spacing', () => {
    const f = frame(0, {
      position: [10, -8, 13],
      orientation: [0.8, 0.6, 0, -0.36, 0.48, 0.8],
      spacing: [2, 0.5],
    });
    const p = pixelToPatient(f, 12, 7);
    const pixel = patientToPixel(f, p);
    expect(pixel[0]).toBeCloseTo(12);
    expect(pixel[1]).toBeCloseTo(7);
    const target = stack(
      [0, 1, 2].map((i) => ({
        ...f,
        id: `oblique-${i}`,
        position: f.position!.map((v, k) => v + i * 3 * [0.48, -0.64, 0.6][k]) as Vec3,
      })),
    );
    const q = p.map((v, k) => v + 4 * [0.48, -0.64, 0.6][k]) as Vec3;
    expect(nearestNative(axial, target, q).index).toBe(1);
    expect(nearestNative(axial, target, q).offset).toBeCloseTo(1);
    const projected = projectToNativePlane(target.frames[2], q);
    expect(planeOffset(target.frames[2], projected)).toBeCloseTo(0);
    expect(patientToPixel(f, projected)[0]).toBeCloseTo(12);
    expect(patientToPixel(f, projected)[1]).toBeCloseTo(7);
  });
  it('handles reversed normals, unequal counts and irregular positions', () => {
    const target = stack(
      [0, 4, 10].map((z, i) =>
        frame(i, {
          orientation: [1, 0, 0, 0, -1, 0],
          position: [0, 30, z],
        }),
      ),
    );
    const match = nearestNative(axial, target, [5, 5, 8]);
    expect(target.frames[match.index!].position![2]).toBe(10);
    expect(match.offset).toBe(2);
    expect(match.outside).toBe(false);
  });
  it('rejects invalid coordinate systems and ambiguous geometry', () => {
    for (const overrides of [
      { frameOfReference: undefined },
      { frameOfReference: 'different' },
      { studyUID: 'other' },
      { spacing: [0, 1] },
      { position: undefined },
      { orientation: [2, 0, 0, 0, 1, 0] },
    ]) {
      const target = stack([frame(0, overrides)]);
      expect(nearestNative(axial, target, [1, 1, 1]).index).toBeUndefined();
      expect(nearestNative(axial, target, [1, 1, 1]).reason).toBeTruthy();
    }
    expect(
      nearestNative(axial, stack([frame(0), frame(0, { id: 'duplicate' })]), [1, 1, 1]).reason,
    ).toContain('Repeated');
  });
  it('clips intersection lines to both finite images and rejects parallel/no-hit planes', () => {
    const a = axial.frames[2],
      b = coronal.frames[1];
    const segment = nativeIntersection(a, b)!;
    expect(segment).toHaveLength(2);
    for (const p of segment) {
      expect(planeOffset(a, p)).toBeCloseTo(0);
      expect(planeOffset(b, p)).toBeCloseTo(0);
      expect(insideNativeImage(a, p)).toBe(true);
      expect(insideNativeImage(b, p)).toBe(true);
    }
    expect(Math.hypot(...segment[1].map((v, k) => v - segment[0][k]))).toBeCloseTo(32);
    expect(nativeIntersection(a, axial.frames[1])).toBeUndefined();
    expect(nativeIntersection(a, { ...b, position: [100, 3, 10] })).toBeUndefined();
  });
});

it('clips fully oblique intersections against unequal shifted anisotropic footprints', () => {
  const a = frame(0, {
    position: [4, -3, 8],
    orientation: [0.8, 0.6, 0, -0.36, 0.48, 0.8],
    rows: 14,
    columns: 30,
    spacing: [1.5, 0.6],
  });
  const shared = pixelToPatient(a, 10, 8);
  const b = frame(1, {
    orientation: [0, 0.8, 0.6, 0.6, -0.48, 0.64],
    spacing: [0.7, 2],
    rows: 20,
    columns: 11,
  });
  b.position = shared.map(
    (v, k) => v - 5 * 2 * b.orientation![k] - 9 * 0.7 * b.orientation![k + 3],
  ) as Vec3;
  const line = nativeIntersection(a, b)!;
  expect(line).toHaveLength(2);
  for (const point of line) {
    for (const f of [a, b]) {
      expect(planeOffset(f, point)).toBeCloseTo(0, 8);
      const pixel = patientToPixel(f, point);
      expect(pixel[0]).toBeGreaterThanOrEqual(-0.50000001);
      expect(pixel[0]).toBeLessThanOrEqual(f.columns - 0.5 + 1e-8);
      expect(pixel[1]).toBeGreaterThanOrEqual(-0.50000001);
      expect(pixel[1]).toBeLessThanOrEqual(f.rows - 0.5 + 1e-8);
    }
    expect(
      [a, b].some((f) => {
        const [x, y] = patientToPixel(f, point);
        return (
          Math.min(
            Math.abs(x + 0.5),
            Math.abs(y + 0.5),
            Math.abs(x - f.columns + 0.5),
            Math.abs(y - f.rows + 0.5),
          ) < 1e-8
        );
      }),
    ).toBe(true);
  }
});

it('describes coincident, parallel and outside-image references without inventing a line', () => {
  const a = axial.frames[0];
  expect(nativeReference(a, { ...a, position: [0, 0, 0.0004] })).toMatchObject({
    relation: 'coincident',
  });
  expect(nativeReference(a, axial.frames[1])).toEqual({ relation: 'parallel', separationMm: 2 });
  expect(nativeReference(a, { ...a, orientation: [1, 0, 0, 0, -1, 0] }).relation).toBe(
    'coincident',
  );
  expect(nativeReference(a, coronal.frames[0]).relation).toBe('intersecting');
  expect(nativeReference(a, { ...coronal.frames[0], position: [100, 0, 10] }).relation).toBe(
    'outside-image',
  );
});

it('does not describe a small tilt as the same plane across the image', () => {
  const a = axial.frames[0],
    angle = 0.00009;
  const b = {
    ...a,
    rows: 704,
    columns: 704,
    orientation: [1, 0, 0, 0, Math.cos(angle), Math.sin(angle)],
  };
  expect(nativeReference(a, b).relation).toBe('intersecting');
});
