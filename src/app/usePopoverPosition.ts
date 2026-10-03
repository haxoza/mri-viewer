import { useCallback, useEffect, useLayoutEffect, type RefObject } from 'react';

export function usePopoverPosition(
  rootRef: RefObject<HTMLElement | null>,
  contentSelector: string,
  open?: boolean,
) {
  const position = useCallback(() => {
    const element = rootRef.current;
    const content = element?.querySelector<HTMLElement>(contentSelector);
    const visible = element instanceof HTMLDetailsElement ? element.open : open;
    if (!element || !visible || !content) return;
    element.style.setProperty('--popover-shift', '0px');
    const bounds = content.getBoundingClientRect();
    const shift = Math.max(12 - bounds.left, Math.min(0, window.innerWidth - 12 - bounds.right));
    element.style.setProperty('--popover-shift', `${shift}px`);
  }, [rootRef, contentSelector, open]);

  useEffect(() => {
    const observer = new ResizeObserver(position);
    if (rootRef.current) {
      observer.observe(rootRef.current);
      const content = rootRef.current.querySelector(contentSelector);
      if (content) observer.observe(content);
      const toolbar = rootRef.current.closest('.tools, .navigation, .app-header');
      if (toolbar) observer.observe(toolbar);
    }
    window.addEventListener('resize', position);
    document.fonts.addEventListener('loadingdone', position);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', position);
      document.fonts.removeEventListener('loadingdone', position);
    };
  }, [rootRef, contentSelector, position]);
  useLayoutEffect(position);
  return position;
}
