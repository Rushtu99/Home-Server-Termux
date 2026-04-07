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
  it('renders compact ARR controls for the media workspace layout', () => {
    const { container } = render(
      <WorkspaceViewport
        workspace="media"
        payload={{
          mediaWorkflow: {
            watch: { label: 'Jellyfin', summary: 'Playback ready', serviceKeys: ['jellyfin'], status: 'working' },
            requests: { status: 'working', serviceKeys: ['jellyseerr'], summary: 'Requests online' },
            automation: { status: 'working', healthy: 3, total: 3, serviceKeys: ['prowlarr', 'sonarr', 'radarr'] },
            subtitles: { status: 'working', summary: 'Bazarr healthy' },
            liveTv: { channelCount: 12, summary: 'Guide synced', status: 'working' },
          },
          mediaHealth: {
            available: false,
            status: 'unavailable',
            error: 'No Jellyfin API key configured',
            totals: {},
            libraries: [],
            activeSessions: [],
          },
          services: [
            { key: 'sonarr', label: 'Sonarr', available: true, status: 'working', route: '/sonarr/', description: 'Series automation' },
            { key: 'radarr', label: 'Radarr', available: true, status: 'working', route: '/radarr/', description: 'Movie automation' },
            { key: 'prowlarr', label: 'Prowlarr', available: true, status: 'working', route: '/prowlarr/', description: 'Indexer sync' },
            { key: 'bazarr', label: 'Bazarr', available: true, status: 'working', route: '/bazarr/', description: 'Subtitle sync' },
            { key: 'jellyseerr', label: 'Jellyseerr', available: true, status: 'working', route: '/jellyseerr/', description: 'Requests' },
          ],
          arrDiagnostics: { healthy: 4, total: 4 },
          qbDiagnostics: {
            webUiReachable: true,
            version: '5.0.0',
            baseUrl: 'http://127.0.0.1:8081',
            defaultSavePath: '/downloads/manual',
            categories: {
              movies: '/downloads/movies',
              series: '/downloads/series',
              standalone: '/downloads/manual',
            },
          },
        }}
      />
    );

    expect(screen.getByText('ARR + qB diagnostics')).toBeInTheDocument();
    expect(screen.getByText('Torrent source')).toBeInTheDocument();
    expect(screen.getByText('Media type')).toBeInTheDocument();
    expect(screen.getByText('Add to ARR queue')).toBeInTheDocument();
    expect(container.querySelectorAll('a.ui-button').length).toBeGreaterThanOrEqual(4);
    expect(container.querySelector('.dash2-torrent-controls__row')).toBeTruthy();
    expect(container.querySelectorAll('.dash2-service-admin-card__actions--compact').length).toBeGreaterThan(0);
  });

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

  it('keeps unlocked admin controls in the compact action row', () => {
    const { container } = render(
      <WorkspaceViewport
        workspace="admin"
        payload={{
          dashboard: {
            generatedAt: '2026-04-06T00:00:00.000Z',
            serviceCatalog: [
              {
                key: 'jellyseerr',
                label: 'Jellyseerr',
                status: 'working',
                available: true,
                controlMode: 'manual',
                description: 'Request intake',
              },
            ],
            serviceController: { locked: false, optionalServices: ['jellyseerr'] },
            networkExposure: { core: [], services: [], overall: 'unknown' },
            tailscale: {},
            remoteAccess: { gateway: {}, ssh: {} },
            logs: { entries: [], verboseLoggingEnabled: false },
          },
          arrEvidence: { mismatches: [] },
        }}
        adminActions={{
          adminPassword: 'secret',
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

    expect(screen.getByRole('button', { name: 'Start' })).toHaveClass('dash2-ui-button--small');
    expect(screen.getByRole('button', { name: 'Stop' })).toHaveClass('dash2-ui-button--small');
    expect(screen.getByRole('button', { name: 'Restart' })).toHaveClass('dash2-ui-button--small');
    expect(container.querySelector('.dash2-service-admin-card__actions--compact')).toBeTruthy();
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
