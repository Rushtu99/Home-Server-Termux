import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { checkDrives, recheckStorageProtection, repairDriveHelpers } from './api';
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
  repairDriveHelpers: vi.fn(),
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

  it('renders mount events and warning filtering in files workspace', () => {
    render(
      <WorkspaceViewport
        workspace="files"
        payload={{
          drives: {
            manifest: { drives: [] },
            events: [
              { timestamp: '2026-04-24T09:20:50Z', level: 'info', event: 'scan_complete', message: 'USB scan complete', meta: { detected: 2 } },
              { timestamp: '2026-04-24T09:20:51Z', level: 'warn', event: 'mount_failed', message: 'Mount failed', meta: { device: '/dev/block/sdb1' } },
            ],
          },
          shares: [],
          users: [],
          storageProtection: {},
        }}
      />
    );

    expect(screen.getByText('System mount log')).toBeInTheDocument();
    expect(screen.getByText(/Log collapsed by default/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Expand log' }));
    expect(screen.getByText('USB scan complete')).toBeInTheDocument();
    expect(screen.getByText('Mount failed')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Warnings (1)' }));
    expect(screen.getByText('Mount failed')).toBeInTheDocument();
    expect(screen.queryByText('USB scan complete')).not.toBeInTheDocument();
  });

  it('shows settings help and logs tabs', () => {
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

  it('moves storage resume controls from storage workspace into settings workspace', () => {
    render(
      <WorkspaceViewport
        workspace="files"
        payload={{
          drives: { manifest: { drives: [] } },
          shares: [],
          users: [],
          storageProtection: {},
        }}
      />
    );
    expect(screen.queryByRole('button', { name: 'Resume blocked' })).not.toBeInTheDocument();

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
            logs: { entries: [], verboseLoggingEnabled: false },
          },
          arrEvidence: { mismatches: [] },
        }}
      />
    );
    expect(screen.getByRole('button', { name: 'Resume blocked services' })).toBeInTheDocument();
  });

  it('shows helper repair action in files workspace when helpers are unavailable', async () => {
    vi.mocked(checkDrives).mockResolvedValue({
      success: false,
      code: 'usb_mount_helper_missing',
      error: 'USB mount service is not installed',
      installHint: 'Run helper repair',
      storageProtection: { state: 'unknown' },
    });
    vi.mocked(repairDriveHelpers).mockResolvedValue({ success: true });

    render(
      <WorkspaceViewport
        workspace="files"
        payload={{
          drives: { manifest: { drives: [] }, events: [] },
          shares: [],
          users: [],
          storageProtection: { available: false, state: 'unknown' },
        }}
      />
    );

    const checkButton = screen.getByRole('button', { name: 'Check drives (manual)' });
    fireEvent.click(checkButton);
    expect(await screen.findByText(/Storage status: unknown/i)).toBeInTheDocument();

    const repairButton = screen.getByRole('button', { name: 'Install/Repair helpers' });
    fireEvent.click(repairButton);
    expect(await screen.findByText(/Storage helper repair completed/i)).toBeInTheDocument();
  });

  it('shows watchdog helper missing status in settings storage controls', async () => {
    vi.mocked(recheckStorageProtection).mockResolvedValue({
      success: false,
      code: 'watchdog_helper_missing',
      error: 'Storage watchdog helper is not installed',
      installHint: 'Run helper repair',
      storageProtection: {
        state: 'unknown',
        reasonCompact: 'watchdog state unknown',
      },
    });

    render(
      <WorkspaceViewport
        workspace="admin"
        payload={{
          dashboard: {
            generatedAt: '2026-04-06T00:00:00.000Z',
            serviceCatalog: [],
            serviceController: { locked: false, optionalServices: [] },
            networkExposure: { core: [], services: [], overall: 'unknown' },
            tailscale: {},
            remoteAccess: { gateway: {}, ssh: {} },
            logs: { entries: [], verboseLoggingEnabled: false },
          },
          arrEvidence: { mismatches: [] },
        }}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Recheck storage' }));
    expect(await screen.findByText(/watchdog helper is not available|watchdog helper is not installed/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Install/Repair helpers' })).toBeInTheDocument();
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

  it('prefers control-plane catalog services over dashboard service catalog in settings inventory', () => {
    render(
      <WorkspaceViewport
        workspace="admin"
        payload={{
          dashboard: {
            generatedAt: '2026-04-06T00:00:00.000Z',
            serviceCatalog: [
              {
                key: 'legacy-service',
                label: 'Legacy Dashboard Service',
                status: 'working',
                available: true,
                controlMode: 'manual',
                description: 'Dashboard-only service',
              },
            ],
            serviceController: { locked: false, optionalServices: [] },
            networkExposure: { core: [], services: [], overall: 'unknown' },
            tailscale: {},
            remoteAccess: { gateway: {}, ssh: {} },
            logs: { entries: [], verboseLoggingEnabled: false },
          },
          controlPlane: {
            catalog: {
              generatedAt: '2026-04-06T00:00:01.000Z',
              services: [
                {
                  key: 'cp-service',
                  label: 'Control Plane Service',
                  status: 'working',
                  available: true,
                  controlMode: 'manual',
                  description: 'Control-plane inventory entry',
                },
              ],
            },
          },
          arrEvidence: { mismatches: [] },
        }}
      />
    );

    expect(screen.getByText('Control Plane Service')).toBeInTheDocument();
    expect(screen.queryByText('Legacy Dashboard Service')).not.toBeInTheDocument();
  });

  it('surfaces service-state summary and workflows in settings controls tab when control-plane data exists', () => {
    render(
      <WorkspaceViewport
        workspace="admin"
        payload={{
          dashboard: {
            generatedAt: '2026-04-06T00:00:00.000Z',
            serviceCatalog: [],
            serviceController: { locked: false, optionalServices: [] },
            networkExposure: { core: [], services: [], overall: 'unknown' },
            tailscale: {},
            remoteAccess: { gateway: {}, ssh: {} },
            logs: { entries: [], verboseLoggingEnabled: false },
          },
          controlPlane: {
            catalog: {
              generatedAt: '2026-04-06T00:00:01.000Z',
              services: [],
            },
            serviceState: {
              generatedAt: '2026-04-06T00:00:02.000Z',
              state: 'working',
              counts: { total: 5, working: 4, blocked: 1 },
              services: [{ key: 'jellyfin' }],
            },
            workflows: [{ key: 'daily-sync', summary: 'Refresh metadata and caches' }],
            workflowRuns: [{ workflowKey: 'daily-sync', status: 'success', startedAt: '2026-04-06T00:01:00.000Z' }],
          },
          arrEvidence: { mismatches: [] },
        }}
      />
    );

    expect(screen.getByText('Control-plane workflows')).toBeInTheDocument();
    expect(screen.getAllByText(/daily-sync/i).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/working:4/i).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/success/i)).toBeInTheDocument();
  });

  it('shows control-plane snapshot errors in settings controls tab', () => {
    render(
      <WorkspaceViewport
        workspace="admin"
        payload={{
          dashboard: {
            generatedAt: '2026-04-06T00:00:00.000Z',
            serviceCatalog: [],
            serviceController: { locked: false, optionalServices: [] },
            networkExposure: { core: [], services: [], overall: 'unknown' },
            tailscale: {},
            remoteAccess: { gateway: {}, ssh: {} },
            logs: { entries: [], verboseLoggingEnabled: false },
          },
          controlPlane: {
            catalog: {
              generatedAt: '2026-04-06T00:00:01.000Z',
              services: [],
            },
            errors: ['state/services timeout'],
            serviceState: {},
            workflows: [],
            workflowRuns: [],
          },
          arrEvidence: { mismatches: [] },
        }}
      />
    );

    expect(screen.getByText(/Control-plane snapshot warnings:/i)).toBeInTheDocument();
    expect(screen.getByText(/state\/services timeout/i)).toBeInTheDocument();
  });

  it('saves IPTV draft values locally and opens source URL tests', () => {
    const originalLocalStorage = Object.getOwnPropertyDescriptor(window, 'localStorage');
    const localStore = new Map<string, string>();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => (localStore.has(key) ? localStore.get(key) || null : null),
        removeItem: (key: string) => {
          localStore.delete(key);
        },
        setItem: (key: string, value: string) => {
          localStore.set(key, String(value));
        },
      },
    });
    const openSpy = vi.spyOn(window, 'open').mockReturnValue({ opener: null } as unknown as Window);
    render(
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
          services: [],
          arrDiagnostics: { healthy: 0, total: 0 },
          qbDiagnostics: {
            webUiReachable: false,
            categories: {},
          },
        }}
      />
    );

    fireEvent.change(screen.getByLabelText('M3U / M3U8 playlist source'), { target: { value: 'https://example/live.m3u8' } });
    fireEvent.change(screen.getByLabelText('XMLTV guide source'), { target: { value: '/data/data/com.termux/files/home/guide.xml' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Draft Locally' }));
    fireEvent.click(screen.getByRole('button', { name: 'Test Source URL' }));

    const savedRaw = localStore.get('dash2:iptv-config-draft:v1');
    expect(savedRaw).toContain('https://example/live.m3u8');
    expect(savedRaw).toContain('/data/data/com.termux/files/home/guide.xml');
    expect(openSpy).toHaveBeenCalledWith('https://example/live.m3u8', '_blank', 'noopener,noreferrer');
    openSpy.mockRestore();
    if (originalLocalStorage) {
      Object.defineProperty(window, 'localStorage', originalLocalStorage);
    }
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

  it('renders stitch parity telemetry card when design telemetry exists', () => {
    render(
      <WorkspaceViewport
        workspace="overview"
        payload={{
          telemetry: { monitor: {}, lifecycle: {}, logs: { entries: [] } },
          storage: { mounts: [] },
          connections: { users: [] },
          drives: { manifest: { drives: [] } },
          designTelemetry: {
            workspace: 'overview',
            integrityIndexPct: 98.2,
            mountedDriveCount: 3,
          },
        }}
      />
    );

    expect(screen.getByText('Stitch parity telemetry')).toBeInTheDocument();
    expect(screen.getByText('98%')).toBeInTheDocument();
    expect(screen.getByText('3 mounted')).toBeInTheDocument();
  });

  it('keeps disconnect available for same-username concurrent sessions', () => {
    render(
      <WorkspaceViewport
        workspace="overview"
        payload={{
          telemetry: { monitor: {}, lifecycle: {}, logs: { entries: [] } },
          storage: { mounts: [] },
          connections: {
            users: [
              { sessionId: 'session-a', username: 'admin', status: 'active', ip: '127.0.0.1', protocol: 'http', port: '8088' },
              { sessionId: 'session-b', username: 'admin', status: 'active', ip: '127.0.0.1', protocol: 'http', port: '8088' },
            ],
          },
          drives: { manifest: { drives: [] } },
        }}
        workspaceActions={{ currentUsername: 'admin', onRefresh: vi.fn() }}
      />
    );

    expect(screen.queryByRole('button', { name: 'Current session' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Disconnect' })).toHaveLength(2);
  });
});
