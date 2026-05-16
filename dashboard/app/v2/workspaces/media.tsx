'use client';

import { useEffect, useState } from 'react';
import { addMediaTorrent } from '../api';
import { EmptyState, KeyValueList, MetricGrid, MetricTile, SectionCard, ServiceList, StatusBadge } from '../components';
import { toErrorMessage } from '../errors';
import {
  asArray,
  asRecord,
  compactPathSummary,
  compactWorkflowSummary,
  resolveGatewayHref,
  toServiceListItems,
  toneFromStatus,
} from './shared';

const IPTV_DRAFT_STORAGE_KEY = 'dash2:iptv-config-draft:v1';

const normalizeSource = (value: string) => value.trim();
const isHttpSource = (value: string) => /^https?:\/\//i.test(value);
const isAbsolutePath = (value: string) => value.startsWith('/');
const isValidIptvSource = (value: string) => !value || isHttpSource(value) || isAbsolutePath(value);

export function MediaWorkspace({ payload }: { payload: Record<string, unknown> }) {
  const controlPlane = asRecord(payload.controlPlane);
  const controlPlaneCatalog = asRecord(controlPlane.catalog);
  const catalogServices = asArray<Record<string, unknown>>(controlPlaneCatalog.services);
  const mediaWorkflow = asRecord(payload.mediaWorkflow);
  const watch = asRecord(mediaWorkflow.watch);
  const requests = asRecord(mediaWorkflow.requests);
  const automation = asRecord(mediaWorkflow.automation);
  const support = asRecord(mediaWorkflow.support);
  const liveTv = asRecord(mediaWorkflow.liveTv);
  const mediaHealth = asRecord(payload.mediaHealth);
  const arrDiagnostics = asRecord(payload.arrDiagnostics);
  const qbDiagnostics = asRecord(payload.qbDiagnostics);
  const qbCategoryPaths = asRecord(qbDiagnostics.categories);
  const mediaHealthTotals = asRecord(mediaHealth.totals);
  const libraries = asArray<Record<string, unknown>>(mediaHealth.libraries);
  const activeSessions = asArray<Record<string, unknown>>(mediaHealth.activeSessions);
  const services = asArray<Record<string, unknown>>(payload.services);
  const mediaHealthAvailable = Boolean(mediaHealth.available);
  const mediaHealthStatus = String(mediaHealth.status || (mediaHealthAvailable ? 'working' : 'unavailable'));
  const watchServiceKeys = asArray<unknown>(watch.serviceKeys).map((entry) => String(entry || '')).filter(Boolean);
  const requestServiceKeys = asArray<unknown>(requests.serviceKeys).map((entry) => String(entry || '')).filter(Boolean);
  const automationServiceKeys = asArray<unknown>(automation.serviceKeys).map((entry) => String(entry || '')).filter(Boolean);
  const subtitles = asRecord(mediaWorkflow.subtitles);
  const servicesByKey = new Map(services.map((entry) => [String(entry.key || ''), entry]));
  const jellyfinService = servicesByKey.get('jellyfin');
  const jellyfinHref = resolveGatewayHref(jellyfinService?.route);
  const visibleInventory = services.filter((entry) => String(entry.key || '') !== 'postgres');
  const arrServiceSource = catalogServices.length > 0 ? catalogServices : services;
  const inferredArrServices = arrServiceSource
    .filter((entry) => String(entry.surface || '').toLowerCase() === 'arr')
    .map((entry) => ({
      available: Boolean(entry.available),
      description: String(entry.description || entry.blocker || `${String(entry.key || 'service')} automation surface`),
      key: String(entry.key || ''),
      label: String(entry.label || entry.key || 'Service'),
      route: String(entry.route || ''),
      status: String(entry.status || 'unknown'),
    }));
  const arrServices = inferredArrServices.length > 0
    ? inferredArrServices
    : (['sonarr', 'radarr', 'prowlarr', 'bazarr', 'flarearr'] as const).map((serviceKey) => {
      const entry = servicesByKey.get(serviceKey);
      const fallbackStatus = serviceKey === 'bazarr'
        ? String(subtitles.status || 'unknown')
        : serviceKey === 'flarearr'
          ? String(support.status || 'unknown')
          : String(automation.status || 'unknown');
      return {
        available: Boolean(entry?.available),
        description: String(entry?.description || entry?.blocker || `${serviceKey} automation surface`),
        key: serviceKey,
        label: String(entry?.label || `${serviceKey.slice(0, 1).toUpperCase()}${serviceKey.slice(1)}`),
        route: String(entry?.route || ''),
        status: String(entry?.status || fallbackStatus || 'unknown'),
      };
    });
  const [arrSource, setArrSource] = useState('');
  const [arrMediaType, setArrMediaType] = useState<'movies' | 'series'>('movies');
  const [arrBusy, setArrBusy] = useState(false);
  const [arrStatus, setArrStatus] = useState('');
  const [iptvPlaylistDraft, setIptvPlaylistDraft] = useState(String(liveTv.playlistSource || ''));
  const [iptvGuideDraft, setIptvGuideDraft] = useState(String(liveTv.guideSource || ''));
  const [iptvStatus, setIptvStatus] = useState('');
  const playlistSource = normalizeSource(iptvPlaylistDraft);
  const guideSource = normalizeSource(iptvGuideDraft);
  const playlistValid = isValidIptvSource(playlistSource);
  const guideValid = isValidIptvSource(guideSource);
  const canSaveIptvDraft = (playlistSource.length > 0 || guideSource.length > 0) && playlistValid && guideValid;
  const canTestIptvSource = isHttpSource(playlistSource) || isHttpSource(guideSource);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(IPTV_DRAFT_STORAGE_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw) as { playlistSource?: unknown; guideSource?: unknown; savedAt?: unknown };
      const savedPlaylist = normalizeSource(String(parsed.playlistSource || ''));
      const savedGuide = normalizeSource(String(parsed.guideSource || ''));
      if (savedPlaylist) {
        setIptvPlaylistDraft(savedPlaylist);
      }
      if (savedGuide) {
        setIptvGuideDraft(savedGuide);
      }
      if (savedPlaylist || savedGuide) {
        setIptvStatus(`Loaded browser draft${parsed.savedAt ? ` (${String(parsed.savedAt)})` : ''}.`);
      }
    } catch {
      // Ignore localStorage parse failures and continue with server snapshot values.
    }
  }, []);

  const handleAddArrTorrent = async () => {
    const source = arrSource.trim();
    if (!source) {
      setArrStatus('Enter a torrent source (magnet URL, .torrent URL, or local path).');
      return;
    }

    setArrBusy(true);
    try {
      const response = await addMediaTorrent({
        source,
        lane: 'arr',
        mediaType: arrMediaType,
      });
      if (response.success === false) {
        setArrStatus(String(response.error || 'Unable to queue ARR torrent.'));
        return;
      }
      setArrSource('');
      setArrStatus(String(response.message || `ARR queue request submitted (${arrMediaType}).`));
    } catch (error) {
      setArrStatus(toErrorMessage(error, 'Unable to queue ARR torrent'));
    } finally {
      setArrBusy(false);
    }
  };

  const handleSaveIptvDraft = () => {
    if (!playlistValid || !guideValid) {
      setIptvStatus('Use an http(s) URL or absolute path (/...) for playlist and guide sources.');
      return;
    }
    if (!playlistSource && !guideSource) {
      try {
        window.localStorage.removeItem(IPTV_DRAFT_STORAGE_KEY);
      } catch {
        // Ignore storage cleanup failures.
      }
      setIptvStatus('Draft cleared from this browser.');
      return;
    }
    const savedAt = new Date().toISOString();
    try {
      window.localStorage.setItem(
        IPTV_DRAFT_STORAGE_KEY,
        JSON.stringify({
          guideSource,
          playlistSource,
          savedAt,
        })
      );
      setIptvStatus(`Draft saved locally at ${savedAt}. Apply the same values in Jellyfin Live TV.`);
    } catch (error) {
      setIptvStatus(toErrorMessage(error, 'Unable to save IPTV draft locally'));
    }
  };

  const handleTestIptvSource = () => {
    const target = [playlistSource, guideSource].find((value) => isHttpSource(value)) || '';
    if (!target) {
      setIptvStatus('Testing requires an http(s) playlist or guide URL.');
      return;
    }
    const popup = window.open(target, '_blank', 'noopener,noreferrer');
    if (!popup) {
      setIptvStatus('Browser blocked the popup. Allow popups and try again.');
      return;
    }
    popup.opener = null;
    setIptvStatus(`Opened source test URL: ${target}`);
  };

  return (
    <>
      <MetricGrid>
        <MetricTile label="Watch surface" value={String(watch.label || 'Jellyfin')} helper={compactWorkflowSummary(watch.summary, 'Primary playback surface')} />
        <MetricTile label="Requests" value={String(requests.status || 'unknown')} helper={compactWorkflowSummary(requests.summary, 'Request intake status')} />
        <MetricTile label="Library list" value={libraries.length} helper={mediaHealthAvailable ? 'Live Jellyfin library roots' : 'Jellyfin health API unavailable'} />
        <MetricTile label="ARR healthy" value={`${Number(arrDiagnostics.healthy || 0)}/${Number(arrDiagnostics.total || arrServices.length)}`} helper="Automation services" />
        <MetricTile label="qB WebUI" value={qbDiagnostics.webUiReachable ? 'reachable' : 'offline'} helper={String(qbDiagnostics.error || qbDiagnostics.baseUrl || 'Torrent client diagnostic')} />
        <MetricTile label="Live TV" value={`${Number(liveTv.channelCount || 0)} channels`} helper={compactWorkflowSummary(liveTv.summary, 'Live TV readiness')} />
      </MetricGrid>

      <SectionCard title="Media overview" subtitle="Playback, requests, automation, subtitles, and Live TV without the old workflow walkthrough card.">
        <KeyValueList
          rows={[
            { label: 'Watch', value: `${String(watch.status || 'unknown')} · ${watchServiceKeys.join(', ') || 'jellyfin'}` },
            { label: 'Requests', value: `${String(requests.status || 'unknown')} · ${requestServiceKeys.join(', ') || 'none'}` },
            { label: 'Automation', value: `${Number(automation.healthy || 0)}/${Math.max(Number(automation.total || 0), 0)} healthy · ${automationServiceKeys.join(', ') || 'none'}` },
            { label: 'Subtitles', value: `${String(subtitles.status || 'unknown')} · ${compactWorkflowSummary(subtitles.summary, 'Subtitle sync lane')}` },
            { label: 'Support', value: `${String(support.status || 'unknown')} · ${compactWorkflowSummary(support.summary, 'ARR support services')}` },
            { label: 'Workflow help', value: 'See Settings → Help for the operator workflow and recovery steps.' },
          ]}
        />
      </SectionCard>

      <SectionCard title="Media health dashboard" subtitle="Jellyfin-backed libraries, totals, and currently watching sessions.">
        {mediaHealthAvailable ? (
          <>
            <MetricGrid>
              <MetricTile label="Health state" value={<StatusBadge tone={mediaHealthStatus === 'working' ? 'ok' : mediaHealthStatus === 'degraded' ? 'warn' : 'danger'}>{mediaHealthStatus}</StatusBadge>} helper={String(mediaHealth.error || 'Live API snapshot')} />
              <MetricTile label="Movies" value={Number(mediaHealthTotals.movieCount || 0)} />
              <MetricTile label="Series" value={Number(mediaHealthTotals.seriesCount || 0)} />
              <MetricTile label="Watching now" value={activeSessions.length} helper={String(mediaHealth.lastUpdated || 'live')} />
            </MetricGrid>
            <div className="dash2-media-health-grid">
              <article className="dash2-media-health-card">
                <h3>Libraries</h3>
                {libraries.length === 0 ? <p className="dash2-admin-note">No library metadata was returned.</p> : (
                  <ul className="dash2-list">
                    {libraries.map((entry, index) => (
                      <li key={`${String(entry.id || entry.name || 'library')}-${index}`}>
                        <div>
                          <strong>{String(entry.name || 'Library')}</strong>
                          <p className="dash2-small-copy">{compactPathSummary(entry.path)}</p>
                        </div>
                        <StatusBadge tone="muted">{Number(entry.itemCount || 0)}</StatusBadge>
                      </li>
                    ))}
                  </ul>
                )}
              </article>
              <article className="dash2-media-health-card">
                <h3>Currently watching</h3>
                {activeSessions.length === 0 ? <p className="dash2-admin-note">No active Jellyfin playback sessions.</p> : (
                  <ul className="dash2-list">
                    {activeSessions.map((entry, index) => (
                      <li key={`${String(entry.id || entry.userName || 'session')}-${index}`}>
                        <div>
                          <strong>{String(entry.userName || 'Unknown user')}</strong>
                          <p className="dash2-small-copy">{String(entry.itemName || 'Playback item unavailable')}</p>
                        </div>
                        <StatusBadge tone="muted">{String(entry.client || 'client')}</StatusBadge>
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            </div>
          </>
        ) : (
          <EmptyState
            title="Media health unavailable"
            message={String(mediaHealth.error || 'Jellyfin API health metrics could not be loaded. Configure Jellyfin API key for live media dashboard data.')}
          />
        )}
      </SectionCard>

      <SectionCard title="IPTV support" subtitle="Playlist, guide, and mapping status used by Jellyfin Live TV.">
        <KeyValueList
          rows={[
            { label: 'Status', value: String(liveTv.status || 'unknown') },
            { label: 'Playlist source', value: <span className="dash2-small-copy">{compactPathSummary(liveTv.playlistSource)}</span> },
            { label: 'Guide source', value: <span className="dash2-small-copy">{compactPathSummary(liveTv.guideSource)}</span> },
            { label: 'Channels mapped', value: liveTv.channelsMapped === true ? 'yes' : liveTv.channelsMapped === false ? 'no' : 'unknown' },
            { label: 'Summary', value: <span className="dash2-small-copy">{compactWorkflowSummary(liveTv.summary, 'No IPTV summary available')}</span> },
          ]}
        />
      </SectionCard>

      <SectionCard
        title="IPTV config draft"
        subtitle="Edit source values here, save the draft in your browser, then apply the same values in Jellyfin Live TV."
        actions={jellyfinHref ? <a className="ui-button" href={jellyfinHref} target="_blank" rel="noreferrer">Open Jellyfin Live TV</a> : undefined}
      >
        <form
          className="dash2-torrent-controls"
          onSubmit={(event) => event.preventDefault()}
        >
          <div className="dash2-torrent-controls__row">
            <label>
              <span>M3U / M3U8 playlist source</span>
              <input
                className="ui-input"
                type="text"
                value={iptvPlaylistDraft}
                onChange={(event) => setIptvPlaylistDraft(event.target.value)}
                placeholder="https://example/live.m3u8 or /path/to/playlist.m3u"
              />
            </label>
            <label>
              <span>XMLTV guide source</span>
              <input
                className="ui-input"
                type="text"
                value={iptvGuideDraft}
                onChange={(event) => setIptvGuideDraft(event.target.value)}
                placeholder="https://example/guide.xml or /path/to/guide.xml"
              />
            </label>
          </div>
          <div className="dash2-card__actions">
            <button className="ui-button ui-button--primary" type="button" onClick={handleSaveIptvDraft} disabled={!canSaveIptvDraft}>
              Save Draft Locally
            </button>
            <button className="ui-button" type="button" onClick={handleTestIptvSource} disabled={!canTestIptvSource}>
              Test Source URL
            </button>
          </div>
          {iptvStatus ? <p className="dash2-admin-note" role="status">{iptvStatus}</p> : null}
          <p className="dash2-admin-note">Current backend values still come from environment paths/URLs. This draft helps stage values before applying in Jellyfin.</p>
        </form>
      </SectionCard>

      <SectionCard title="ARR + qB diagnostics" subtitle="Torrent-routing readiness and automation service health.">
        <KeyValueList
          rows={[
            { label: 'ARR health', value: `${Number(arrDiagnostics.healthy || 0)}/${Number(arrDiagnostics.total || arrServices.length)} services working` },
            { label: 'qB WebUI', value: qbDiagnostics.webUiReachable ? `reachable${qbDiagnostics.version ? ` · ${String(qbDiagnostics.version)}` : ''}` : String(qbDiagnostics.error || 'unreachable') },
            { label: 'ARR route', value: `movies -> ${compactPathSummary(qbCategoryPaths.movies)} · series -> ${compactPathSummary(qbCategoryPaths.series)}` },
            { label: 'Standalone route', value: compactPathSummary(qbCategoryPaths.standalone || qbDiagnostics.defaultSavePath) },
          ]}
        />
      </SectionCard>

      <SectionCard title="ARR services" subtitle="Automation service status, quick links, and direct ARR torrent intake.">
        {arrStatus ? <p className="dash2-admin-note">{arrStatus}</p> : null}
        <div className="dash2-service-admin-grid">
          {arrServices.map((entry) => (
            <article key={entry.key} className="dash2-service-admin-card">
              <div className="dash2-service-admin-card__header">
                <strong>{entry.label}</strong>
                <StatusBadge tone={toneFromStatus(entry.status)}>{entry.status}</StatusBadge>
              </div>
              <p className="dash2-small-copy">{entry.description}</p>
              <div className="dash2-service-admin-card__meta">
                <span>key: {entry.key}</span>
                <span>{entry.available ? 'available' : 'unavailable'}</span>
              </div>
              {entry.route ? (
                <div className="dash2-service-admin-card__actions dash2-service-admin-card__actions--compact">
                  <a className="ui-button ui-button--primary" href={resolveGatewayHref(entry.route)} target="_blank" rel="noreferrer">Open</a>
                </div>
              ) : null}
            </article>
          ))}
        </div>
        <form
          className="dash2-torrent-controls"
          onSubmit={(event) => {
            event.preventDefault();
            void handleAddArrTorrent();
          }}
        >
          <div className="dash2-torrent-controls__row">
            <label>
              <span>Torrent source</span>
              <input
                className="ui-input"
                type="text"
                value={arrSource}
                onChange={(event) => setArrSource(event.target.value)}
                placeholder="magnet:?xt=... or .torrent URL/path"
              />
            </label>
            <label>
              <span>Media type</span>
              <select className="ui-input" value={arrMediaType} onChange={(event) => setArrMediaType(event.target.value === 'series' ? 'series' : 'movies')}>
                <option value="movies">Movies</option>
                <option value="series">Series</option>
              </select>
            </label>
          </div>
          <div className="dash2-card__actions">
            <button className="ui-button ui-button--primary" type="submit" disabled={arrBusy || !arrSource.trim()}>
              {arrBusy ? 'Submitting…' : 'Add to ARR queue'}
            </button>
          </div>
        </form>
      </SectionCard>

      <SectionCard title="Media inventory" subtitle="Media-facing services only. PostgreSQL is intentionally excluded from this view.">
        <div className="dash2-service-admin-grid">
          {visibleInventory.map((entry, index) => {
            const route = String(entry.route || '');
            const status = String(entry.status || 'unknown');
            return (
              <article key={`${String(entry.key || 'service')}-${index}`} className="dash2-service-admin-card">
                <div className="dash2-service-admin-card__header">
                  <strong>{String(entry.label || entry.key || 'Service')}</strong>
                  <StatusBadge tone={status === 'working' ? 'ok' : status === 'stalled' || status === 'blocked' ? 'warn' : 'muted'}>
                    {status}
                  </StatusBadge>
                </div>
                <p className="dash2-small-copy">{String(entry.description || entry.blocker || 'No summary available.')}</p>
                <div className="dash2-service-admin-card__meta">
                  <span>key: {String(entry.key || 'n/a')}</span>
                  <span>{Boolean(entry.available) ? 'available' : 'unavailable'}</span>
                </div>
                {route ? (
                  <div className="dash2-service-admin-card__actions">
                    <a className="ui-button ui-button--primary" href={resolveGatewayHref(route)} target="_blank" rel="noreferrer">Open</a>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </SectionCard>
    </>
  );
}
