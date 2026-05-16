'use client';

import type {
  ButtonHTMLAttributes,
  CSSProperties,
  ElementType,
  Ref,
  ReactNode,
} from 'react';

type DashboardSidebarProps = {
  brand: ReactNode;
  brandStyle?: CSSProperties;
  children: ReactNode;
  footer?: ReactNode;
  style?: CSSProperties;
};

export function DashboardSidebar({
  brand,
  brandStyle,
  children,
  footer,
  style,
}: DashboardSidebarProps) {
  return (
    <aside style={style}>
      <div style={brandStyle}>{brand}</div>
      {children}
      {footer}
    </aside>
  );
}

type DashboardCardProps = {
  as?: ElementType;
  cardRef?: Ref<HTMLElement>;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
};

export function DashboardCard({
  as: Component = 'div',
  cardRef,
  children,
  className,
  style,
}: DashboardCardProps) {
  const Card = Component as any;
  return (
    <Card ref={cardRef} className={className} style={style}>
      {children}
    </Card>
  );
}

export function DashboardSectionHeader({
  children,
  style,
}: {
  children: ReactNode;
  style?: CSSProperties;
}) {
  return <div style={style}>{children}</div>;
}

type DashboardActionButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  style?: CSSProperties;
};

export function DashboardActionButton({
  children,
  className = 'ui-button',
  style,
  type = 'button',
  ...props
}: DashboardActionButtonProps) {
  return (
    <button
      {...props}
      className={className}
      style={style}
      type={type}
    >
      {children}
    </button>
  );
}
