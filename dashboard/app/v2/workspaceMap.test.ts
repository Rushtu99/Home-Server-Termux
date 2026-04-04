import { describe, expect, it } from 'vitest';
import { DEFAULT_WORKSPACE, normalizeWorkspace, resolveWorkspaceFromQuery } from './workspaceMap';

describe('workspaceMap helpers', () => {
  it('normalizes known workspace keys', () => {
    expect(normalizeWorkspace(' media ')).toBe('media');
    expect(normalizeWorkspace('unknown')).toBeNull();
  });

  it('resolves from explicit workspace and legacy tab fallback', () => {
    const explicit = new URLSearchParams('workspace=admin');
    expect(resolveWorkspaceFromQuery(explicit)).toBe('admin');

    const legacy = new URLSearchParams('tab=terminal');
    expect(resolveWorkspaceFromQuery(legacy)).toBe('terminal');
  });

  it('falls back to default workspace', () => {
    expect(resolveWorkspaceFromQuery(new URLSearchParams())).toBe(DEFAULT_WORKSPACE);
  });
});
