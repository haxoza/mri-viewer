export const clamp = (n: number, total: number) => Math.max(0, Math.min(total - 1, Math.round(n)));
export function parseIndex(text: string, total: number): number | undefined {
  if (!/^\d+$/.test(text.trim())) return;
  const n = Number(text);
  return n >= 1 && n <= total ? n - 1 : undefined;
}
export class WheelSteps {
  private remainder = 0;
  private last = 0;
  consume(delta: number, mode: number, sensitivity: number, time: number) {
    if (mode !== 0 || (Math.abs(delta) >= 100 && delta % 100 === 0)) {
      this.remainder = 0;
      this.last = time;
      return mode === 0 ? delta / 100 : Math.sign(delta);
    }
    if (time - this.last > 200) this.remainder = 0;
    this.last = time;
    this.remainder += delta;
    const steps = Math.trunc(this.remainder / sensitivity);
    this.remainder -= steps * sensitivity;
    return steps;
  }
}
export function nextCine(
  index: number,
  total: number,
  reverse: boolean,
  loop: boolean,
  bounce: boolean,
) {
  const next = index + (reverse ? -1 : 1);
  if (next >= 0 && next < total) return { index: next, reverse, stop: false };
  if (bounce && total > 1)
    return { index: index + (reverse ? 1 : -1), reverse: !reverse, stop: false };
  if (loop) return { index: reverse ? total - 1 : 0, reverse, stop: false };
  return { index, reverse, stop: true };
}
