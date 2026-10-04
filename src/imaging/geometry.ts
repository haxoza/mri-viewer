import type { DisplaySet, Frame, Plane, Vec3 } from './types';
export const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
export const cross = (a: number[], b: number[]): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const normalOf = (f: Frame): Vec3 | undefined =>
  f.orientation && cross(f.orientation.slice(0, 3), f.orientation.slice(3));
export const validGeometry = (f: Frame) =>
  !!(
    f.position?.every(Number.isFinite) &&
    f.orientation?.length === 6 &&
    f.orientation.every(Number.isFinite) &&
    Math.abs(dot(f.orientation.slice(0, 3), f.orientation.slice(3))) < 0.001 &&
    Math.abs(dot(f.orientation.slice(0, 3), f.orientation.slice(0, 3)) - 1) < 0.001 &&
    Math.abs(dot(f.orientation.slice(3), f.orientation.slice(3)) - 1) < 0.001
  );
export function orientationName(n?: Vec3) {
  if (!n) return 'Unknown plane';
  const a = n.map(Math.abs);
  const i = a.indexOf(Math.max(...a));
  return a[i] < 0.99 ? 'Oblique' : ['Sagittal', 'Coronal', 'Axial'][i];
}
export function mprPlaneOrder(normal: Vec3): Plane[] {
  const planes: Plane[] = ['axial', 'sagittal', 'coronal'];
  // Prefer the anatomical plane closest to the acquired slices, including
  // oblique acquisitions. The sign of the slice direction does not matter.
  const alignment = {
    axial: Math.abs(normal[2]),
    sagittal: Math.abs(normal[0]),
    coronal: Math.abs(normal[1]),
  };
  const primary = planes.reduce((best, plane) =>
    alignment[plane] > alignment[best] ? plane : best,
  );
  return [primary, ...planes.filter((plane) => plane !== primary)];
}
export function direction(v: number[]) {
  return v
    .map((n, i) => ({ n: Math.abs(n), l: n >= 0 ? ['L', 'P', 'S'][i] : ['R', 'A', 'I'][i] }))
    .filter((x) => x.n > 0.2)
    .sort((a, b) => b.n - a.n)
    .map((x) => x.l)
    .join('');
}
export function sameOrientation(a: Frame, b: Frame) {
  return !!(
    a.orientation &&
    b.orientation &&
    a.orientation.every((x, i) => Math.abs(x - b.orientation![i]) < 0.001)
  );
}
export function volumeProblem(s: DisplaySet): string | undefined {
  if (!s.geometry || s.frames.length < 3)
    return 'MPR needs at least three slices with valid patient geometry.';
  const a = s.frames[0];
  if (!a.spacing?.every((x) => Number.isFinite(x) && x > 0)) return 'Pixel spacing is missing.';
  if (
    s.frames.some(
      (f) =>
        !sameOrientation(a, f) ||
        f.rows !== a.rows ||
        f.columns !== a.columns ||
        f.bits !== a.bits ||
        f.signed !== a.signed ||
        f.photometric !== a.photometric ||
        f.slope !== a.slope ||
        f.intercept !== a.intercept ||
        f.frameOfReference !== a.frameOfReference ||
        !f.spacing ||
        f.spacing.some((x, i) => Math.abs(x - a.spacing![i]) > 0.001),
    )
  )
    return 'Inconsistent geometry or pixel characteristics cannot form a volume.';
  const steps = s.positions.slice(1).map((p, i) => p - s.positions[i]);
  const step = [...steps].sort((a, b) => a - b)[Math.floor(steps.length / 2)];
  if (step <= 0.01 || steps.some((x) => Math.abs(x - step) > Math.max(0.05, step * 0.02)))
    return 'Duplicate positions, gaps, or nonuniform slice spacing prevent MPR.';
  if (
    s.frames.some((f, i) => {
      const delta = f.position!.map((v, k) => v - a.position![k]);
      const along = s.positions[i] - s.positions[0];
      return Math.hypot(...delta.map((v, k) => v - along * s.normal![k])) > 0.1;
    })
  )
    return 'Shifted slice origins prevent an orthogonal volume.';
}
export function nearestLinked(
  source: DisplaySet,
  target: DisplaySet,
  point: Vec3,
): { index?: number; reason?: string } {
  if (!source.geometry || !target.geometry) return { reason: 'Spatial geometry unavailable' };
  if (
    [source, target].some((s) =>
      s.positions.some((p, i) => i > 0 && Math.abs(p - s.positions[i - 1]) < 0.01),
    )
  )
    return { reason: 'Repeated slice positions cannot be spatially linked' };
  const uid = source.frames[0].frameOfReference;
  if (!uid || uid !== target.frames[0].frameOfReference)
    return { reason: 'Different or missing frame of reference' };
  if (Math.abs(dot(source.normal!, target.normal!)) < 0.999)
    return { reason: 'Stacks are not parallel' };
  const p = dot(point, target.normal!);
  const positions = target.positions;
  const i = positions.reduce(
    (best, x, k) => (Math.abs(x - p) < Math.abs(positions[best] - p) ? k : best),
    0,
  );
  const tolerance =
    positions.length > 1
      ? Math.max(
          0.1,
          Math.min(
            ...positions
              .slice(1)
              .map((x, k) => x - positions[k])
              .filter((x) => x > 0),
          ) /
            2 +
            0.05,
        )
      : 0.1;
  return Math.abs(positions[i] - p) > tolerance ? { reason: 'Out of range' } : { index: i };
}
