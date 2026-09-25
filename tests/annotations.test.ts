import { beforeEach, expect, test } from 'vitest';
import { clearMarks, editMarks, useMarks, type Ellipse } from '../src/features/annotations/model';
beforeEach(() => {
  for (let i = 0; i < 4; i++) clearMarks(i);
});
const mark: Ellipse = { id: 'region', x: 0.5, y: 0.5, rx: 0.2, ry: 0.1, color: 'cyan' };
test('annotation edits have pane-local undo and clear discards history on examination removal', () => {
  editMarks(0, { action: 'add', ellipse: mark });
  editMarks(0, { action: 'update', ellipse: { ...mark, color: 'red' } });
  editMarks(0, { action: 'undo' });
  expect(useMarks.getState().panes[0]).toEqual([mark]);
  editMarks(0, { action: 'remove', id: mark.id });
  editMarks(0, { action: 'undo' });
  expect(useMarks.getState().panes[0]).toEqual([mark]);
  expect(useMarks.getState().panes[1]).toEqual([]);
  clearMarks(0);
  editMarks(0, { action: 'undo' });
  expect(useMarks.getState().panes[0]).toEqual([]);
});
test('marks reject duplicate IDs, missing updates and out-of-bounds or nonfinite geometry', () => {
  expect(() => editMarks(0, { action: 'update', ellipse: mark })).toThrow();
  for (const bad of [{ rx: 0 }, { x: 0.95 }, { y: NaN }, { ry: Infinity }])
    expect(() => editMarks(0, { action: 'add', ellipse: { ...mark, ...bad } })).toThrow();
  editMarks(0, { action: 'add', ellipse: mark });
  expect(() => editMarks(0, { action: 'add', ellipse: mark })).toThrow();
});
