'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  checkDrives,
  disconnectConnection,
  mountFtpFavourite,
  recheckStorageProtection,
  refreshOnlineModels,
  resumeStorageProtection,
  sendLlmChat,
  selectLlmModel,
  selectOnlineModel,
  unmountFtpFavourite,
} from './api';
import { EmptyState, KeyValueList, MetricGrid, MetricTile, SectionCard, ServiceList, StatusBadge } from './components';
import { toErrorMessage } from './errors';
import type { WorkspaceKey } from './types';

const asRecord = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' ? value as Record<string, unknown> : {});
const asArray = <T,>(value: unknown): T[] => (Array.isArray(value) ? value as T[] : []);
const toServiceListItems = (entries: Array<Record<string, unknown>>) =>
  entries.map((entry) => ({
    key: String(entry.key || ''),
    label: String(entry.label || entry.key || 'Service'),
    status: String(entry.status || 'unknown'),
    available: Boolean(entry.available),
    summary: String(entry.description || entry.blocker || ''),
  }));
type ServiceControlAction = 'start' | 'stop' | 'restart';
type WorkspaceActions = {
  onRefresh: () => void;
  currentUsername?: string;
};
type AdminActions = {
  adminPassword: string;
  controlBusyKey: string;
  controlStatus: string;
  lockBusy: boolean;
  onAdminPasswordChange: (value: string) => void;
  onControl: (serviceKey: string, action: ServiceControlAction) => void;
  onUnlock: () => void;
  onLock: () => void;
};

const toPercent = (value: unknown) => {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) {
    return '0%';
  }
  return `${Math.round(num)}%`;
};

function OverviewWorkspace({
  payload,
  workspaceActions,
}: {
  payload: Record<string, unknown>;
  workspaceActions?: WorkspaceActions;
}) {
  const telemetry = asRecord(payload.telemetry);
  const lifecycle = asRecord(telemetry.lifecycle);
  const monitor = asRecord(telemetry.monitor);
  const lifecycleCounts = asRecord(lifecycle.counts);
  const connections = asRecord(payload.connections);
  const users = asArray<Record<string, unknown>>(connections.users);
  const storage = asRecord(payload.storage);
  const mounts = asArray<Record<string, unknown>>(storage.mounts);
  const [sessionBusy, setSessionBusy] = useState('');
  const [sessionStatus, setSessionStatus] = useState('');

  const handleDisconnect = async (sessionId: string) => {
    if (!sessionId) {
      return;
    }
    setSessionBusy(sessionId);
    try {
      const response = await disconnectConnection(sessionId);
      setSessionStatus(response.success === false ? String(response.error || 'Disconnect failed') : 'Session disconnected.');
      workspaceActions?.onRefresh();
    } catch (error) {
      setSessionStatus(toErrorMessage(error, 'Disconnect failed'));
    } finally {
      setSessionBusy('');
    }
  };

  return (
    <>
      <MetricGrid>
        <MetricTile label="Stack state" value={<StatusBadge tone={String(lifecycle.state || '').toLowerCase() === 'healthy' ? 'ok' : 'warn'}>{String(lifecycle.state || 'unknown')}</StatusBadge>} />
        <MetricTile label="CPU load" value={toPercent(monitor.cpuLoad)} helper="Average process load" />
        <MetricTile label="RAM used" value={`${Math.round((Number(monitor.usedMem || 0) / Math.max(1, Number(monitor.totalMem || 1))) * 100)}%`} helper="From telemetry snapshot" />
        <MetricTile label="Live sessions" value={users.length} helper="Connected dashboard users" />
      </MetricGrid>

      <SectionCard title="Lifecycle health" subtitle="Service state distribution across the host.">
        <KeyValueList
          rows={[
            { label: 'Healthy', value: Number(lifecycleCounts.healthy || 0) },
            { label: 'Degraded', value: Number(lifecycleCounts.degraded || 0) },
            { label: 'Blocked', value: Number(lifecycleCounts.blocked || 0) },
            { label: 'Stopped', value: Number(lifecycleCounts.stopped || 0) },
            { label: 'Crashed', value: Number(lifecycleCounts.crashed || 0) },
          ]}
        />
      </SectionCard>

      <SectionCard title="Storage mounts" subtitle="Current mount inventory from the backend.">
        {mounts.length === 0 ? <EmptyState title="No mounts" message="Storage telemetry is currently unavailable." /> : (
          <ul className="dash2-list">
            {mounts.map((entry, index) => (
              <li key={`${String(entry.mount || entry.filesystem || 'mount')}-${index}`}>
                <div>
                  <strong>{String(entry.mount || entry.filesystem || 'mount')}</strong>
                  <p>{String(entry.category || entry.fsType || 'storage')}</p>
                </div>
                <StatusBadge tone="muted">{toPercent(entry.usePercent)}</StatusBadge>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard title="Active sessions" subtitle="Current connected dashboard users and remote endpoints.">
        {sessionStatus ? <p className="dash2-admin-note">{sessionStatus}</p> : null}
        {users.length === 0 ? <EmptyState title="No sessions" message="No active sessions are currently reported." /> : (
          <ul className="dash2-list">
            {users.map((entry, index) => {
              const sessionId = String(entry.sessionId || '');
              const username = String(entry.username || 'user');
              const isCurrentUser = workspaceActions?.currentUsername && workspaceActions.currentUsername === username;
              return (
                <li key={`${sessionId || username}-${index}`}>
                  <div>
                    <strong>{username}</strong>
                    <p>{String(entry.ip || 'ip')} · {String(entry.protocol || 'protocol')}:{String(entry.port || 'n/a')}</p>
                  </div>
                  <div className="dash2-list__actions">
                    <StatusBadge tone={String(entry.status || '').toLowerCase() === 'active' ? 'ok' : 'muted'}>
                      {String(entry.status || 'unknown')}
                    </StatusBadge>
                    <button
                      className="ui-button"
                      type="button"
                      disabled={isCurrentUser || sessionBusy === sessionId}
                      onClick={() => void handleDisconnect(sessionId)}
                    >
                      {sessionBusy === sessionId ? 'Disconnecting…' : isCurrentUser ? 'Current session' : 'Disconnect'}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>
    </>
  );
}

function MediaWorkspace({ payload }: { payload: Record<string, unknown> }) {
  const mediaWorkflow = asRecord(payload.mediaWorkflow);
  const watch = asRecord(mediaWorkflow.watch);
  const requests = asRecord(mediaWorkflow.requests);
  const automation = asRecord(mediaWorkflow.automation);
  const support = asRecord(mediaWorkflow.support);
  const liveTv = asRecord(mediaWorkflow.liveTv);
  const services = asArray<Record<string, unknown>>(payload.services);

  return (
    <>
      <MetricGrid>
        <MetricTile label="Watch surface" value={String(watch.label || 'Jellyfin')} helper={String(watch.summary || 'Primary playback surface')} />
        <MetricTile label="Requests" value={String(requests.status || 'unknown')} helper={String(requests.summary || 'Request workflow status')} />
        <MetricTile label="Automation" value={String(automation.status || 'unknown')} helper={String(automation.summary || 'Automation lane status')} />
        <MetricTile label="Live TV" value={`${Number(liveTv.channelCount || 0)} channels`} helper={String(liveTv.summary || 'Live TV readiness')} />
      </MetricGrid>

      <SectionCard title="Media workflow" subtitle="Unified watch → request → automate flow.">
        <KeyValueList
          rows={[
            { label: 'Watch', value: String(watch.summary || 'N/A') },
            { label: 'Requests', value: String(requests.summary || 'N/A') },
            { label: 'Automation', value: String(automation.summary || 'N/A') },
            { label: 'Support', value: String(support.summary || 'N/A') },
          ]}
        />
      </SectionCard>

      <SectionCard title="Media services" subtitle="Service catalog entries tied to media workflows.">
        <ServiceList items={toServiceListItems(services)} />
      </SectionCard>

      <SectionCard title="Media quick links" subtitle="Open installed media surfaces from the service catalog routes.">
        <ul className="dash2-list">
          {services
            .filter((entry) => Boolean(entry.route))
            .map((entry, index) => (
              <li key={`${String(entry.key || 'route')}-${index}`}>
                <div>
                  <strong>{String(entry.label || entry.key || 'Service')}</strong>
                  <p>{String(entry.route || '')}</p>
                </div>
                <a className="ui-button ui-button--primary" href={String(entry.route || '#')} target="_blank" rel="noreferrer">
                  Open
                </a>
              </li>
            ))}
        </ul>
      </SectionCard>
    </>
  );
}

function FilesWorkspace({
  payload,
  workspaceActions,
}: {
  payload: Record<string, unknown>;
  workspaceActions?: WorkspaceActions;
}) {
  const drivesPayload = asRecord(payload.drives);
  const manifest = asRecord(drivesPayload.manifest);
  const drives = asArray<Record<string, unknown>>(manifest.drives);
  const shares = asArray<Record<string, unknown>>(payload.shares);
  const users = asArray<Record<string, unknown>>(payload.users);
  const protection = asRecord(payload.storageProtection);
  const [actionBusy, setActionBusy] = useState<'drives' | 'recheck' | 'resume' | ''>('');
  const [actionStatus, setActionStatus] = useState('');

  const runDriveCheck = async () => {
    setActionBusy('drives');
    try {
      const response = await checkDrives();
      setActionStatus(response.success === false ? String(response.error || 'Drive check failed') : 'Drive check requested.');
    } catch (error) {
      setActionStatus(toErrorMessage(error, 'Drive check failed'));
    } finally {
      setActionBusy('');
      workspaceActions?.onRefresh();
    }
  };

  const runStorageRecheck = async () => {
    setActionBusy('recheck');
    try {
      const response = await recheckStorageProtection();
      setActionStatus(response.success === false ? String(response.error || 'Storage recheck failed') : 'Storage recheck requested.');
    } catch (error) {
      setActionStatus(toErrorMessage(error, 'Storage recheck failed'));
    } finally {
      setActionBusy('');
      workspaceActions?.onRefresh();
    }
  };

  const runStorageResume = async () => {
    setActionBusy('resume');
    try {
      const response = await resumeStorageProtection();
      if (Array.isArray(response.failed) && response.failed.length > 0) {
        setActionStatus(`Resume partial: ${response.failed.length} service(s) failed.`);
      } else if (response.success === false) {
        setActionStatus(String(response.error || 'Storage resume failed'));
      } else {
        setActionStatus('Storage resume requested.');
      }
    } catch (error) {
      setActionStatus(toErrorMessage(error, 'Storage resume failed'));
    } finally {
      setActionBusy('');
      workspaceActions?.onRefresh();
    }
  };

  return (
    <>
      <MetricGrid>
        <MetricTile label="Drives detected" value={drives.length} helper="Includes removable and internal roots" />
        <MetricTile label="Shares" value={shares.length} helper="Managed shares available to dashboard users" />
        <MetricTile label="Users" value={users.length} helper="Account inventory for permission policy" />
        <MetricTile label="Protection" value={String(protection.state || 'unknown')} helper={String(protection.reason || 'Storage watchdog state')} />
      </MetricGrid>

      <SectionCard
        title="Filesystem workspace"
        subtitle="Use the dedicated Files route for full browser + operations tools."
        actions={(
          <>
            <button className="ui-button" type="button" onClick={runDriveCheck} disabled={actionBusy !== ''}>
              {actionBusy === 'drives' ? 'Checking…' : 'Check drives'}
            </button>
            <button className="ui-button" type="button" onClick={runStorageRecheck} disabled={actionBusy !== ''}>
              {actionBusy === 'recheck' ? 'Rechecking…' : 'Recheck storage'}
            </button>
            <button className="ui-button" type="button" onClick={runStorageResume} disabled={actionBusy !== ''}>
              {actionBusy === 'resume' ? 'Resuming…' : 'Resume blocked'}
            </button>
            <Link className="ui-button ui-button--primary" href="/files">Open /files workspace</Link>
          </>
        )}
      >
        {actionStatus ? <p className="dash2-admin-note">{actionStatus}</p> : null}
        <ul className="dash2-list">
          {drives.map((drive, index) => (
            <li key={`${String(drive.device || drive.mountPoint || 'drive')}-${index}`}>
              <div>
                <strong>{String(drive.dirName || drive.name || drive.letter || 'Drive')}</strong>
                <p>{String(drive.mountPoint || 'mount unavailable')}</p>
              </div>
              <StatusBadge tone={String(drive.state || '').toLowerCase() === 'mounted' ? 'ok' : 'warn'}>
                {String(drive.state || 'unknown')}
              </StatusBadge>
            </li>
          ))}
        </ul>
      </SectionCard>
    </>
  );
}

function TransfersWorkspace({
  payload,
  workspaceActions,
}: {
  payload: Record<string, unknown>;
  workspaceActions?: WorkspaceActions;
}) {
  const defaults = asRecord(payload.ftpDefaults);
  const favourites = asArray<Record<string, unknown>>(payload.favourites);
  const services = asArray<Record<string, unknown>>(payload.services);
  const [favouriteBusyId, setFavouriteBusyId] = useState<number>(0);
  const [favouriteStatus, setFavouriteStatus] = useState('');

  const handleToggleMount = async (favourite: Record<string, unknown>) => {
    const favouriteId = Number(favourite.id || 0);
    const mount = asRecord(favourite.mount);
    if (favouriteId <= 0) {
      return;
    }

    setFavouriteBusyId(favouriteId);
    try {
      if (Boolean(mount.mounted)) {
        const response = await unmountFtpFavourite(favouriteId);
        setFavouriteStatus(response.success === false ? String(response.error || 'Unmount failed') : 'Favourite unmounted.');
      } else {
        const response = await mountFtpFavourite(favouriteId);
        setFavouriteStatus(response.success === false ? String(response.error || 'Mount failed') : 'Favourite mounted.');
      }
      workspaceActions?.onRefresh();
    } catch (error) {
      setFavouriteStatus(toErrorMessage(error, 'Unable to toggle mount'));
    } finally {
      setFavouriteBusyId(0);
    }
  };

  return (
    <>
      <MetricGrid>
        <MetricTile label="FTP host" value={String(defaults.host || 'n/a')} helper={`Port ${String(defaults.port || '21')}`} />
        <MetricTile label="Secure mode" value={Boolean(defaults.secure) ? 'Enabled' : 'Disabled'} helper="Client defaults" />
        <MetricTile label="Saved remotes" value={favourites.length} helper="Configured favourite connections" />
        <MetricTile label="Download root" value={String(defaults.downloadRoot || 'n/a')} />
      </MetricGrid>

      <SectionCard title="FTP favourites" subtitle="Saved remote mounts and transfer targets.">
        {favouriteStatus ? <p className="dash2-admin-note">{favouriteStatus}</p> : null}
        {favourites.length === 0 ? <EmptyState title="No favourites" message="Create an FTP favourite from the transfer tools." /> : (
          <ul className="dash2-list">
            {favourites.map((item, index) => {
              const mount = asRecord(item.mount);
              const itemId = Number(item.id || 0);
              return (
                <li key={`${String(item.id || item.name || 'favourite')}-${index}`}>
                  <div>
                    <strong>{String(item.name || 'Remote')}</strong>
                    <p>{String(item.host || 'host')}:{String(item.port || 21)} · {String(item.remotePath || '/')}</p>
                  </div>
                  <div className="dash2-list__actions">
                    <StatusBadge tone={Boolean(mount.mounted) ? 'ok' : 'muted'}>{String(mount.state || 'unmounted')}</StatusBadge>
                    <button className="ui-button" type="button" disabled={favouriteBusyId === itemId} onClick={() => void handleToggleMount(item)}>
                      {favouriteBusyId === itemId ? 'Working…' : Boolean(mount.mounted) ? 'Unmount' : 'Mount'}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      <SectionCard title="Transfer-related services" subtitle="Access and download surface status.">
        <ServiceList items={toServiceListItems(services)} />
      </SectionCard>
    </>
  );
}

function AiWorkspace({
  payload,
  workspaceActions,
}: {
  payload: Record<string, unknown>;
  workspaceActions?: WorkspaceActions;
}) {
  const llm = asRecord(payload.llmState);
  const models = asArray<Record<string, unknown>>(llm.models);
  const online = asRecord(llm.online);
  const onlineModels = asArray<Record<string, unknown>>(online.models);
  const firstOnlineModelId = String(onlineModels[0]?.id || '');
  const [modelId, setModelId] = useState(String(llm.activeModelId || ''));
  const [onlineModelId, setOnlineModelId] = useState(String(online.activeModelId || firstOnlineModelId || ''));
  const [llmBusy, setLlmBusy] = useState<'local' | 'online-refresh' | 'online' | ''>('');
  const [llmStatus, setLlmStatus] = useState('');
  const [chatMode, setChatMode] = useState<'local' | 'online'>('local');
  const [chatInput, setChatInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [chatStatus, setChatStatus] = useState('');
  const [chatConversationId, setChatConversationId] = useState<number | null>(null);
  const [chatTranscript, setChatTranscript] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);

  useEffect(() => {
    setModelId(String(llm.activeModelId || ''));
  }, [llm.activeModelId]);

  useEffect(() => {
    setOnlineModelId(String(online.activeModelId || firstOnlineModelId || ''));
  }, [online.activeModelId, firstOnlineModelId]);

  const applyLocalModel = async () => {
    if (!modelId.trim()) {
      return;
    }
    setLlmBusy('local');
    try {
      const response = await selectLlmModel(modelId.trim());
      setLlmStatus(response.success === false ? String(response.error || 'Unable to select local model') : 'Local model updated.');
      workspaceActions?.onRefresh();
    } catch (error) {
      setLlmStatus(toErrorMessage(error, 'Unable to select local model'));
    } finally {
      setLlmBusy('');
    }
  };

  const refreshOnline = async () => {
    setLlmBusy('online-refresh');
    try {
      const response = await refreshOnlineModels();
      setLlmStatus(response.success === false ? String(response.error || 'Unable to refresh online models') : 'Online models refreshed.');
      workspaceActions?.onRefresh();
    } catch (error) {
      setLlmStatus(toErrorMessage(error, 'Unable to refresh online models'));
    } finally {
      setLlmBusy('');
    }
  };

  const applyOnlineModel = async () => {
    if (!onlineModelId.trim()) {
      return;
    }
    setLlmBusy('online');
    try {
      const response = await selectOnlineModel(onlineModelId.trim());
      setLlmStatus(response.success === false ? String(response.error || 'Unable to select online model') : 'Online model updated.');
      workspaceActions?.onRefresh();
    } catch (error) {
      setLlmStatus(toErrorMessage(error, 'Unable to select online model'));
    } finally {
      setLlmBusy('');
    }
  };

  const sendQuickPrompt = async () => {
    const message = chatInput.trim();
    if (!message) {
      return;
    }

    setChatBusy(true);
    setChatStatus('');
    setChatTranscript((current) => [...current, { role: 'user', content: message }]);
    setChatInput('');

    try {
      const response = await sendLlmChat({
        message,
        mode: chatMode,
        conversationId: chatConversationId,
        onlineModelId: chatMode === 'online' ? onlineModelId || undefined : undefined,
      });

      if (response.success === false || response.error) {
        const errorMessage = String(response.error || 'Chat request failed');
        setChatStatus(errorMessage);
        setChatTranscript((current) => [...current, { role: 'assistant', content: `Error: ${errorMessage}` }]);
      } else {
        const assistantText = String(response.assistantMessage?.content || '').trim() || 'No response text returned.';
        setChatTranscript((current) => [...current, { role: 'assistant', content: assistantText }]);
        if (Number.isInteger(response.conversationId) && Number(response.conversationId) > 0) {
          setChatConversationId(Number(response.conversationId));
        }
      }
    } catch (error) {
      const errorMessage = toErrorMessage(error, 'Chat request failed');
      setChatStatus(errorMessage);
      setChatTranscript((current) => [...current, { role: 'assistant', content: `Error: ${errorMessage}` }]);
    } finally {
      setChatBusy(false);
      workspaceActions?.onRefresh();
    }
  };

  return (
    <>
      <MetricGrid>
        <MetricTile label="Runtime" value={Boolean(llm.running) ? 'Running' : 'Stopped'} helper={String(llm.blocker || 'Local LLM service state')} />
        <MetricTile label="Active model" value={String(llm.activeModelId || 'none')} helper="Selected local or online model" />
        <MetricTile label="Installed models" value={models.filter((entry) => Boolean(entry.installed)).length} helper={`${models.length} total configured`} />
        <MetricTile label="Online provider" value={Boolean(online.available) ? 'Available' : 'Unavailable'} helper={String(online.error || 'Online model provider status')} />
      </MetricGrid>

      <SectionCard title="Model inventory" subtitle="Local and online model status snapshots.">
        <div className="dash2-llm-controls">
          <label>
            <span>Local model</span>
            <select className="ui-input" value={modelId} onChange={(event) => setModelId(event.target.value)}>
              {models.map((entry, index) => (
                <option key={`${String(entry.id || 'model')}-${index}`} value={String(entry.id || '')}>
                  {String(entry.label || entry.id || 'Model')}
                </option>
              ))}
            </select>
          </label>
          <button className="ui-button" type="button" disabled={llmBusy !== ''} onClick={() => void applyLocalModel()}>
            {llmBusy === 'local' ? 'Applying…' : 'Use local model'}
          </button>
          <button className="ui-button" type="button" disabled={llmBusy !== ''} onClick={() => void refreshOnline()}>
            {llmBusy === 'online-refresh' ? 'Refreshing…' : 'Refresh online models'}
          </button>
          <label>
            <span>Online model</span>
            <select className="ui-input" value={onlineModelId} onChange={(event) => setOnlineModelId(event.target.value)}>
              {onlineModels.length === 0 ? <option value="">No models</option> : null}
              {onlineModels.map((entry, index) => (
                <option key={`${String(entry.id || 'online')}-${index}`} value={String(entry.id || '')}>
                  {String(entry.label || entry.id || 'Model')}
                </option>
              ))}
            </select>
          </label>
          <button className="ui-button" type="button" disabled={llmBusy !== '' || !onlineModelId} onClick={() => void applyOnlineModel()}>
            {llmBusy === 'online' ? 'Applying…' : 'Use online model'}
          </button>
        </div>
        {llmStatus ? <p className="dash2-admin-note">{llmStatus}</p> : null}
        {models.length === 0 ? <EmptyState title="No models" message="No local models are configured." /> : (
          <ul className="dash2-list">
            {models.map((entry, index) => (
              <li key={`${String(entry.id || 'model')}-${index}`}>
                <div>
                  <strong>{String(entry.label || entry.id || 'Model')}</strong>
                  <p>{String(entry.path || 'No path')}</p>
                </div>
                <StatusBadge tone={Boolean(entry.installed) ? 'ok' : 'warn'}>{Boolean(entry.installed) ? 'installed' : 'missing'}</StatusBadge>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard title="Quick chat" subtitle="Send a direct test prompt to the configured local or online model.">
        <div className="dash2-chat-controls">
          <label>
            <span>Chat mode</span>
            <select className="ui-input" value={chatMode} onChange={(event) => setChatMode(event.target.value === 'online' ? 'online' : 'local')}>
              <option value="local">Local</option>
              <option value="online">Online</option>
            </select>
          </label>
          <label>
            <span>Prompt</span>
            <textarea
              className="ui-input dash2-chat-input"
              rows={4}
              value={chatInput}
              onChange={(event) => setChatInput(event.target.value)}
              placeholder="Ask a quick question to validate model routing and response health…"
            />
          </label>
          <div className="dash2-chat-actions">
            <button className="ui-button ui-button--primary" type="button" disabled={chatBusy || !chatInput.trim()} onClick={() => void sendQuickPrompt()}>
              {chatBusy ? 'Sending…' : 'Send prompt'}
            </button>
            <button className="ui-button" type="button" disabled={chatBusy || chatTranscript.length === 0} onClick={() => setChatTranscript([])}>
              Clear transcript
            </button>
            {chatConversationId ? <StatusBadge tone="muted">Conversation #{chatConversationId}</StatusBadge> : null}
          </div>
          {chatStatus ? <p className="dash2-admin-note">{chatStatus}</p> : null}
        </div>
        {chatTranscript.length > 0 ? (
          <div className="dash2-chat-log" aria-live="polite">
            {chatTranscript.map((entry, index) => (
              <article key={`${entry.role}-${index}`} className={`dash2-chat-log__entry dash2-chat-log__entry--${entry.role}`}>
                <strong>{entry.role === 'user' ? 'You' : 'Assistant'}</strong>
                <p>{entry.content}</p>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState title="No conversation yet" message="Send a prompt to validate LLM chat end-to-end from the v2 dashboard." />
        )}
      </SectionCard>
    </>
  );
}

function TerminalWorkspace({ payload }: { payload: Record<string, unknown> }) {
  const terminal = asRecord(payload.terminal);

  return (
    <SectionCard
      title="Terminal workspace"
      subtitle="Shell access health and route metadata."
      actions={<Link href="/term" className="ui-button ui-button--primary">Open terminal route</Link>}
    >
      <KeyValueList
        rows={[
          { label: 'Service', value: String(terminal.label || terminal.key || 'ttyd') },
          { label: 'Status', value: String(terminal.status || 'unknown') },
          { label: 'Route', value: String(terminal.route || '/term/') },
          { label: 'Notes', value: String(terminal.description || terminal.blocker || 'Terminal route served through gateway') },
        ]}
      />
    </SectionCard>
  );
}

function AdminWorkspace({
  payload,
  adminActions,
}: {
  payload: Record<string, unknown>;
  adminActions?: AdminActions;
}) {
  const dashboard = asRecord(payload.dashboard);
  const serviceCatalog = asArray<Record<string, unknown>>(dashboard.serviceCatalog);
  const controller = asRecord(dashboard.serviceController);
  const optionalControls = new Set(asArray<string>(controller.optionalServices));
  const locked = Boolean(controller.locked);

  return (
    <>
      <MetricGrid>
        <MetricTile label="Service catalog" value={serviceCatalog.length} helper="Entries in controller inventory" />
        <MetricTile label="Controller lock" value={Boolean(controller.locked) ? 'Locked' : 'Unlocked'} helper="Admin action safety gate" />
        <MetricTile label="Optional controls" value={asArray<string>(controller.optionalServices).length} helper="User-controllable optional services" />
        <MetricTile label="Generated" value={String(dashboard.generatedAt || 'unknown')} helper="Snapshot timestamp" />
      </MetricGrid>

      {adminActions ? (
        <SectionCard title="Controller access" subtitle="Unlock service controls and run start/stop/restart actions.">
          <div className="dash2-admin-controls">
            <label>
              <span>Admin password</span>
              <input
                className="ui-input"
                type="password"
                autoComplete="current-password"
                value={adminActions.adminPassword}
                onChange={(event) => adminActions.onAdminPasswordChange(event.target.value)}
                placeholder="Required when controller is locked"
              />
            </label>
            <div className="dash2-admin-controls__actions">
              <button className="ui-button ui-button--primary" type="button" disabled={adminActions.lockBusy} onClick={adminActions.onUnlock}>
                {adminActions.lockBusy ? 'Working…' : locked ? 'Unlock controller' : 'Refresh unlock'}
              </button>
              <button className="ui-button" type="button" disabled={adminActions.lockBusy} onClick={adminActions.onLock}>
                Lock controller
              </button>
              <StatusBadge tone={locked ? 'warn' : 'ok'}>{locked ? 'locked' : 'unlocked'}</StatusBadge>
            </div>
            {adminActions.controlStatus ? <p className="dash2-admin-controls__status">{adminActions.controlStatus}</p> : null}
          </div>
        </SectionCard>
      ) : null}

      <SectionCard title="Admin service inventory" subtitle="Operational state for all registered services.">
        <ServiceList items={toServiceListItems(serviceCatalog)} />
        <div className="dash2-service-admin-grid">
          {serviceCatalog.map((entry, index) => {
            const key = String(entry.key || `service-${index}`);
            const label = String(entry.label || key || 'Service');
            const status = String(entry.status || 'unknown');
            const available = Boolean(entry.available);
            const controlMode = String(entry.controlMode || 'always_on');
            const controllable = adminActions ? optionalControls.has(key) : false;
            const actionBusy = adminActions?.controlBusyKey === key;

            return (
              <article key={`${key}-${index}`} className="dash2-service-admin-card">
                <div className="dash2-service-admin-card__header">
                  <strong>{label}</strong>
                  <StatusBadge tone={status === 'working' ? 'ok' : status === 'unavailable' ? 'danger' : 'warn'}>
                    {status}
                  </StatusBadge>
                </div>
                <p>{String(entry.description || entry.blocker || 'No summary available.')}</p>
                <div className="dash2-service-admin-card__meta">
                  <span>key: {key}</span>
                  <span>mode: {controlMode}</span>
                  <span>{available ? 'available' : 'unavailable'}</span>
                </div>
                {controllable && adminActions ? (
                  <div className="dash2-service-admin-card__actions">
                    <button className="ui-button" type="button" disabled={actionBusy} onClick={() => adminActions.onControl(key, 'start')}>
                      Start
                    </button>
                    <button className="ui-button" type="button" disabled={actionBusy} onClick={() => adminActions.onControl(key, 'stop')}>
                      Stop
                    </button>
                    <button className="ui-button" type="button" disabled={actionBusy} onClick={() => adminActions.onControl(key, 'restart')}>
                      Restart
                    </button>
                  </div>
                ) : (
                  <p className="dash2-admin-note">No direct controller action exposed for this service.</p>
                )}
              </article>
            );
          })}
        </div>
      </SectionCard>
    </>
  );
}

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
  if (workspace === 'overview') {
    return <OverviewWorkspace payload={payload} workspaceActions={workspaceActions} />;
  }
  if (workspace === 'media') {
    return <MediaWorkspace payload={payload} />;
  }
  if (workspace === 'files') {
    return <FilesWorkspace payload={payload} workspaceActions={workspaceActions} />;
  }
  if (workspace === 'transfers') {
    return <TransfersWorkspace payload={payload} workspaceActions={workspaceActions} />;
  }
  if (workspace === 'ai') {
    return <AiWorkspace payload={payload} workspaceActions={workspaceActions} />;
  }
  if (workspace === 'terminal') {
    return <TerminalWorkspace payload={payload} />;
  }
  return <AdminWorkspace payload={payload} adminActions={adminActions} />;
}
