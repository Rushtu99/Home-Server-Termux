'use client';

import { getDemoTerminalFrameUrl, getDemoTerminalLines } from '../demo-api';
import { isDemoMode } from '../demo-mode';
import { ToolPage } from '../ui-primitives';
import { useGatewayBase } from '../useGatewayBase';

export default function TerminalPage() {
  const gatewayBase = useGatewayBase();
  const demoMode = isDemoMode();
  const frameSrc = demoMode ? getDemoTerminalFrameUrl() : gatewayBase ? `${gatewayBase}/term/` : '';

  return (
    <ToolPage
      title="Terminal"
      subtitle="Interactive shell session from the Termux host."
      actions={frameSrc ? (
        <a href={frameSrc} target="_blank" rel="noreferrer" className="ui-button">
          Open In New Tab
        </a>
      ) : (
        <span className="status-message">Resolving gateway…</span>
      )}
    >

      <section className="tool-frame-shell">
        {demoMode ? (
          <div className="tool-frame tool-frame--mock" role="img" aria-label="Demo terminal output">
            <pre className="tool-frame__terminal-copy">{getDemoTerminalLines().join('\n')}</pre>
          </div>
        ) : gatewayBase ? (
          <iframe title="Terminal" src={frameSrc} className="tool-frame" />
        ) : (
          <div className="tool-empty" role="status" aria-live="polite">
            Gateway is still resolving. The terminal will load automatically.
          </div>
        )}
      </section>
    </ToolPage>
  );
}
