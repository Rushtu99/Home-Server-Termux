'use client';

import { useState } from 'react';
import {
  controlCluster,
  controlClusterService,
  fetchLogsSnapshot,
  recheckStorageProtection,
  repairDriveHelpers,
  resumeStorageProtection,
  startWorkflow,
  updateVerboseLogging,
} from '../api';
import { EmptyState, KeyValueList, MetricGrid, MetricTile, SectionCard, StatusBadge } from '../components';
import { toErrorMessage } from '../errors';
import { asArray, asRecord, LocalTabBar, toneFromStatus } from './shared';
import type { AdminActions, WorkspaceActions } from './shared';

export function AdminWorkspace({
  payload,
  adminActions,
  workspaceActions,
}: {
  payload: Record<string, unknown>;
  adminActions?: AdminActions;
  workspaceActions?: WorkspaceActions;
}) {
  const dashboard = asRecord(payload.dashboard);
  const dashboardServiceCatalog = asArray<Record<string, unknown>>(dashboard.serviceCatalog);
  const controlPlane = asRecord(payload.controlPlane);
  const controlPlaneCatalog = asRecord(controlPlane.catalog);
  const controlPlaneServices = asArray<Record<string, unknown>>(controlPlaneCatalog.services);
  const serviceCatalog = controlPlaneServices.length > 0 ? controlPlaneServices : dashboardServiceCatalog;
  const serviceState = asRecord(controlPlane.serviceState);
  const serviceStateCounts = asRecord(serviceState.counts);
  const serviceStateServices = asArray<Record<string, unknown>>(serviceState.services);
  const workflows = asArray<Record<string, unknown>>(controlPlane.workflows);
  const workflowRuns = asArray<Record<string, unknown>>(controlPlane.workflowRuns);
  const workflowEvents = asArray<Record<string, unknown>>(controlPlane.workflowEvents);
  const clusters = asArray<Record<string, unknown>>(controlPlane.clusters);
  const health = asRecord(controlPlane.health);
  const healthSummary = asRecord(health.summary);
  const metrics = asRecord(controlPlane.metrics);
  const metricsSnapshot = asRecord(metrics.metrics);
  const stateSnapshot = asRecord(controlPlane.state);
  const controlPlaneErrors = asArray<string>(controlPlane.errors).filter(Boolean);
  const serviceStateCountEntries = Object.entries(serviceStateCounts).filter(([, value]) => Number.isFinite(Number(value)));
  const serviceStateSummary = serviceStateCountEntries.length > 0
    ? serviceStateCountEntries.map(([key, value]) => `${key}:${Number(value)}`).join(' · ')
    : '';
  const hasControlPlaneInsights = workflows.length > 0
    || workflowRuns.length > 0
    || clusters.length > 0
    || workflowEvents.length > 0
    || Object.keys(serviceState).length > 0
    || controlPlaneErrors.length > 0;
  const controller = asRecord(dashboard.serviceController);
  const optionalControls = new Set(asArray<string>(controller.optionalServices));
  const locked = Boolean(controller.locked);
  const networkExposure = asRecord(dashboard.networkExposure);
  const tailscale = asRecord(dashboard.tailscale);
  const remoteAccess = asRecord(dashboard.remoteAccess);
  const remoteGateway = asRecord(remoteAccess.gateway);
  const remoteSsh = asRecord(remoteAccess.ssh);
  const coreEntries = asArray<Record<string, unknown>>(networkExposure.core);
  const exposureServices = asArray<Record<string, unknown>>(networkExposure.services);
  const exposureCount = coreEntries.length + exposureServices.length;
  const logs = asRecord(dashboard.logs);
  const logEntries = asArray<Record<string, unknown>>(logs.entries);
  const arrEvidence = asRecord(payload.arrEvidence);
  const arrMismatches = asArray<string>(arrEvidence.mismatches);
  const [activeTab, setActiveTab] = useState<'controls' | 'network' | 'logs' | 'help'>('controls');
  const [logFilter, setLogFilter] = useState<'all' | 'info' | 'warn' | 'error'>('all');
  const [logSearch, setLogSearch] = useState('');
  const [verboseOverride, setVerboseOverride] = useState<boolean | null>(null);
  const [logStateOverride, setLogStateOverride] = useState<Array<Record<string, unknown>> | null>(null);
  const [logStatus, setLogStatus] = useState('');
  const [storageActionBusy, setStorageActionBusy] = useState<'resume' | 'recheck' | ''>('');
  const [storageHelperBusy, setStorageHelperBusy] = useState(false);
  const [storageHelperRepairNeeded, setStorageHelperRepairNeeded] = useState(false);
  const [storageActionStatus, setStorageActionStatus] = useState('');
  const [clusterBusyKey, setClusterBusyKey] = useState('');
  const [clusterStatus, setClusterStatus] = useState('');
  const [workflowBusy, setWorkflowBusy] = useState('');
  const [workflowStatus, setWorkflowStatus] = useState('');
  const verboseLogging = verboseOverride ?? Boolean(logs.verboseLoggingEnabled);
  const logState = logStateOverride ?? logEntries;

  const filteredLogs = logState.filter((entry) => {
    const level = String(entry.level || '').toLowerCase();
    const query = logSearch.trim().toLowerCase();
    if (logFilter !== 'all' && level !== logFilter) {
      return false;
    }
    if (!query) {
      return true;
    }
    return `${String(entry.message || '')} ${JSON.stringify(entry.meta || null)}`.toLowerCase().includes(query);
  });

  const toggleVerbose = async () => {
    try {
      const response = await updateVerboseLogging(!verboseLogging);
      setVerboseOverride(Boolean(response.verboseLoggingEnabled));
      const snapshot = await fetchLogsSnapshot();
      setLogStateOverride(asArray<Record<string, unknown>>(snapshot.entries));
      setLogStatus(Boolean(response.verboseLoggingEnabled) ? 'Verbose logging enabled.' : 'Verbose logging disabled.');
    } catch (error) {
      setLogStatus(toErrorMessage(error, 'Unable to update logging mode'));
    }
  };

  const runStorageRecheck = async () => {
    setStorageActionBusy('recheck');
    try {
      const response = await recheckStorageProtection();
      const protection = asRecord(response.storageProtection);
      const storageState = String(protection.state || 'unknown').trim().toLowerCase() || 'unknown';
      const watchdogReason = String(protection.reasonCompact || protection.reason || 'watchdog state unknown').trim() || 'watchdog state unknown';
      if (response.success === false) {
        const code = String(response.code || '').toLowerCase();
        if (code === 'watchdog_helper_missing') {
          const hint = String(response.installHint || '').trim();
          setStorageActionStatus(`Storage status: ${storageState}. ${watchdogReason} ${String(response.error || 'Storage watchdog helper is not available.')}${hint ? ` ${hint}` : ''}`);
          setStorageHelperRepairNeeded(true);
        } else {
          setStorageActionStatus(`Storage status: ${storageState}. ${watchdogReason} ${String(response.error || 'Storage recheck failed')}`);
        }
      } else {
        setStorageActionStatus(`Storage status: ${storageState}. ${watchdogReason} Storage recheck completed.`);
        setStorageHelperRepairNeeded(false);
      }
    } catch (error) {
      setStorageActionStatus(toErrorMessage(error, 'Storage recheck failed'));
    } finally {
      setStorageActionBusy('');
      workspaceActions?.onRefresh();
    }
  };

  const runStorageHelperRepair = async () => {
    setStorageHelperBusy(true);
    try {
      const response = await repairDriveHelpers();
      const missing = Array.isArray(response.missing) ? response.missing.length : 0;
      const failed = Array.isArray(response.failed) ? response.failed.length : 0;
      if (response.success) {
        setStorageActionStatus('Storage helper repair completed. Recheck storage now.');
        setStorageHelperRepairNeeded(false);
      } else {
        setStorageActionStatus(`Storage status: unknown. watchdog state unknown. Helper repair incomplete (${missing} missing, ${failed} failed).`);
        setStorageHelperRepairNeeded(true);
      }
    } catch (error) {
      setStorageActionStatus(toErrorMessage(error, 'Storage helper repair failed'));
      setStorageHelperRepairNeeded(true);
    } finally {
      setStorageHelperBusy(false);
      workspaceActions?.onRefresh();
    }
  };

  const runStorageResume = async () => {
    setStorageActionBusy('resume');
    try {
      const response = await resumeStorageProtection();
      if (Array.isArray(response.failed) && response.failed.length > 0) {
        setStorageActionStatus(`Resume partial: ${response.failed.length} service(s) failed.`);
      } else if (response.success === false) {
        setStorageActionStatus(String(response.error || 'Storage resume failed'));
      } else {
        setStorageActionStatus('Storage resume requested.');
      }
    } catch (error) {
      setStorageActionStatus(toErrorMessage(error, 'Storage resume failed'));
    } finally {
      setStorageActionBusy('');
      workspaceActions?.onRefresh();
    }
  };

  const runClusterAction = async (clusterName: string, action: 'start' | 'stop' | 'restart') => {
    setClusterBusyKey(`${clusterName}:${action}`);
    try {
      const response = await controlCluster(clusterName, action);
      if (response.success === false) {
        setClusterStatus(String(response.error || `Cluster ${action} failed`));
      } else {
        const state = String(asRecord(response.cluster).state || 'unknown');
        setClusterStatus(`${clusterName} ${action} requested (${state}).`);
      }
    } catch (error) {
      setClusterStatus(toErrorMessage(error, `Cluster ${action} failed`));
    } finally {
      setClusterBusyKey('');
      workspaceActions?.onRefresh();
    }
  };

  const runServiceAction = async (serviceName: string, action: 'start' | 'stop' | 'restart') => {
    setClusterBusyKey(`${serviceName}:${action}`);
    try {
      const response = await controlClusterService(serviceName, action);
      if (response.success === false) {
        setClusterStatus(String(response.error || `Service ${action} failed`));
      } else {
        setClusterStatus(`${serviceName} ${action} requested.`);
      }
    } catch (error) {
      setClusterStatus(toErrorMessage(error, `Service ${action} failed`));
    } finally {
      setClusterBusyKey('');
      workspaceActions?.onRefresh();
    }
  };

  const triggerWorkflow = async (workflowKey: string) => {
    setWorkflowBusy(workflowKey);
    try {
      const response = await startWorkflow(workflowKey);
      const run = asRecord(response.run);
      const runId = String(run.id || '');
      if (response.success === false) {
        setWorkflowStatus(String(response.error || `Workflow ${workflowKey} failed`));
      } else {
        setWorkflowStatus(`${workflowKey} queued${runId ? ` (${runId})` : ''}.`);
      }
    } catch (error) {
      setWorkflowStatus(toErrorMessage(error, `Workflow ${workflowKey} failed`));
    } finally {
      setWorkflowBusy('');
      workspaceActions?.onRefresh();
    }
  };

  return (
    <>
      <LocalTabBar
        label="Settings workspace tabs"
        items={[
          { key: 'controls', label: 'Controls' },
          { key: 'network', label: 'Network' },
          { key: 'logs', label: 'Logs' },
          { key: 'help', label: 'Help' },
        ]}
        activeKey={activeTab}
        onChange={(key) => setActiveTab(key as 'controls' | 'network' | 'logs' | 'help')}
      />
      <MetricGrid>
        <MetricTile label="Service catalog" value={serviceCatalog.length} helper="Entries in controller inventory" />
        <MetricTile label="Controller lock" value={Boolean(controller.locked) ? 'Locked' : 'Unlocked'} helper="Admin action safety gate" />
        <MetricTile label="Optional controls" value={asArray<string>(controller.optionalServices).length} helper="User-controllable optional services" />
        <MetricTile label="Port audit" value={exposureCount} helper={String(networkExposure.overall || 'unknown')} />
        <MetricTile label="Tailscale" value={String(tailscale.status || tailscale.mode || 'disabled')} helper={String(tailscale.mode || 'disabled')} />
        <MetricTile label="Generated" value={String(dashboard.generatedAt || 'unknown')} helper="Snapshot timestamp" />
      </MetricGrid>

      {activeTab === 'controls' && adminActions ? (
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

      {activeTab === 'controls' ? (
      <SectionCard title="Storage protection controls" subtitle="Resume blocked services from here (moved from Storage workspace).">
        <div className="dash2-wrap-row">
          <button className="ui-button" type="button" disabled={storageActionBusy !== ''} onClick={() => void runStorageRecheck()}>
            {storageActionBusy === 'recheck' ? 'Rechecking…' : 'Recheck storage'}
          </button>
          {storageHelperRepairNeeded ? (
            <button className="ui-button" type="button" disabled={storageActionBusy !== '' || storageHelperBusy} onClick={() => void runStorageHelperRepair()}>
              {storageHelperBusy ? 'Repairing…' : 'Install/Repair helpers'}
            </button>
          ) : null}
          <button className="ui-button ui-button--primary" type="button" disabled={storageActionBusy !== ''} onClick={() => void runStorageResume()}>
            {storageActionBusy === 'resume' ? 'Resuming…' : 'Resume blocked services'}
          </button>
        </div>
        {storageActionStatus ? <p className="dash2-admin-note">{storageActionStatus}</p> : null}
      </SectionCard>
      ) : null}

      {activeTab === 'controls' ? (
      <SectionCard title="Service inventory" subtitle="Operational state for all registered services.">
        <div className="dash2-service-admin-grid">
          {serviceCatalog.map((entry, index) => {
            const key = String(entry.key || `service-${index}`);
            const label = String(entry.label || key || 'Service');
            const status = String(entry.status || 'unknown');
            const available = Boolean(entry.available);
            const controlMode = String(entry.controlMode || 'always_on');
            const canUseControls = Boolean(adminActions && !locked && adminActions.adminPassword.trim());
            const controllable = adminActions ? optionalControls.has(key) && canUseControls : false;
            const actionBusy = adminActions?.controlBusyKey === key;

            return (
              <article key={`${key}-${index}`} className="dash2-service-admin-card">
                <div className="dash2-service-admin-card__header">
                  <strong>{label}</strong>
                  <StatusBadge tone={toneFromStatus(status)}>{status}</StatusBadge>
                </div>
                <p>{String(entry.description || entry.blocker || 'No summary available.')}</p>
                <div className="dash2-service-admin-card__meta">
                  <span>key: {key}</span>
                  <span>mode: {controlMode}</span>
                  <span>{available ? 'available' : 'unavailable'}</span>
                </div>
                {controllable && adminActions ? (
                  <div className="dash2-service-admin-card__actions dash2-service-admin-card__actions--compact">
                    <button className="ui-button dash2-ui-button--small" type="button" disabled={actionBusy} onClick={() => adminActions.onControl(key, 'start')}>Start</button>
                    <button className="ui-button dash2-ui-button--small" type="button" disabled={actionBusy} onClick={() => adminActions.onControl(key, 'stop')}>Stop</button>
                    <button className="ui-button dash2-ui-button--small" type="button" disabled={actionBusy} onClick={() => adminActions.onControl(key, 'restart')}>Restart</button>
                  </div>
                ) : (
                  <p className="dash2-admin-note">
                    {optionalControls.has(key)
                      ? locked
                        ? 'Unlock controller and provide admin password to show controls.'
                        : 'Provide admin password to show controls.'
                      : 'No direct controller action exposed for this service.'}
                  </p>
                )}
              </article>
            );
          })}
        </div>
      </SectionCard>
      ) : null}

      {activeTab === 'controls' && hasControlPlaneInsights ? (
      <SectionCard title="Control-plane workflows" subtitle="Service-state summary plus workflow definitions and recent runs.">
        <MetricGrid>
          <MetricTile label="Service state" value={String(serviceState.state || 'unknown')} helper={serviceStateSummary || 'No service-state counts reported'} />
          <MetricTile label="Workflow definitions" value={workflows.length} helper="Loaded from control-plane" />
          <MetricTile label="Workflow runs" value={workflowRuns.length} helper="Recent workflow executions" />
          <MetricTile label="Control-plane errors" value={controlPlaneErrors.length} helper={controlPlaneErrors.length > 0 ? 'API sections failed' : 'No snapshot errors'} />
          <MetricTile
            label="State services"
            value={serviceStateServices.length}
            helper={String(serviceState.generatedAt || controlPlaneCatalog.generatedAt || 'No control-plane timestamp')}
          />
        </MetricGrid>
        <KeyValueList
          rows={[
            { label: 'State counts', value: serviceStateSummary || 'No service-state counts reported.' },
            { label: 'Catalog snapshot', value: String(controlPlaneCatalog.generatedAt || 'unknown') },
          ]}
        />
        {controlPlaneErrors.length > 0 ? (
          <p className="dash2-admin-note">
            Control-plane snapshot warnings: {controlPlaneErrors.join(' | ')}
          </p>
        ) : null}
        <div className="dash2-service-admin-grid">
          <article className="dash2-service-admin-card">
            <div className="dash2-service-admin-card__header">
              <strong>Definitions</strong>
              <StatusBadge tone={workflows.length > 0 ? 'ok' : 'muted'}>{workflows.length}</StatusBadge>
            </div>
            {workflows.length === 0 ? (
              <p className="dash2-admin-note">No workflow definitions reported.</p>
            ) : (
              workflows.slice(0, 8).map((entry, index) => (
                <p key={`${String(entry.name || entry.id || entry.key || 'workflow')}-${index}`} className="dash2-small-copy">
                  <strong>{String(entry.name || entry.id || entry.key || `workflow-${index + 1}`)}</strong>: {String(entry.summary || entry.description || entry.status || 'No summary available.')}
                </p>
              ))
            )}
          </article>
          <article className="dash2-service-admin-card">
            <div className="dash2-service-admin-card__header">
              <strong>Recent runs</strong>
              <StatusBadge tone={workflowRuns.length > 0 ? 'warn' : 'muted'}>{workflowRuns.length}</StatusBadge>
            </div>
            {workflowRuns.length === 0 ? (
              <p className="dash2-admin-note">No workflow runs reported.</p>
            ) : (
              workflowRuns.slice(0, 8).map((entry, index) => {
                const workflowName = String(entry.workflowKey || entry.workflow || entry.name || entry.key || `run-${index + 1}`);
                const runStatus = String(entry.status || entry.result || 'unknown');
                const runWhen = String(entry.startedAt || entry.updatedAt || entry.createdAt || '');
                const runId = String(entry.id || '').trim();
                return (
                  <p key={`${workflowName}-${index}`} className="dash2-small-copy">
                    <strong>{workflowName}</strong>: {runStatus}{runWhen ? ` · ${runWhen}` : ''}{runId ? ` · ${runId}` : ''}
                  </p>
                );
              })
            )}
          </article>
        </div>
      </SectionCard>
      ) : null}

      {activeTab === 'controls' ? (
      <SectionCard title="Cluster orchestration" subtitle="Cluster dependency-aware controls and per-service actions.">
        <MetricGrid>
          <MetricTile label="Clusters" value={clusters.length} helper="Config-driven orchestration groups" />
          <MetricTile label="Workflow events" value={workflowEvents.length} helper="Recent event log entries" />
          <MetricTile label="Health healthy" value={Number(healthSummary.healthy || 0)} helper="Service health checks" />
          <MetricTile label="Health down" value={Number(healthSummary.down || 0)} helper="Auto-restart candidates" />
        </MetricGrid>
        {clusterStatus ? <p className="dash2-admin-note">{clusterStatus}</p> : null}
        <div className="dash2-service-admin-grid">
          {clusters.map((entry, index) => {
            const clusterName = String(entry.name || `cluster-${index}`);
            const clusterState = String(entry.state || 'unknown');
            const clusterServices = asArray<Record<string, unknown>>(entry.services);
            const dependencies = asArray<string>(entry.dependsOn).filter(Boolean);
            return (
              <article key={`${clusterName}-${index}`} className="dash2-service-admin-card">
                <div className="dash2-service-admin-card__header">
                  <strong>{clusterName}</strong>
                  <StatusBadge tone={toneFromStatus(clusterState)}>{clusterState}</StatusBadge>
                </div>
                <p className="dash2-small-copy">
                  dependsOn: {dependencies.length > 0 ? dependencies.join(', ') : 'none'}
                </p>
                <div className="dash2-service-admin-card__actions dash2-service-admin-card__actions--compact">
                  <button
                    className="ui-button dash2-ui-button--small"
                    type="button"
                    disabled={clusterBusyKey === `${clusterName}:start`}
                    onClick={() => void runClusterAction(clusterName, 'start')}
                  >
                    Start
                  </button>
                  <button
                    className="ui-button dash2-ui-button--small"
                    type="button"
                    disabled={clusterBusyKey === `${clusterName}:stop`}
                    onClick={() => void runClusterAction(clusterName, 'stop')}
                  >
                    Stop
                  </button>
                  <button
                    className="ui-button dash2-ui-button--small"
                    type="button"
                    disabled={clusterBusyKey === `${clusterName}:restart`}
                    onClick={() => void runClusterAction(clusterName, 'restart')}
                  >
                    Restart
                  </button>
                </div>
                {clusterServices.length > 0 ? (
                  <div className="dash2-small-copy">
                    {clusterServices.map((svc, svcIndex) => {
                      const svcName = String(svc.name || svc.service || `svc-${svcIndex}`);
                      const svcState = String(svc.state || (svc.running ? 'running' : 'stopped'));
                      return (
                        <p key={`${clusterName}-${svcName}-${svcIndex}`}>
                          <strong>{svcName}</strong>: {svcState}
                          {' '}
                          <button
                            className="ui-button dash2-ui-button--small"
                            type="button"
                            disabled={clusterBusyKey === `${svcName}:restart`}
                            onClick={() => void runServiceAction(svcName, 'restart')}
                          >
                            Restart
                          </button>
                        </p>
                      );
                    })}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </SectionCard>
      ) : null}

      {activeTab === 'controls' ? (
      <SectionCard title="Workflow panel" subtitle="Trigger workflow definitions and inspect recent progression logs.">
        {workflowStatus ? <p className="dash2-admin-note">{workflowStatus}</p> : null}
        <div className="dash2-service-admin-grid">
          <article className="dash2-service-admin-card">
            <div className="dash2-service-admin-card__header">
              <strong>Trigger workflows</strong>
              <StatusBadge tone={workflows.length > 0 ? 'ok' : 'muted'}>{workflows.length}</StatusBadge>
            </div>
            {workflows.length === 0 ? (
              <p className="dash2-admin-note">No workflow definitions available.</p>
            ) : (
              workflows.slice(0, 12).map((entry, index) => {
                const workflowKey = String(entry.key || `workflow-${index}`);
                const description = String(entry.title || entry.description || 'No summary');
                return (
                  <p key={`${workflowKey}-${index}`} className="dash2-small-copy">
                    <strong>{workflowKey}</strong>: {description}
                    {' '}
                    <button
                      className="ui-button dash2-ui-button--small"
                      type="button"
                      disabled={workflowBusy === workflowKey}
                      onClick={() => void triggerWorkflow(workflowKey)}
                    >
                      Start
                    </button>
                  </p>
                );
              })
            )}
          </article>
          <article className="dash2-service-admin-card">
            <div className="dash2-service-admin-card__header">
              <strong>Recent workflow events</strong>
              <StatusBadge tone={workflowEvents.length > 0 ? 'warn' : 'muted'}>{workflowEvents.length}</StatusBadge>
            </div>
            {workflowEvents.length === 0 ? (
              <p className="dash2-admin-note">No workflow events reported.</p>
            ) : (
              workflowEvents.slice(-12).reverse().map((entry, index) => (
                <p key={`${String(entry.event || 'event')}-${index}`} className="dash2-small-copy">
                  <strong>{String(entry.event || 'event')}</strong> · {String(entry.timestamp || entry.loggedAt || '')}
                </p>
              ))
            )}
          </article>
        </div>
      </SectionCard>
      ) : null}

      {activeTab === 'controls' ? (
      <SectionCard title="System health" subtitle="Metrics, resource snapshots, and orchestrator state.">
        <MetricGrid>
          <MetricTile label="CPU load" value={Number(metricsSnapshot.cpuLoad || 0)} helper="From /metrics" />
          <MetricTile label="RAM used" value={Number(metricsSnapshot.usedMem || 0)} helper="Bytes used" />
          <MetricTile label="Disk mounts" value={asArray<Record<string, unknown>>(asRecord(stateSnapshot.services).services).length} helper="From /state snapshot" />
          <MetricTile label="Workflow active" value={asArray<Record<string, unknown>>(stateSnapshot.activeWorkflows).length} helper="Queued/running/blocked runs" />
        </MetricGrid>
        <KeyValueList
          rows={[
            { label: 'Health summary', value: `healthy:${Number(healthSummary.healthy || 0)} down:${Number(healthSummary.down || 0)} recovering:${Number(healthSummary.recovering || 0)}` },
            { label: 'Metrics generated', value: String(metrics.generatedAt || 'unknown') },
            { label: 'State generated', value: String(stateSnapshot.generatedAt || 'unknown') },
          ]}
        />
      </SectionCard>
      ) : null}

      {activeTab === 'network' ? (
      <SectionCard title="Network & ports" subtitle="Core gateway routes, service bindings, and unauthenticated exposure checks.">
        {exposureCount === 0 ? <EmptyState title="No audit data" message="Network exposure data is currently unavailable." /> : (
          <div className="dash2-service-admin-grid">
            {[...coreEntries, ...exposureServices].map((entry, index) => {
              const status = String(entry.status || 'unknown');
              const label = String(entry.label || entry.key || `entry-${index}`);
              const routePath = String(entry.routePath || '');
              const observed = Number(entry.observedUnauthenticatedStatus || 0);
              const notes = asArray<string>(entry.notes).filter(Boolean);
              return (
                <article key={`${String(entry.key || label)}-${index}`} className="dash2-service-admin-card">
                  <div className="dash2-service-admin-card__header">
                    <strong>{label}</strong>
                    <StatusBadge tone={toneFromStatus(status)}>{status}</StatusBadge>
                  </div>
                  <div className="dash2-service-admin-card__meta">
                    <span>{String(entry.protocol || 'tcp')}:{String(entry.port || 'n/a')}</span>
                    <span>{String(entry.bindHost || '127.0.0.1')}</span>
                    <span>{String(entry.remoteSurface || 'none')}</span>
                  </div>
                  <p>{routePath ? `Route ${routePath} · auth ${String(entry.authMode || 'none')} · unauth ${observed || 'n/a'}` : 'No gateway route.'}</p>
                  <div className="dash2-chip-row">
                    <StatusBadge tone={Boolean(entry.pidHealthy) ? 'ok' : 'muted'}>{Boolean(entry.pidHealthy) ? 'pid ok' : 'pid no'}</StatusBadge>
                    <StatusBadge tone={Boolean(entry.tcpReachable) ? 'ok' : 'warn'}>{Boolean(entry.tcpReachable) ? 'tcp up' : 'tcp down'}</StatusBadge>
                    {entry.startupMode ? <StatusBadge tone="muted">{String(entry.startupMode)}</StatusBadge> : null}
                  </div>
                  {notes.length > 0 ? <p className="dash2-admin-note">{notes.join(' ')}</p> : null}
                </article>
              );
            })}
          </div>
        )}
      </SectionCard>
      ) : null}

      {activeTab === 'network' ? (
      <SectionCard title="Remote access" subtitle="Preferred tailnet entrypoints for the gateway and SSH.">
        <KeyValueList
          rows={[
            { label: 'Tailscale mode', value: String(tailscale.mode || 'disabled') },
            { label: 'Tailscale status', value: String(tailscale.status || 'unknown') },
            { label: 'Gateway', value: remoteGateway.url ? <a href={String(remoteGateway.url)} target="_blank" rel="noreferrer">{String(remoteGateway.url)}</a> : 'Not configured' },
            { label: 'SSH', value: String(remoteSsh.target || tailscale.sshTarget || 'Not configured') },
            { label: 'Notes', value: asArray<string>(tailscale.notes).filter(Boolean).join(' ') || 'Gateway + SSH over tailnet only; no public funnel configured.' },
          ]}
        />
      </SectionCard>
      ) : null}

      {activeTab === 'logs' ? (
      <SectionCard title="Debug logs" subtitle="V1-style operational log view with filtering and verbose-mode toggle.">
        <div className="dash2-wrap-row">
          <input className="ui-input" type="search" placeholder="Filter logs" value={logSearch} onChange={(event) => setLogSearch(event.target.value)} />
          {(['all', 'info', 'warn', 'error'] as const).map((level) => (
            <button key={level} className={`ui-button ${logFilter === level ? 'dash2-tab-switcher__button--active' : ''}`} type="button" onClick={() => setLogFilter(level)}>
              {level.toUpperCase()}
            </button>
          ))}
          <button className="ui-button" type="button" onClick={() => void toggleVerbose()}>
            {verboseLogging ? 'Disable verbose' : 'Enable verbose'}
          </button>
        </div>
        {logStatus ? <p className="dash2-admin-note">{logStatus}</p> : null}
        <div className="dash2-log-box">
          {filteredLogs.length === 0 ? <p className="dash2-small-copy">No debug events yet.</p> : filteredLogs.slice(0, 80).map((entry, index) => (
            <p key={`${String(entry.timestamp || '')}-${index}`} className="dash2-log-line">
              <span>{String(entry.timestamp || '')}</span>
              <strong>{String(entry.level || 'info').toUpperCase()}</strong>
              <span>{String(entry.message || '')}{entry.meta ? ` ${JSON.stringify(entry.meta)}` : ''}</span>
            </p>
          ))}
        </div>
      </SectionCard>
      ) : null}

      {activeTab === 'help' ? (
      <SectionCard title="Operator help" subtitle="How to use the dashboard and the intended media workflow.">
        <KeyValueList
          rows={[
            { label: 'Overview', value: 'Use Overview for quick host health, active sessions, and drive warnings.' },
            { label: 'Media workflow', value: 'Requests go through Jellyseerr, automation runs through Prowlarr/Sonarr/Radarr, qBittorrent downloads into the ARR lanes, importer moves content into Jellyfin libraries.' },
            { label: 'Transfers', value: 'Use Connect for one-off FTP sessions, Favourites for saved remotes and mounts, and Torrent for qBittorrent lane checks and standalone adds.' },
            { label: 'Files', value: 'Use Files for managed shares, storage protection, and direct browser operations.' },
            { label: 'Terminal', value: 'Use Terminal for shell-only recovery and service-level debugging when the UI is not enough.' },
            { label: 'ARR recovery', value: arrMismatches.length > 0 ? `Current mismatches: ${arrMismatches.join(', ')}` : 'No ARR mapping mismatches are currently reported.' },
          ]}
        />
        {arrEvidence.generatedAt ? (
          <p className="dash2-admin-note">
            ARR evidence generated {String(arrEvidence.generatedAt)}{arrEvidence.lastVerifiedAt ? ` · verified ${String(arrEvidence.lastVerifiedAt)}` : ''}.
          </p>
        ) : null}
      </SectionCard>
      ) : null}
    </>
  );
}
