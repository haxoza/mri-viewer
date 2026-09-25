import { ViewerError } from '../../app/errors';
import { create } from 'zustand';
export type MarkColor = 'red' | 'yellow' | 'cyan';
export interface Ellipse {
  id: string;
  x: number;
  y: number;
  rx: number;
  ry: number;
  color: MarkColor;
}
interface Marks {
  panes: Ellipse[][];
  history: Ellipse[][][];
  color: MarkColor;
}
export const useMarks = create<Marks>(() => ({
  panes: [[], [], [], []],
  history: [[], [], [], []],
  color: 'red',
}));
export type MarkEdit =
  | { action: 'add' | 'update'; ellipse: Ellipse }
  | { action: 'remove'; id: string }
  | { action: 'undo' }
  | { action: 'clear' };
export function editMarks(pane: number, edit: MarkEdit) {
  const state = useMarks.getState(),
    current = state.panes[pane];
  let next: Ellipse[];
  if (edit.action === 'undo') next = state.history[pane].at(-1) ?? current;
  else if (edit.action === 'clear') next = [];
  else if (edit.action === 'remove') {
    if (!current.some((m) => m.id === edit.id)) throw new ViewerError('Unknown annotation ID.');
    next = current.filter((m) => m.id !== edit.id);
  } else {
    const e = edit.ellipse;
    if (
      !/^[a-zA-Z0-9_-]{1,64}$/.test(e.id) ||
      !['red', 'yellow', 'cyan'].includes(e.color) ||
      ![e.x, e.y, e.rx, e.ry].every(Number.isFinite) ||
      e.rx <= 0 ||
      e.ry <= 0 ||
      e.x - e.rx < 0 ||
      e.x + e.rx > 1 ||
      e.y - e.ry < 0 ||
      e.y + e.ry > 1
    )
      throw new ViewerError('Ellipse must fit within normalized pane coordinates.');
    const exists = current.some((m) => m.id === e.id);
    if ((edit.action === 'add' && exists) || (edit.action === 'update' && !exists))
      throw new ViewerError('Invalid annotation ID for this action.');
    if (edit.action === 'add' && current.length >= 100)
      throw new ViewerError('Maximum 100 marks per pane.');
    next =
      edit.action === 'add'
        ? [...current, { ...e }]
        : current.map((m) => (m.id === e.id ? { ...e } : m));
  }
  useMarks.setState({
    panes: state.panes.map((p, i) => (i === pane ? next : p)),
    history: state.history.map((h, i) =>
      i !== pane ? h : edit.action === 'undo' ? h.slice(0, -1) : [...h.slice(-49), current],
    ),
  });
}
export function clearMarks(pane: number) {
  useMarks.setState((s) => ({
    panes: s.panes.map((p, i) => (i === pane ? [] : p)),
    history: s.history.map((h, i) => (i === pane ? [] : h)),
  }));
}
