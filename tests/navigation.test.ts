import { expect, it } from 'vitest';
import { clamp, nextCine, parseIndex, WheelSteps } from '../src/imaging/tools/navigation';
it('uses strict one-based input and clamps ordinary navigation', () => {
  expect(parseIndex('3', 5)).toBe(2);
  expect(parseIndex('3.2', 5)).toBeUndefined();
  expect(parseIndex('0', 5)).toBeUndefined();
  expect(clamp(-1, 5)).toBe(0);
  expect(clamp(8, 5)).toBe(4);
});
it('accumulates trackpad movement without jumping for tiny events', () => {
  const wheel = new WheelSteps();
  expect(wheel.consume(20, 0, 60, 0)).toBe(0);
  expect(wheel.consume(20, 0, 60, 10)).toBe(0);
  expect(wheel.consume(20, 0, 60, 20)).toBe(1);
  expect(wheel.consume(-60, 0, 60, 30)).toBe(-1);
});
it('gives cine explicit stop, loop, and bounce boundaries', () => {
  expect(nextCine(4, 5, false, false, false).stop).toBe(true);
  expect(nextCine(4, 5, false, true, false).index).toBe(0);
  expect(nextCine(4, 5, false, false, true)).toEqual({ index: 3, reverse: true, stop: false });
});
it('treats discrete mouse wheel notches as one slice each', () => {
  const wheel = new WheelSteps();
  expect([0, 10, 20].map((t) => wheel.consume(100, 0, 60, t))).toEqual([1, 1, 1]);
  expect(wheel.consume(3, 1, 60, 30)).toBe(1);
});
