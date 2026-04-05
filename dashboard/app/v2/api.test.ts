import { describe, expect, it } from 'vitest';
import { parseUiInitialResponse } from './api';

describe('parseUiInitialResponse', () => {
  it('normalizes legacy payloads into the v2 client shape', () => {
    const payload = parseUiInitialResponse({
      bootstrap: {
        generatedAt: '2026-04-06T00:00:00.000Z',
        user: { role: 'admin', username: 'admin' },
        nav: [],
        legacyTabMap: {},
        capabilities: {},
      },
      workspace: {
        generatedAt: '2026-04-06T00:00:01.000Z',
        workspaceKey: 'overview',
      },
    });

    expect(payload.schemaVersion).toBe(1);
    expect(payload.status).toBe('ok');
    expect(payload.sections.bootstrap.ok).toBe(true);
    expect(payload.sections.workspace.ok).toBe(true);
  });

  it('preserves partial v2 metadata for degraded initial loads', () => {
    const payload = parseUiInitialResponse({
      schemaVersion: 2,
      status: 'partial',
      requestId: 'req-1',
      requestedWorkspace: 'media',
      retryAfterMs: 5000,
      bootstrap: {
        generatedAt: '2026-04-06T00:00:00.000Z',
        user: { role: 'admin', username: 'admin' },
        nav: [],
        legacyTabMap: {},
        capabilities: {},
      },
      workspace: null,
      sections: {
        bootstrap: {
          ok: true,
          retryable: false,
          stale: false,
        },
        workspace: {
          ok: false,
          retryable: true,
          stale: true,
          error: {
            code: 'UNKNOWN',
            message: 'audit timed out',
          },
        },
      },
    });

    expect(payload.schemaVersion).toBe(2);
    expect(payload.status).toBe('partial');
    expect(payload.workspace).toBeNull();
    expect(payload.sections.workspace.error?.message).toBe('audit timed out');
    expect(payload.retryAfterMs).toBe(5000);
  });
});
