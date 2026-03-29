'use client';

import { useGatewayBase } from '../useGatewayBase';

export default function FilesPage() {
  const gatewayBase = useGatewayBase();
  const frameSrc = gatewayBase ? `${gatewayBase}/files/` : '';

  return (
    <main id="app-main" className="tool-page">
      <header className="tool-toolbar">
        <div className="tool-toolbar__title">
          <h1>Filesystem</h1>
          <p>Browse the Termux host through the embedded FileBrowser session.</p>
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
          <iframe title="File Manager" src={frameSrc} className="tool-frame" />
        ) : (
          <div className="tool-empty" role="status" aria-live="polite">
            Gateway is still resolving. The filesystem view will load automatically.
          </div>
        )}
      </section>
    </main>
  );
}
