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
