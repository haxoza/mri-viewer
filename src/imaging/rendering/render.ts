import { Enums, type StackViewport, type VolumeViewport } from '@cornerstonejs/core';
export function renderAndWait(
  viewport: StackViewport | VolumeViewport,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const element = viewport.element;
    const finish = (error?: Error) => {
      clearTimeout(timer);
      element.removeEventListener(Enums.Events.IMAGE_RENDERED, rendered);
      signal?.removeEventListener('abort', cancelled);
      if (error) reject(error);
      else resolve();
    };
    const rendered = () => finish();
    const cancelled = () => finish(new DOMException('Cancelled', 'AbortError'));
    const timer = setTimeout(
      () => finish(new Error('Render timed out. Try a smaller viewport or reload.')),
      15000,
    );
    element.addEventListener(Enums.Events.IMAGE_RENDERED, rendered);
    signal?.addEventListener('abort', cancelled, { once: true });
    viewport.render();
  });
}
