'use client';

import type { ReactNode } from 'react';
import { AiWorkspace } from './workspaces/ai';
import { AdminWorkspace } from './workspaces/admin';
import { FilesWorkspace } from './workspaces/files';
import { MediaWorkspace } from './workspaces/media';
import { OverviewWorkspace } from './workspaces/overview';
import {
  WorkspaceDesignTelemetry,
} from './workspaces/shared';
import type { AdminActions, WorkspaceActions } from './workspaces/shared';
import { TerminalWorkspace } from './workspaces/terminal';
import { TransfersWorkspace } from './workspaces/transfers';
import type { WorkspaceKey } from './types';

export function WorkspaceViewport({
  workspace,
  payload,
  adminActions,
  workspaceActions,
}: {
  workspace: WorkspaceKey;
  payload: Record<string, unknown>;
  adminActions?: AdminActions;
  workspaceActions?: WorkspaceActions;
}) {
  const withDesignTelemetry = (node: ReactNode) => (
    <>
      {node}
      <WorkspaceDesignTelemetry workspace={workspace} payload={payload} />
    </>
  );

  if (workspace === 'overview') {
    return withDesignTelemetry(<OverviewWorkspace payload={payload} workspaceActions={workspaceActions} />);
  }
  if (workspace === 'media') {
    return withDesignTelemetry(<MediaWorkspace payload={payload} />);
  }
  if (workspace === 'files') {
    return withDesignTelemetry(<FilesWorkspace payload={payload} workspaceActions={workspaceActions} />);
  }
  if (workspace === 'transfers') {
    return withDesignTelemetry(<TransfersWorkspace payload={payload} workspaceActions={workspaceActions} />);
  }
  if (workspace === 'ai') {
    return withDesignTelemetry(<AiWorkspace payload={payload} workspaceActions={workspaceActions} />);
  }
  if (workspace === 'terminal') {
    return withDesignTelemetry(<TerminalWorkspace payload={payload} />);
  }
  return withDesignTelemetry(<AdminWorkspace payload={payload} adminActions={adminActions} workspaceActions={workspaceActions} />);
}
