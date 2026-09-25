import { create } from 'zustand';
import type { Frame, Plane, Profile, Study } from '../imaging/types';
import { allSets, buildCatalog } from '../imaging/catalog';
export type Tool = 'slices' | 'pan' | 'zoom' | 'window' | 'crosshair' | 'ellipse';
export type Layout =
  | 'single'
  | 'columns-2'
  | 'rows-2'
  | 'left-3'
  | 'top-3'
  | 'grid-4'
  | 'columns-4'
  | 'rows-4';
export const paneCount = (layout: Layout) => Number(layout.slice(-1)) || 1;
export interface Pane {
  setId?: string;
  mode: 'stack' | Plane;
  requested: number;
  displayed: number;
  total: number;
  pending: boolean;
  error?: string;
  linked: boolean;
  linkStatus?: string;
  playing: boolean;
  fps: number;
  achieved: number;
  reverse: boolean;
  loop: boolean;
  bounce: boolean;
  temporal: boolean;
  step?: number;
  relative?: number;
  window?: string;
  zoom?: number;
}
const emptyPane = (): Pane => ({
  mode: 'stack',
  requested: 0,
  displayed: -1,
  total: 0,
  pending: false,
  linked: false,
  playing: false,
  fps: 12,
  achieved: 0,
  reverse: false,
  loop: true,
  bounce: false,
  temporal: false,
});
interface Session {
  frames: Frame[];
  studies: Study[];
  panes: Pane[];
  active: number;
  layout: Layout;
  tool: Tool;
  profile: Profile;
  sidebar: boolean;
  sensitivity: number;
  notice?: string;
  patch: (index: number, patch: Partial<Pane>) => void;
  updateCatalog: (frames: Frame[]) => void;
}
export const useSession = create<Session>((set) => ({
  frames: [],
  studies: [],
  panes: Array.from({ length: 4 }, emptyPane),
  active: 0,
  layout: 'single',
  tool: 'slices',
  profile: matchMedia('(pointer: coarse)').matches ? 'low' : 'standard',
  sidebar: true,
  sensitivity: 60,
  patch: (index, patch) =>
    set((s) => ({ panes: s.panes.map((p, i) => (i === index ? { ...p, ...patch } : p)) })),
  updateCatalog: (frames) => set({ frames, studies: buildCatalog(frames) }),
}));
export const getSet = (id?: string) =>
  allSets(useSession.getState().studies).find((s) => s.id === id);
export function notify(notice: string) {
  useSession.setState({ notice });
}
