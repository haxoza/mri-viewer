import { cross, dot, normalOf, sameOrientation, validGeometry } from './geometry';
import type { DisplaySet, Frame, Vec3 } from './types';

const subtract = (a: Vec3, b: Vec3) => a.map((v, i) => v - b[i]) as Vec3;
const unitNormal = (f: Frame) => {
  const n = normalOf(f)!;
  const length = Math.hypot(...n);
  return n.map((v) => v / length) as Vec3;
};
export function nativeGeometryProblem(set: DisplaySet): string | undefined {
  if (
    !set.geometry ||
    !set.frames.length ||
    set.frames.some(
      (f) =>
        !validGeometry(f) ||
        f.position?.length !== 3 ||
        !f.spacing ||
        f.spacing.length !== 2 ||
        !f.spacing.every((v) => Number.isFinite(v) && v > 0) ||
        !Number.isInteger(f.rows) ||
        !Number.isInteger(f.columns) ||
        f.rows < 1 ||
        f.columns < 1 ||
        !sameOrientation(set.frames[0], f),
    )
  )
    return 'Native link geometry unavailable or inconsistent';
  const n = unitNormal(set.frames[0]);
  const positions = set.frames.map((f) => dot(f.position!, n)).sort((a, b) => a - b);
  if (positions.some((v, i) => i > 0 && v - positions[i - 1] < 0.01))
    return 'Repeated slice positions cannot be spatially linked';
}
export function nativeCompatibility(source: DisplaySet, target: DisplaySet) {
  const problem = nativeGeometryProblem(source) ?? nativeGeometryProblem(target);
  if (problem) return problem;
  const uid = source.frames[0].frameOfReference;
  if (!uid || [source, target].some((s) => s.frames.some((f) => f.frameOfReference !== uid)))
    return 'Incompatible coordinates: different or missing frame of reference';
  const study = source.frames[0].studyUID;
  if (!study || [source, target].some((s) => s.frames.some((f) => f.studyUID !== study)))
    return 'Different or missing study; native linking disabled';
}
// DICOM spacing is row, column; the first orientation vector advances columns.
export function pixelToPatient(f: Frame, column: number, row: number): Vec3 {
  return f.position!.map(
    (v, k) =>
      v + column * f.spacing![1] * f.orientation![k] + row * f.spacing![0] * f.orientation![k + 3],
  ) as Vec3;
}
export function patientToPixel(f: Frame, point: Vec3): [number, number] {
  const delta = subtract(point, f.position!);
  return [
    dot(delta, f.orientation!.slice(0, 3)) / f.spacing![1],
    dot(delta, f.orientation!.slice(3)) / f.spacing![0],
  ];
}
export function projectToNativePlane(f: Frame, point: Vec3): Vec3 {
  const n = unitNormal(f);
  const distance = dot(subtract(f.position!, point), n);
  return point.map((v, k) => v + distance * n[k]) as Vec3;
}
export function planeOffset(f: Frame, point: Vec3) {
  return dot(subtract(point, f.position!), unitNormal(f));
}
export function insideNativeImage(f: Frame, point: Vec3) {
  const [x, y] = patientToPixel(f, point);
  return x >= -0.5 && x <= f.columns - 0.5 && y >= -0.5 && y <= f.rows - 0.5;
}
export interface NativeMatch {
  index?: number;
  offset?: number;
  outside?: boolean;
  reason?: string;
}
export function nearestNative(source: DisplaySet, target: DisplaySet, point: Vec3): NativeMatch {
  const reason = nativeCompatibility(source, target);
  if (reason) return { reason };
  if (!point.every(Number.isFinite)) return { reason: 'Invalid shared point' };
  const offsets = target.frames.map((f) => planeOffset(f, point));
  const index = offsets.reduce(
    (best, v, i) => (Math.abs(v) < Math.abs(offsets[best]) ? i : best),
    0,
  );
  // Conservative coverage: between acquired plane centers and within the selected image.
  // Slice thickness is not proof of continuous coverage, especially with gaps.
  const outside =
    offsets.every((v) => v > 0.01) ||
    offsets.every((v) => v < -0.01) ||
    !insideNativeImage(target.frames[index], point);
  return { index, offset: offsets[index], outside };
}
// Intersection of two actual acquired planes, clipped to BOTH image rectangles.
export function nativeIntersection(a: Frame, b: Frame): [Vec3, Vec3] | undefined {
  const n = unitNormal(a),
    m = unitNormal(b),
    d = cross(n, m),
    dd = dot(d, d);
  if (dd < 1e-12) return;
  const ca = dot(n, a.position!),
    cb = dot(m, b.position!);
  const x = cross(m, d),
    y = cross(d, n);
  const origin = x.map((v, k) => (ca * v + cb * y[k]) / dd) as Vec3;
  let lo = -Infinity,
    hi = Infinity;
  for (const f of [a, b]) {
    const start = patientToPixel(f, origin);
    const step = [
      dot(d, f.orientation!.slice(0, 3)) / f.spacing![1],
      dot(d, f.orientation!.slice(3)) / f.spacing![0],
    ];
    for (let k = 0; k < 2; k++) {
      const min = -0.5,
        max = (k === 0 ? f.columns : f.rows) - 0.5;
      if (Math.abs(step[k]) < 1e-10) {
        if (start[k] < min || start[k] > max) return;
      } else {
        const ends = [(min - start[k]) / step[k], (max - start[k]) / step[k]].sort((u, v) => u - v);
        lo = Math.max(lo, ends[0]);
        hi = Math.min(hi, ends[1]);
      }
    }
  }
  if (hi <= lo || !Number.isFinite(lo) || !Number.isFinite(hi)) return;
  return [lo, hi].map((t) => origin.map((v, k) => v + t * d[k]) as Vec3) as [Vec3, Vec3];
}

export type NativeReference =
  | { relation: 'intersecting'; segment: [Vec3, Vec3] }
  | { relation: 'coincident' | 'parallel'; separationMm: number }
  | { relation: 'outside-image' };
// Parallel planes have no unique intersection line. Rounded DICOM coordinates
// within 0.01 mm are treated as coincident for navigation annotations only.
export function nativeReference(a: Frame, b: Frame): NativeReference {
  const direction = cross(unitNormal(a), unitNormal(b));
  if (dot(direction, direction) < 1e-12) {
    const separationMm = Math.abs(planeOffset(a, b.position!));
    const withinTolerance = [
      [a, b],
      [b, a],
    ].every(([plane, image]) =>
      [-0.5, image.columns - 0.5].every((column) =>
        [-0.5, image.rows - 0.5].every(
          (row) => Math.abs(planeOffset(plane, pixelToPatient(image, column, row))) <= 0.01,
        ),
      ),
    );
    return { relation: withinTolerance ? 'coincident' : 'parallel', separationMm };
  }
  const segment = nativeIntersection(a, b);
  return segment ? { relation: 'intersecting', segment } : { relation: 'outside-image' };
}
export function nativeReferenceLabel(reference: NativeReference) {
  switch (reference.relation) {
    case 'coincident':
      return 'same plane (within 0.01 mm)';
    case 'parallel':
      return `parallel · ${reference.separationMm.toFixed(2)} mm apart`;
    case 'outside-image':
      return 'intersection outside image';
    case 'intersecting':
      return 'reference line';
  }
}
export const nativeReferenceColors = ['#f2c66b', '#80bbff', '#f59bd5', '#b3e58a'];
