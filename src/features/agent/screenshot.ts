import { create } from 'zustand';

export interface ScreenshotView {
  id: string;
  // Undefined means workspace; individual panes retain their original index.
  pane?: number;
  signature?: string;
}
export const useScreenshot = create<{ view?: ScreenshotView }>(() => ({}));
let pending: AbortController | undefined;
export function beginScreenshot(pane?: number) {
  pending?.abort();
  const controller = new AbortController();
  pending = controller;
  const view = { id: crypto.randomUUID(), pane };
  useScreenshot.setState({ view });
  return { view, controller };
}
export function closeScreenshot() {
  pending?.abort();
  pending = undefined;
  useScreenshot.setState({ view: undefined });
}
