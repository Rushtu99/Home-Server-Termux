'use client';

import { useGatewayBase } from '../useGatewayBase';

export default function TerminalPage() {
  const gatewayBase = useGatewayBase();
  const frameSrc = gatewayBase ? `${gatewayBase}/term/` : '';

  return (
    <main id="app-main" className="tool-page">
      <header className="tool-toolbar">
        <div className="tool-toolbar__title">
          <h1>Terminal</h1>
          <p>Interactive shell session from the Termux host.</p>
        </div>
        {gatewayBase ? (
          <a href={frameSrc} target="_blank" rel="noreferrer" className="ui-button">
            Open In New Tab
          </a>
        ) : (
          <span className="status-message">Resolving gateway…</span>
        )}
      </header>

      <section className="tool-frame-shell">
        {gatewayBase ? (
          <iframe title="Terminal" src={frameSrc} className="tool-frame" />
        ) : (
          <div className="tool-empty" role="status" aria-live="polite">
            Gateway is still resolving. The terminal will load automatically.
          </div>
        )}
      </section>
    </main>
  );
}
