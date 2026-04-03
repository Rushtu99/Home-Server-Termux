import type { WorkspaceKey } from './types';

export const DEFAULT_WORKSPACE: WorkspaceKey = 'overview';

export const LEGACY_TAB_FALLBACK_MAP: Record<string, WorkspaceKey> = {
  home: 'overview',
  media: 'media',
  downloads: 'media',
  arr: 'media',
  terminal: 'terminal',
  filesystem: 'files',
  ftp: 'transfers',
  ai: 'ai',
  settings: 'admin',
};

const WORKSPACE_SET = new Set<WorkspaceKey>([
  'overview',
  'media',
  'files',
  'transfers',
  'ai',
  'terminal',
  'admin',
]);

export const normalizeWorkspace = (value: string | null | undefined): WorkspaceKey | null => {
  const key = String(value || '').trim().toLowerCase();
  return WORKSPACE_SET.has(key as WorkspaceKey) ? (key as WorkspaceKey) : null;
};

export const resolveWorkspaceFromQuery = (
  searchParams: URLSearchParams,
  legacyMap?: Record<string, WorkspaceKey>
): WorkspaceKey => {
  const explicitWorkspace = normalizeWorkspace(searchParams.get('workspace'));
  if (explicitWorkspace) {
    return explicitWorkspace;
  }

  const tab = String(searchParams.get('tab') || '').trim().toLowerCase();
  const map = legacyMap || LEGACY_TAB_FALLBACK_MAP;
  return map[tab] || DEFAULT_WORKSPACE;
};
