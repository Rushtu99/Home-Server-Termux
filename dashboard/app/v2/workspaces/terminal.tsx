'use client';

import Link from 'next/link';
import { EmptyState, KeyValueList, SectionCard } from '../components';
import { asRecord } from './shared';

export function TerminalWorkspace({ payload }: { payload: Record<string, unknown> }) {
  const controlPlane = asRecord(payload.controlPlane);
  const controlPlaneCatalog = asRecord(controlPlane.catalog);
  const catalogServices = asRecord(
    (Array.isArray(controlPlaneCatalog.services) ? controlPlaneCatalog.services : []).find(
      (entry) => String(asRecord(entry).surface || '').toLowerCase() === 'terminal'
    ) || {}
  );
  const terminal = asRecord(payload.terminal);
  const terminalService = Object.keys(catalogServices).length > 0 ? catalogServices : terminal;
  const terminalRoute = String(terminalService.route || '/term/');
  const terminalAvailable = String(terminalService.status || '').toLowerCase() !== 'unavailable';

  return (
    <SectionCard
      title="Terminal workspace"
      subtitle="Larger embedded shell view with the route/details noise removed."
      actions={<Link href={terminalRoute} className="ui-button ui-button--primary">Open terminal route</Link>}
    >
      <div className="dash2-terminal-layout">
        <KeyValueList
          rows={[
            { label: 'Service', value: String(terminalService.label || terminalService.key || 'ttyd') },
            { label: 'Status', value: String(terminalService.status || 'unknown') },
            { label: 'Access', value: String(terminalService.description || terminalService.blocker || 'Terminal route served through gateway') },
          ]}
        />
        {terminalAvailable ? (
          <iframe
            title="Embedded terminal"
            src={terminalRoute}
            className="dash2-terminal-mini"
          />
        ) : (
          <EmptyState title="Terminal unavailable" message="ttyd service is unavailable. Start it from service controls first." />
        )}
      </div>
    </SectionCard>
  );
}
