'use client';

import type { CSSProperties, ReactNode } from 'react';

export type TabNavbarItem<T extends string> = {
  key: T;
  label: string;
  ariaLabel?: string;
};

type TabNavbarProps<T extends string> = {
  activeButtonStyle?: CSSProperties;
  activeKey: T;
  ariaLabel: string;
  buttonClassName?: string;
  buttonStyle?: CSSProperties;
  contentStyle?: CSSProperties;
  items: Array<TabNavbarItem<T>>;
  navStyle?: CSSProperties;
  onSelect: (key: T) => void;
  renderIcon: (key: T) => ReactNode;
  resolveLabel?: (key: T, fallbackLabel: string) => string;
  textStyle?: CSSProperties;
};

export function TabNavbar<T extends string>({
  activeButtonStyle,
  activeKey,
  ariaLabel,
  buttonClassName = 'ui-button',
  buttonStyle,
  contentStyle,
  items,
  navStyle,
  onSelect,
  renderIcon,
  resolveLabel,
  textStyle,
}: TabNavbarProps<T>) {
  return (
    <nav aria-label={ariaLabel} style={navStyle}>
      {items.map((item) => {
        const label = resolveLabel ? resolveLabel(item.key, item.label) : item.label;
        const active = activeKey === item.key;
        return (
          <button
            key={item.key}
            className={buttonClassName}
            aria-pressed={active}
            aria-label={item.ariaLabel || item.label}
            style={{ ...buttonStyle, ...(active ? activeButtonStyle : {}) }}
            type="button"
            onClick={() => onSelect(item.key)}
          >
            <span style={contentStyle}>
              {renderIcon(item.key)}
              <span style={textStyle}>{label}</span>
            </span>
          </button>
        );
      })}
    </nav>
  );
}
