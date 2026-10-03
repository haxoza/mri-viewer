import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { usePopoverPosition } from './usePopoverPosition';

export function ActionMenu({
  label,
  children,
  onOpenChange,
}: {
  label: string;
  children: (close: () => void) => ReactNode;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  usePopoverPosition(root, '.action-menu-list', open);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const items = () =>
    Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
  const change = (next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
  };
  const close = () => {
    change(false);
    trigger.current?.focus();
  };
  useEffect(() => {
    if (open) items()[0]?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) change(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  });
  return (
    <div
      ref={root}
      className="action-menu"
      onKeyDown={(event) => {
        if (open && event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) change(false);
      }}
    >
      <button
        ref={trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => change(!open)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            change(true);
          }
        }}
      >
        {label}
      </button>
      <div
        ref={menu}
        id={id}
        role="menu"
        aria-label={label}
        className="action-menu-list"
        hidden={!open}
        onKeyDown={(event) => {
          if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            const buttons = items();
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
            const next =
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? buttons.length - 1
                  : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) %
                    buttons.length;
            buttons[next]?.focus();
          }
        }}
      >
        {/* The render prop attaches close to event handlers; it never calls it during render. */}
        {/* oxlint-disable-next-line react/refs */}
        {children(close)}
      </div>
    </div>
  );
}
