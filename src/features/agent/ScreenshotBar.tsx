import { useEffect, useRef } from 'react';
import { useSession } from '../../app/store';
import { useMarks } from '../annotations/model';
import { viewSignature } from '../export/capture';
import { closeScreenshot, useScreenshot } from './screenshot';

export function ScreenshotBar() {
  const view = useScreenshot((s) => s.view);
  useSession();
  useMarks();
  const restore = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    restore.current?.focus({ preventScroll: true });
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeScreenshot();
      }
    };
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('keydown', escape);
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus({ preventScroll: true });
    };
  }, []);
  if (!view) return null;
  const changed = view.signature !== viewSignature();
  return (
    <div className="screenshot-bar" aria-label="Screenshot view">
      <span role="status">
        <strong>Live view</strong> ·{' '}
        {view.pane === undefined ? 'Workspace' : `Pane ${view.pane + 1}`}
        {' · '}
        {!view.signature
          ? 'Preparing…'
          : changed
            ? 'Changed since preparation'
            : 'Ready for screenshot'}
      </span>
      <button ref={restore} onClick={closeScreenshot}>
        Restore controls <kbd>Esc</kbd>
      </button>
    </div>
  );
}
