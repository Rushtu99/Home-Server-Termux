'use client';

import type { ReactNode } from 'react';

type StatusTone = 'ok' | 'warn' | 'danger' | 'muted';

export function StatusBadge({ children, tone = 'muted' }: { children: ReactNode; tone?: StatusTone }) {
  return <span className={`dash2-badge dash2-badge--${tone}`}>{children}</span>;
}

export function SectionCard({ title, subtitle, actions, children }: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="dash2-card">
      <header className="dash2-card__header">
        <div>
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {actions ? <div className="dash2-card__actions">{actions}</div> : null}
      </header>
      <div className="dash2-card__body">{children}</div>
    </section>
  );
}

export function MetricGrid({ children }: { children: ReactNode }) {
  return <div className="dash2-metrics">{children}</div>;
}

export function MetricTile({ label, value, helper }: { label: string; value: ReactNode; helper?: ReactNode }) {
  return (
    <article className="dash2-metric">
      <p className="dash2-metric__label">{label}</p>
      <p className="dash2-metric__value">{value}</p>
      {helper ? <p className="dash2-metric__helper">{helper}</p> : null}
    </article>
  );
}

export function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <div className="dash2-empty" role="status" aria-live="polite">
      <strong>{title}</strong>
      <p>{message}</p>
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="dash2-error" role="alert">
      {message}
    </div>
  );
}

export function LoadingState({ label = 'Loading workspace…' }: { label?: string }) {
  return (
    <div className="dash2-loading" role="status" aria-live="polite">
      <span className="dash2-spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function ServiceList({ items }: { items: Array<{ key?: string; label?: string; status?: string; summary?: string; available?: boolean }> }) {
  if (items.length === 0) {
    return <EmptyState title="No services" message="No services are available for this workspace." />;
  }

  return (
    <ul className="dash2-service-list">
      {items.map((entry, index) => {
        const statusToken = String(entry.status || '').toLowerCase();
        const tone: StatusTone = statusToken === 'working'
          ? 'ok'
          : statusToken === 'blocked' || statusToken === 'stalled'
            ? 'warn'
            : statusToken === 'unavailable' || statusToken === 'failed'
              ? 'danger'
              : 'muted';
        return (
          <li key={`${entry.key || entry.label || 'service'}-${index}`}>
            <div>
              <strong>{entry.label || entry.key || 'Service'}</strong>
              <p>{entry.summary || 'No summary available.'}</p>
            </div>
            <StatusBadge tone={tone}>{entry.status || (entry.available ? 'ready' : 'unknown')}</StatusBadge>
          </li>
        );
      })}
    </ul>
  );
}

export function KeyValueList({ rows }: { rows: Array<{ label: string; value: ReactNode }> }) {
  return (
    <dl className="dash2-kv">
      {rows.map((row) => (
        <div key={row.label}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
