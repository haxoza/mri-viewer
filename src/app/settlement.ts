import { useMarks } from '../features/annotations/model';
import { ViewerError, memoryError } from './errors';
import { paneCount, useSession } from './store';
import { controllers } from '../imaging/rendering/controller';
import { renderAndWait } from '../imaging/rendering/render';
export let revision = 0;
useSession.subscribe(() => {
  revision++;
});
useMarks.subscribe(() => {
  revision++;
});
export async function settle(signal: AbortSignal) {
  // A task boundary also lets React commit layout changes and mount new panes.
  for (;;) {
    signal.throwIfAborted();
    await new Promise((resolve) => setTimeout(resolve, 20));
    signal.throwIfAborted();
    const state = useSession.getState();
    const visible = state.panes.slice(0, paneCount(state.layout));
    if (visible.some((p) => p.error === memoryError)) throw new ViewerError(memoryError);
    if (visible.some((p) => p.error))
      throw new ViewerError('A pane failed to render. Retry it in the viewer.');
    if (
      visible.some((p, i) => p.setId && (p.pending || !controllers[i].viewport || p.displayed < 0))
    )
      continue;
    const generations = controllers.map((c) => c.generation);
    await Promise.all(
      controllers
        .slice(0, visible.length)
        .filter((c) => c.viewport)
        .map((c) => renderAndWait(c.viewport!, signal)),
    );
    signal.throwIfAborted();
    if (controllers.some((c, i) => generations[i] !== c.generation))
      throw new ViewerError('Operation superseded by a new view.');
    if (
      !useSession
        .getState()
        .panes.slice(0, visible.length)
        .some((p) => p.pending)
    )
      return;
  }
}
export function interactionCancellation(
  controller: AbortController,
  ignoreInteractionsWithin?: HTMLElement,
) {
  const cancel = (event: Event) => {
    if (event.target instanceof Node && ignoreInteractionsWithin?.contains(event.target)) return;
    if (event.type === 'pointermove' && !(event as PointerEvent).buttons) return;
    controller.abort(new ViewerError('Operation superseded by human interaction.'));
  };
  const events = [
    'pointerdown',
    'pointermove',
    'wheel',
    'keydown',
    'input',
    'change',
    'drop',
  ] as const;
  for (const event of events) document.addEventListener(event, cancel, true);
  window.addEventListener('resize', cancel);
  return () => {
    for (const event of events) document.removeEventListener(event, cancel, true);
    window.removeEventListener('resize', cancel);
  };
}
