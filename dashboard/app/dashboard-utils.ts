export type DriveEntry = {
  device: string;
  dirName: string;
  error: string;
  filesystem: string;
  letter: string;
  mountPoint: string;
  name: string;
  state: string;
  uuid: string;
};

export type DriveEvent = {
  timestamp: string;
  level: string;
  event: string;
  error?: string;
  letter?: string;
  mountPoint?: string;
  name?: string;
  filesystem?: string;
};

export type DrivePayload = {
  agentInstalled: boolean;
  checkedAt: string | null;
  events: DriveEvent[];
  manifest: {
    generatedAt: string | null;
    intervalMs: number;
    drives: DriveEntry[];
  };
  refreshIntervalMs: number;
};

export const EMPTY_DRIVE_PAYLOAD: DrivePayload = {
  agentInstalled: false,
  checkedAt: null,
  events: [],
  manifest: {
    generatedAt: null,
    intervalMs: 60000,
    drives: [],
  },
  refreshIntervalMs: 60000,
};

export const formatBytes = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let idx = 0;
  while (size >= 1024 && idx < units.length - 1) {
    size /= 1024;
    idx += 1;
  }

  return `${size.toFixed(idx < 2 ? 0 : 1)} ${units[idx]}`;
};

export const formatRate = (value: number) => `${formatBytes(value)}/s`;

export const formatDuration = (durationMs = 0) => {
  const totalMinutes = Math.max(0, Math.floor(durationMs / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) {
    return `${minutes}m`;
  }
  return `${hours}h ${minutes}m`;
};

export const normalizeDrivePayload = (payload: Partial<DrivePayload> | null | undefined): DrivePayload => ({
  agentInstalled: Boolean(payload?.agentInstalled),
  checkedAt: typeof payload?.checkedAt === 'string' ? payload.checkedAt : null,
  events: Array.isArray(payload?.events) ? payload.events : [],
  manifest: {
    generatedAt: typeof payload?.manifest?.generatedAt === 'string' ? payload.manifest.generatedAt : null,
    intervalMs: Math.max(60000, Number(payload?.manifest?.intervalMs || payload?.refreshIntervalMs || 60000) || 60000),
    drives: Array.isArray(payload?.manifest?.drives) ? payload.manifest.drives : [],
  },
  refreshIntervalMs: Math.max(60000, Number(payload?.refreshIntervalMs || payload?.manifest?.intervalMs || 60000) || 60000),
});
