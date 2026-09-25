import { ViewerError } from '../../app/errors';
import { viewerActions } from '../../app/actions';
import { abortable } from '../../app/async';
import { VolumeViewport } from '@cornerstonejs/core';
import { getSet, paneCount, useSession, type Layout } from '../../app/store';
import { revision, interactionCancellation, settle } from '../../app/settlement';
import { panView, windowView, zoomView } from '../../app/viewActions';
import { controllers, pause, cancelMpr } from '../../imaging/rendering/controller';
import { volumeProblem } from '../../imaging/geometry';
import { allSets } from '../../imaging/catalog';
import { editMarks, useMarks, type Ellipse } from '../annotations/model';
import { captureDefaults, closeCapture, createCapture } from '../export/capture';
const layouts: Layout[] = [
  'single',
  'columns-2',
  'rows-2',
  'left-3',
  'top-3',
  'grid-4',
  'columns-4',
  'rows-4',
];
const modes = ['acquired', 'axial', 'sagittal', 'coronal'] as const;
type Mode = (typeof modes)[number];
export interface CommandArguments {
  get_viewer_state: Record<string, never>;
  set_layout: { layout: Layout };
  set_active_pane: { pane: number };
  assign_view: { pane: number; displaySet: string; mode: Mode };
  set_slice: { pane: number; position: number };
  set_view: {
    pane: number;
    width?: number;
    center?: number;
    zoom?: number;
    dx?: number;
    dy?: number;
    operation?: 'fit' | 'reset';
  };
  set_linked: { pane: number; linked: boolean };
  open_mpr: { pane: number };
  set_crosshair: { pane: number; x: number; y: number };
  edit_annotations: {
    pane: number;
    action: 'add' | 'update' | 'remove' | 'undo' | 'clear';
    ellipse?: Ellipse;
    id?: string;
  };
  capture_view: { scope?: 'active' | 'workspace'; pane?: number };
  close_capture: Record<string, never>;
}
export type CommandName = keyof CommandArguments;
type Schema = {
  type: 'object' | 'number' | 'integer' | 'string' | 'boolean';
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: false;
  enum?: readonly (string | number)[];
  minimum?: number;
  maximum?: number;
  pattern?: string;
};
const object = (
  properties: Record<string, Schema>,
  required: string[] = Object.keys(properties),
): Schema => ({ type: 'object', properties, required, additionalProperties: false });
const number = (minimum = -1e9, maximum = 1e9): Schema => ({ type: 'number', minimum, maximum });
const choice = (values: readonly string[]): Schema => ({ type: 'string', enum: values });
const pane: Schema = { type: 'integer', minimum: 1, maximum: 4 };
const id: Schema = { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,64}$' };
export const schemas: Record<CommandName, Schema> = {
  get_viewer_state: object({}),
  set_layout: object({ layout: choice(layouts) }),
  set_active_pane: object({ pane }),
  assign_view: object({ pane, displaySet: id, mode: choice(modes) }),
  set_slice: object({ pane, position: { type: 'integer', minimum: 1, maximum: 1e7 } }),
  set_view: object(
    {
      pane,
      width: number(0.000001),
      center: number(),
      zoom: number(0.05, 30),
      dx: number(-10000, 10000),
      dy: number(-10000, 10000),
      operation: choice(['fit', 'reset']),
    },
    ['pane'],
  ),
  set_linked: object({ pane, linked: { type: 'boolean' } }),
  open_mpr: object({ pane }),
  set_crosshair: object({ pane, x: number(0, 1), y: number(0, 1) }),
  edit_annotations: object(
    {
      pane,
      action: choice(['add', 'update', 'remove', 'undo', 'clear']),
      id,
      ellipse: object({
        id,
        x: number(0, 1),
        y: number(0, 1),
        rx: number(0, 0.5),
        ry: number(0, 0.5),
        color: choice(['red', 'yellow', 'cyan']),
      }),
    },
    ['pane', 'action'],
  ),
  capture_view: object({ scope: choice(['active', 'workspace']), pane }, []),
  close_capture: object({}),
};
export function validate(schema: Schema, value: unknown, path = 'arguments'): void {
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new ViewerError(`${path} must be an object.`);
    const input = value as Record<string, unknown>;
    for (const key of Object.keys(input))
      if (!schema.properties?.[key]) throw new ViewerError(`Unexpected ${path}.${key}.`);
    for (const key of schema.required ?? [])
      if (!(key in input)) throw new ViewerError(`Missing ${path}.${key}.`);
    for (const [key, v] of Object.entries(input))
      validate(schema.properties![key], v, `${path}.${key}`);
  } else if (schema.type === 'number' || schema.type === 'integer') {
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      (schema.type === 'integer' && !Number.isInteger(value)) ||
      value < schema.minimum! ||
      value > schema.maximum!
    )
      throw new ViewerError(`Invalid ${path}.`);
  } else if (typeof value !== schema.type) throw new ViewerError(`Invalid ${path}.`);
  if (schema.enum && !schema.enum.includes(value as string))
    throw new ViewerError(`Invalid ${path}.`);
  if (schema.pattern && !new RegExp(schema.pattern).test(value as string))
    throw new ViewerError(`Invalid ${path}.`);
}
const aliases = new Map<string, string>();
function alias(key: string, prefix: string) {
  key = `${prefix}:${key}`;
  if (!aliases.has(key)) aliases.set(key, `${prefix}-${crypto.randomUUID()}`);
  return aliases.get(key)!;
}
export function viewerState() {
  const s = useSession.getState();
  return {
    revision,
    layout: s.layout,
    activePane: s.active + 1,
    panes: s.panes.slice(0, paneCount(s.layout)).map((p, i) => {
      const v = controllers[i].viewport,
        range = v?.getProperties()?.voiRange;
      return {
        pane: i + 1,
        displaySet: p.setId ? alias(p.setId, 'set') : null,
        mode: p.mode === 'stack' ? 'acquired' : p.mode,
        displayed: p.displayed < 0 ? null : p.displayed + 1,
        requested: p.requested + 1,
        total: p.total,
        ready: !!v && p.displayed >= 0 && !p.pending && !p.error,
        pending: p.pending,
        failed: !!p.error,
        linked: p.linked,
        playing: p.playing,
        zoom: v?.getZoom(),
        pan: v?.getPan(),
        width: range ? range.upper - range.lower : undefined,
        center: range ? (range.upper + range.lower) / 2 : undefined,
        relativePosition: p.relative,
        step: p.step,
        annotations: useMarks.getState().panes[i],
      };
    }),
    studies: s.studies.map((study) => ({
      id: alias(study.uid, 'study'),
      series: study.series.map((series) => ({
        id: alias(series.uid, 'series'),
        displaySets: series.sets.map((set) => ({
          id: alias(set.id, 'set'),
          orientation: set.orientation,
          rows: set.frames[0].rows,
          columns: set.frames[0].columns,
          count: set.frames.length,
          reconstruction: !volumeProblem(set),
        })),
      })),
    })),
  };
}
function visiblePane(pane: number, loaded = true) {
  const s = useSession.getState(),
    index = pane - 1;
  if (index < 0 || index >= paneCount(s.layout)) throw new ViewerError('Pane is not visible.');
  if (loaded && (!controllers[index].viewport || !s.panes[index].setId))
    throw new ViewerError('Pane has no rendered view.');
  return index;
}
let queue: Promise<unknown> = Promise.resolve();
export function executeCommand<N extends CommandName>(
  name: N,
  input: CommandArguments[N],
  workspace: HTMLElement,
  external?: AbortSignal,
): Promise<unknown> {
  validate(schemas[name], input);
  const deadline = AbortSignal.timeout(60000);
  const lifetime = AbortSignal.any([deadline, ...(external ? [external] : [])]);
  const run = async () => {
    const local = new AbortController();
    const signal = AbortSignal.any([local.signal, lifetime]);
    signal.throwIfAborted();
    if (name === 'get_viewer_state') return viewerState();
    const cleanup = interactionCancellation(local);
    const cancel = () => {
      cancelMpr();
      controllers.forEach((c) => {
        if (useSession.getState().panes[c.index].pending) c.cancelPending();
      });
    };
    signal.addEventListener('abort', cancel, { once: true });
    try {
      pause();
      // Validate cross-field contracts before any operation mutates the viewer.
      if (name === 'set_view') {
        const a = input as CommandArguments['set_view'];
        if (
          (a.width === undefined) !== (a.center === undefined) ||
          (a.dx === undefined) !== (a.dy === undefined) ||
          Object.keys(a).length < 2
        )
          throw new ViewerError(
            'Supply width and center together, pan dx and dy together, or zoom/operation.',
          );
      }
      if (name === 'set_layout')
        viewerActions.setLayout((input as CommandArguments['set_layout']).layout);
      else if (name === 'close_capture') {
        closeCapture();
        return { closed: true };
      } else if (name === 'capture_view') {
        const a = input as CommandArguments['capture_view'];
        if (a.scope === 'workspace' && a.pane !== undefined)
          throw new ViewerError('Workspace captures cannot specify a pane.');
        const index = a.pane === undefined ? undefined : visiblePane(a.pane);
        const c = await createCapture(
          captureDefaults(workspace, a.scope, index),
          workspace,
          signal,
        );
        return {
          captureId: c.id,
          width: c.width,
          height: c.height,
          panes: c.panes,
          instruction:
            'Inspect the frozen Export preview with a browser screenshot. Navigation does not update this capture.',
        };
      } else {
        const a = input as Exclude<CommandArguments[CommandName], Record<string, never>> & {
          pane: number;
        };
        const index = visiblePane(a.pane, name !== 'set_active_pane' && name !== 'assign_view');
        const c = controllers[index];
        switch (name) {
          case 'set_active_pane':
            viewerActions.setActivePane(index);
            break;
          case 'assign_view': {
            const a = input as CommandArguments['assign_view'];
            const set = allSets(useSession.getState().studies).find(
              (s) => alias(s.id, 'set') === a.displaySet,
            );
            if (!set) throw new ViewerError('Unknown display-set alias. Read the current catalog.');
            if (a.mode !== 'acquired' && volumeProblem(set))
              throw new ViewerError('This display set does not support reconstruction.');
            await abortable(
              viewerActions.assignView(index, set.id, a.mode === 'acquired' ? 'stack' : a.mode),
              signal,
            );
            break;
          }
          case 'set_slice': {
            const a = input as CommandArguments['set_slice'];
            if (a.position > useSession.getState().panes[index].total)
              throw new ViewerError('Position exceeds pane range.');
            await abortable(viewerActions.setSlice(index, a.position - 1), signal);
            break;
          }
          case 'set_view': {
            const a = input as CommandArguments['set_view'];
            if (a.operation) viewerActions.reset(index, a.operation === 'reset');
            if (a.width !== undefined) windowView(index, a.width, a.center!);
            if (a.zoom !== undefined) zoomView(index, a.zoom);
            if (a.dx !== undefined) panView(index, a.dx, a.dy!);
            break;
          }
          case 'set_linked':
            viewerActions.setLinked(index, (input as CommandArguments['set_linked']).linked);
            break;
          case 'open_mpr': {
            const set = getSet(useSession.getState().panes[index].setId)!;
            if (volumeProblem(set))
              throw new ViewerError('This display set does not support reconstruction.');
            viewerActions.setActivePane(index);
            await abortable(viewerActions.openMpr(signal), signal);
            break;
          }
          case 'set_crosshair': {
            if (!(c.viewport instanceof VolumeViewport))
              throw new ViewerError('Crosshair requires a reconstructed pane.');
            const a = input as CommandArguments['set_crosshair'],
              r = c.element!.getBoundingClientRect();
            viewerActions.setCrosshair(index, a.x * r.width, a.y * r.height);
            break;
          }
          case 'edit_annotations': {
            const a = input as CommandArguments['edit_annotations'];
            if (a.action === 'add' || a.action === 'update') {
              if (!a.ellipse || a.id) throw new ViewerError('Supply an ellipse for add/update.');
              editMarks(index, { action: a.action, ellipse: a.ellipse });
            } else if (a.action === 'remove') {
              if (!a.id || a.ellipse) throw new ViewerError('Supply an ID for remove.');
              editMarks(index, { action: 'remove', id: a.id });
            } else {
              if (a.id || a.ellipse)
                throw new ViewerError('Undo/clear do not accept an ellipse or ID.');
              editMarks(index, { action: a.action });
            }
            break;
          }
        }
      }
      signal.throwIfAborted();
      await settle(signal);
      signal.throwIfAborted();
      if (name === 'set_slice') {
        const a = input as CommandArguments['set_slice'];
        if (useSession.getState().panes[a.pane - 1].displayed !== a.position - 1)
          throw new ViewerError('Operation superseded by another position.');
      }
      return viewerState();
    } finally {
      cleanup();
      signal.removeEventListener('abort', cancel);
    }
  };
  const result = queue.then(run, run);
  queue = result.catch(() => {});
  return abortable(result, lifetime);
}
