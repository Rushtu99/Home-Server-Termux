export type WorkspaceKey = 'overview' | 'media' | 'files' | 'transfers' | 'ai' | 'terminal' | 'admin';

export type UiNavItem = {
  key: WorkspaceKey;
  label: string;
  summary: string;
  available: boolean;
  status: string;
  legacyTabs: string[];
};

export type UiBootstrapResponse = {
  generatedAt: string;
  user: null | { role: string; username: string };
  lifecycle?: {
    state?: string;
    counts?: {
      blocked?: number;
      degraded?: number;
      healthy?: number;
      crashed?: number;
      stopped?: number;
    };
    reason?: string | null;
  };
  nav: UiNavItem[];
  legacyTabMap: Record<string, WorkspaceKey>;
  capabilities: Record<string, boolean>;
  serviceCounts?: {
    total: number;
    available: number;
    working: number;
    blocked: number;
    unavailable: number;
  };
};

export type UiWorkspaceResponse = {
  generatedAt: string;
  workspaceKey: WorkspaceKey;
  [key: string]: unknown;
};

export type UiInitialSectionErrorCode =
  | 'TIMEOUT'
  | 'UPSTREAM_5XX'
  | 'DEPENDENCY_FAILED'
  | 'UNAUTHORIZED'
  | 'UNKNOWN';

export type UiInitialSectionMeta = {
  ok: boolean;
  retryable: boolean;
  stale: boolean;
  generatedAt?: string;
  error?: {
    code: UiInitialSectionErrorCode;
    message: string;
  };
};

export type UiInitialResponseLegacy = {
  bootstrap: UiBootstrapResponse;
  workspace: UiWorkspaceResponse;
};

export type UiInitialResponseV2 = {
  schemaVersion: 2;
  status: 'ok' | 'partial' | 'error';
  requestId: string;
  requestedWorkspace: WorkspaceKey;
  bootstrap: UiBootstrapResponse | null;
  workspace: UiWorkspaceResponse | null;
  sections: {
    bootstrap: UiInitialSectionMeta;
    workspace: UiInitialSectionMeta;
  };
  retryAfterMs: number;
};

export type UiInitialResponse = UiInitialResponseLegacy | UiInitialResponseV2;

export type NormalizedUiInitial = {
  schemaVersion: 1 | 2;
  status: 'ok' | 'partial' | 'error';
  bootstrap: UiBootstrapResponse | null;
  workspace: UiWorkspaceResponse | null;
  sections: {
    bootstrap: UiInitialSectionMeta;
    workspace: UiInitialSectionMeta;
  };
  retryAfterMs: number;
};
