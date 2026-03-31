'use client';

import type { ButtonHTMLAttributes, CSSProperties, ReactNode, RefObject } from 'react';
import { forwardRef, useEffect, useRef } from 'react';

type ToolPageProps = {
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  mainId?: string;
  subtitle?: ReactNode;
  title: ReactNode;
};

export function ToolPage({
  actions,
  children,
  className = '',
  mainId = 'app-main',
  subtitle,
  title,
}: ToolPageProps) {
  return (
    <main id={mainId} className={`tool-page ${className}`.trim()}>
      <header className="tool-toolbar">
        <div className="tool-toolbar__title">
          <h1>{title}</h1>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {actions ? <div className="tool-toolbar__actions">{actions}</div> : null}
      </header>
      {children}
    </main>
  );
}

type DialogSurfaceProps = {
  children: ReactNode;
  describedBy?: string;
  initialFocusRef?: RefObject<HTMLElement | null>;
  labelledBy?: string;
  open: boolean;
  onClose: () => void;
  overlayClassName?: string;
  overlayStyle?: CSSProperties;
  panelClassName?: string;
  panelStyle?: CSSProperties;
  role?: 'dialog' | 'alertdialog';
};

export function DialogSurface({
  children,
  describedBy,
  initialFocusRef,
  labelledBy,
  open,
  onClose,
  overlayClassName,
  overlayStyle,
  panelClassName,
  panelStyle,
  role = 'dialog',
}: DialogSurfaceProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const focusTarget = initialFocusRef?.current || panelRef.current;
    focusTarget?.focus({ preventScroll: true });
  }, [initialFocusRef, open]);

  if (!open) {
    return null;
  }

  return (
    <div
      className={overlayClassName}
      style={overlayStyle}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={panelRef}
        className={panelClassName}
        style={panelStyle}
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}

type MenuButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'type'> & {
  label: string;
  open?: boolean;
};

export const MenuButton = forwardRef<HTMLButtonElement, MenuButtonProps>(function MenuButton(
  {
    label,
    open,
    className,
    title,
    ...props
  },
  ref
) {
  return (
    <button
      {...props}
      ref={ref}
      type="button"
      aria-label={label}
      aria-haspopup="menu"
      aria-expanded={open}
      className={className}
      title={title || label}
    >
      ⋯
    </button>
  );
});

