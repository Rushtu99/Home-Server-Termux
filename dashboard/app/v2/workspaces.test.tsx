import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WorkspaceViewport } from './workspaces';

vi.mock('./api', () => ({
  addMediaTorrent: vi.fn(),
  checkDrives: vi.fn(),
  createFtpDirectory: vi.fn(),
  createFtpFavourite: vi.fn(),
  deleteFtpFavourite: vi.fn(),
  deleteLlmConversation: vi.fn(),
  disconnectConnection: vi.fn(),
  fetchLogsSnapshot: vi.fn(),
  getLlmConversationMessages: vi.fn(),
  listFtpDefaults: vi.fn(),
  listFtpDirectory: vi.fn(),
  listFtpFavourites: vi.fn(),
  listLlmConversations: vi.fn().mockResolvedValue({ conversations: [] }),
  mountFtpFavourite: vi.fn(),
  recheckStorageProtection: vi.fn(),
  refreshOnlineModels: vi.fn(),
  resumeStorageProtection: vi.fn(),
  selectLlmModel: vi.fn(),
  selectOnlineModel: vi.fn(),
  sendLlmChatStream: vi.fn(),
  unmountFtpFavourite: vi.fn(),
  updateFtpFavourite: vi.fn(),
  updateVerboseLogging: vi.fn(),
  uploadToFtp: vi.fn(),
}));

describe('WorkspaceViewport', () => {
  it('restores the transfers connect workspace with wrapped action rows', () => {
    const { container } = render(
      <WorkspaceViewport
        workspace="transfers"
        payload={{
          ftpDefaults: { host: '10.0.0.2', port: 21, user: 'anon', defaultName: 'PS4' },
          favourites: [],
          services: [],
          torrent: { laneSummary: { standalone: { savePath: '/downloads/standalone' } } },
          qbDiagnostics: { categories: {} },
          arrDiagnostics: {},
        }}
        workspaceActions={{ currentUsername: 'admin', onRefresh: vi.fn() }}
      />
    );

    expect(screen.getByRole('tab', { name: 'Connect' })).toBeInTheDocument();
    expect(screen.getByText('Connection')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument();
    expect(container.querySelectorAll('.dash2-wrap-row').length).toBeGreaterThan(0);
  });

  it('shows admin help and logs tabs', () => {
    render(
      <WorkspaceViewport
        workspace="admin"
        payload={{
          dashboard: {
            generatedAt: '2026-04-06T00:00:00.000Z',
            serviceCatalog: [],
            serviceController: { locked: true, optionalServices: [] },
            networkExposure: { core: [], services: [], overall: 'unknown' },
            tailscale: {},
            remoteAccess: { gateway: {}, ssh: {} },
            logs: {
              entries: [{ timestamp: '2026-04-06T00:00:00.000Z', level: 'info', message: 'boot ok' }],
              verboseLoggingEnabled: false,
            },
          },
          arrEvidence: { mismatches: [] },
        }}
        adminActions={{
          adminPassword: '',
          controlBusyKey: '',
          controlStatus: '',
          lockBusy: false,
          onAdminPasswordChange: vi.fn(),
          onControl: vi.fn(),
          onUnlock: vi.fn(),
          onLock: vi.fn(),
        }}
      />
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Logs' }));
    expect(screen.getByText('Debug logs')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Help' }));
    expect(screen.getByText('Operator help')).toBeInTheDocument();
    expect(screen.getByText(/Requests go through Jellyseerr/i)).toBeInTheDocument();
  });

  it('removes route and notes rows from terminal workspace metadata', () => {
    render(
      <WorkspaceViewport
        workspace="terminal"
        payload={{ terminal: { label: 'ttyd', status: 'working', route: '/term/' } }}
      />
    );

    expect(screen.queryByText('Route')).not.toBeInTheDocument();
    expect(screen.queryByText('Notes')).not.toBeInTheDocument();
    expect(screen.getByText('Access')).toBeInTheDocument();
  });
});
