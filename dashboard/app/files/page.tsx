'use client';

import Link from 'next/link';
import { startTransition, useDeferredValue, useEffect, useRef, useState } from 'react';
import { appFetch, createDemoDownloadUrl } from '../demo-api';
import { isDemoMode } from '../demo-mode';
import type { DrivePayload } from '../dashboard-utils';
import { EMPTY_DRIVE_PAYLOAD as EMPTY_PAYLOAD, formatBytes, normalizeDrivePayload } from '../dashboard-utils';
import {
  collectDroppedUploadFiles,
  collectInputUploadFiles,
  dedupeUploadFiles,
  isFsOperationActive,
  normalizeFsOperation,
} from './filesystem-operations';
import type { FsOperation, FsUploadFile } from './filesystem-operations';
import { DialogSurface, MenuButton, ToolPage } from '../ui-primitives';
import { usePolling } from '../usePolling';

const API = '/api';

type FsEntry = {
  accessLevel?: 'deny' | 'read' | 'write' | string;
  editable: boolean;
  modifiedAt: string;
  name: string;
  path: string;
  shareId?: number;
  shareSourceType?: string;
  size: number;
  type: string;
};

type FsBreadcrumb = {
  label: string;
  path: string;
};

type FsPayload = {
  breadcrumbs: FsBreadcrumb[];
  entries: FsEntry[];
  path: string;
  root: string;
  share: null | {
    accessLevel: 'deny' | 'read' | 'write' | string;
    id: number;
    isReadOnly: boolean;
    name: string;
    pathKey: string;
    sourceType: string;
  };
};

type FsClipboardItem = {
  name: string;
  path: string;
  type: string;
};

type FsClipboard = {
  mode: 'copy' | 'move';
  items: FsClipboardItem[];
} | null;

type FsMenuState = {
  path: string;
  upward: boolean;
} | null;

type FsDropChoice = {
  destinationPath: string;
  sourcePaths: string[];
  sourceSummary: string;
  targetName: string;
} | null;

type SharePermission = {
  accessLevel: 'deny' | 'read' | 'write' | string;
  subjectKey: string;
  subjectType: 'role' | 'user' | 'group' | string;
};

type ShareRecord = {
  createdAt: string;
  description: string;
  id: number;
  isHidden: boolean;
  isReadOnly: boolean;
  name: string;
  pathKey: string;
  permissions: SharePermission[];
  sourceType: string;
  updatedAt: string;
};

type FilesUser = {
  id: number;
  isDisabled: boolean;
  role: string;
  username: string;
};

type ShareFormState = {
  defaultRoleAccess: 'deny' | 'read' | 'write';
  description: string;
  isHidden: boolean;
  isReadOnly: boolean;
  name: string;
  userPermissions: Record<string, 'inherit' | 'deny' | 'read' | 'write'>;
};

const EMPTY_FS: FsPayload = {
  breadcrumbs: [{ label: 'Drives', path: '' }],
  entries: [],
  path: '',
  root: '',
  share: null,
};

const formatTimestamp = (value: string | null) => {
  if (!value) {
    return 'Waiting for first scan';
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'Waiting for first scan' : parsed.toLocaleString();
};

const formatEntryTime = (value: string) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'Unknown' : parsed.toLocaleString();
};

const formatOperationProgress = (operation: FsOperation) => {
  if (operation.totalBytes > 0) {
    const ratio = Math.min(1, operation.processedBytes / operation.totalBytes);
    return `${Math.round(ratio * 100)}%`;
  }
  if (operation.totalItems > 0) {
    const ratio = Math.min(1, operation.processedItems / operation.totalItems);
    return `${Math.round(ratio * 100)}%`;
  }
  return operation.status === 'success' ? '100%' : '0%';
};

const describeOperation = (operation: FsOperation) => {
  const targetLabel = operation.destinationPath.split('/').filter(Boolean).pop() || 'folder';
  switch (operation.kind) {
    case 'upload':
      return `Upload to ${targetLabel}`;
    case 'move':
      return `Move to ${targetLabel}`;
    case 'delete':
      return 'Recycle entries';
    default:
      return `Copy to ${targetLabel}`;
  }
};

const normalizeFsPayload = (payload: Partial<FsPayload> | null | undefined): FsPayload => ({
  breadcrumbs: Array.isArray(payload?.breadcrumbs) && payload.breadcrumbs.length > 0
    ? payload.breadcrumbs.map((crumb) => ({
        label: String(crumb?.label || 'Drives'),
        path: String(crumb?.path || ''),
      }))
    : [{ label: 'Drives', path: '' }],
  entries: Array.isArray(payload?.entries)
    ? payload.entries.map((entry) => ({
        accessLevel: String(entry?.accessLevel || ''),
        editable: entry?.editable !== false,
        modifiedAt: String(entry?.modifiedAt || ''),
        name: String(entry?.name || ''),
        path: String(entry?.path || ''),
        shareId: entry?.shareId ? Number(entry.shareId) : undefined,
        shareSourceType: entry?.shareSourceType ? String(entry.shareSourceType) : undefined,
        size: Number(entry?.size || 0),
        type: String(entry?.type || 'file'),
      }))
    : [],
  path: String(payload?.path || ''),
  root: String(payload?.root || ''),
  share: payload?.share ? {
    accessLevel: String(payload.share.accessLevel || ''),
    id: Number(payload.share.id || 0),
    isReadOnly: Boolean(payload.share.isReadOnly),
    name: String(payload.share.name || ''),
    pathKey: String(payload.share.pathKey || ''),
    sourceType: String(payload.share.sourceType || 'folder'),
  } : null,
});

const topLevelName = (value: string) => value.split('/').filter(Boolean)[0] || value;
const normalizeDefaultRoleAccess = (value: string | null | undefined) => (value === 'read' || value === 'write' ? value : 'deny');
const normalizeUserOverrideAccess = (value: string | null | undefined): 'inherit' | 'deny' | 'read' | 'write' =>
  value === 'deny' || value === 'read' || value === 'write' ? value : 'inherit';

const normalizeShareRecord = (payload: Partial<ShareRecord> | null | undefined): ShareRecord => ({
  createdAt: String(payload?.createdAt || ''),
  description: String(payload?.description || ''),
  id: Number(payload?.id || 0),
  isHidden: Boolean(payload?.isHidden),
  isReadOnly: Boolean(payload?.isReadOnly),
  name: String(payload?.name || ''),
  pathKey: String(payload?.pathKey || ''),
  permissions: Array.isArray(payload?.permissions)
    ? payload.permissions.map((entry) => ({
        accessLevel: String(entry?.accessLevel || 'deny'),
        subjectKey: String(entry?.subjectKey || ''),
        subjectType: String(entry?.subjectType || 'role'),
      }))
    : [],
  sourceType: String(payload?.sourceType || 'folder'),
  updatedAt: String(payload?.updatedAt || ''),
});

const getShareDefaultRoleAccess = (share: ShareRecord | null) =>
  normalizeDefaultRoleAccess(
    share?.permissions.find((entry) => entry.subjectType === 'role' && entry.subjectKey.toLowerCase() === 'user')?.accessLevel
  );

const getShareUserPermissionMap = (share: ShareRecord | null): Record<string, 'inherit' | 'deny' | 'read' | 'write'> => {
  if (!share) {
    return {};
  }

  return share.permissions.reduce<Record<string, 'inherit' | 'deny' | 'read' | 'write'>>((acc, entry) => {
    if (entry.subjectType === 'user' && entry.subjectKey) {
      acc[entry.subjectKey.toLowerCase()] = normalizeUserOverrideAccess(entry.accessLevel);
    }
    return acc;
  }, {});
};

export default function FilesPage() {
  const demoMode = isDemoMode();
  const uploadFilesInputRef = useRef<HTMLInputElement | null>(null);
  const uploadFolderInputRef = useRef<HTMLInputElement | null>(null);
  const menuTriggerRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const activeOperationIdsRef = useRef<string[]>([]);
  const [driveState, setDriveState] = useState<DrivePayload>(EMPTY_PAYLOAD);
  const [browser, setBrowser] = useState<FsPayload>(EMPTY_FS);
  const [operations, setOperations] = useState<FsOperation[]>([]);
  const [loadError, setLoadError] = useState('');
  const [browserError, setBrowserError] = useState('');
  const [manualBusy, setManualBusy] = useState(false);
  const [browserBusy, setBrowserBusy] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [driveAccessDenied, setDriveAccessDenied] = useState(false);
  const [showDriveLog, setShowDriveLog] = useState(false);
  const [shareInventory, setShareInventory] = useState<ShareRecord[]>([]);
  const [usersInventory, setUsersInventory] = useState<FilesUser[]>([]);
  const [shareAdminAvailable, setShareAdminAvailable] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareStatus, setShareStatus] = useState('');
  const [shareForm, setShareForm] = useState<ShareFormState | null>(null);
  const [selectedPath, setSelectedPath] = useState('');
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [clipboard, setClipboard] = useState<FsClipboard>(null);
  const [menuState, setMenuState] = useState<FsMenuState>(null);
  const [dropTargetPath, setDropTargetPath] = useState('');
  const [dropChoice, setDropChoice] = useState<FsDropChoice>(null);
  const [locationsOpen, setLocationsOpen] = useState(false);
  const [isNarrowLayout, setIsNarrowLayout] = useState(false);
  const [isPhoneLayout, setIsPhoneLayout] = useState(false);
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());

  const loadDriveState = async () => {
    const res = await appFetch(`${API}/drives`, { credentials: 'include' });
    if (res.status === 403) {
      setDriveAccessDenied(true);
      return EMPTY_PAYLOAD;
    }
    if (!res.ok) {
      throw new Error(res.status === 401 ? 'Login required to read drive state' : 'Unable to read drive state');
    }

    setDriveAccessDenied(false);
    return normalizeDrivePayload(await res.json());
  };

  const syncDriveState = async () => {
    try {
      const payload = await loadDriveState();
      startTransition(() => {
        setDriveState(payload);
        setLoadError('');
      });
    } catch (error) {
      setLoadError(String(error instanceof Error ? error.message : error || 'Unable to read drive state'));
    }
  };

  const loadShares = async () => {
    const res = await appFetch(`${API}/shares`, { credentials: 'include' });
    if (res.status === 403) {
      setShareAdminAvailable(false);
      setShareInventory([]);
      return [];
    }
    if (!res.ok) {
      throw new Error(res.status === 401 ? 'Login required to manage shares' : 'Unable to read shares');
    }

    const payload = await res.json().catch(() => ({}));
    const shares = Array.isArray(payload?.shares) ? payload.shares.map((entry: Partial<ShareRecord>) => normalizeShareRecord(entry)) : [];
    setShareAdminAvailable(true);
    setShareInventory(shares);
    return shares;
  };

  const loadUsers = async () => {
    const res = await appFetch(`${API}/users`, { credentials: 'include' });
    if (res.status === 403) {
      setUsersInventory([]);
      return [];
    }
    if (!res.ok) {
      throw new Error(res.status === 401 ? 'Login required to manage users' : 'Unable to read users');
    }

    const payload = await res.json().catch(() => ({}));
    const users = Array.isArray(payload?.users)
      ? payload.users.map((entry: Partial<FilesUser>) => ({
          id: Number(entry?.id || 0),
          isDisabled: Boolean(entry?.isDisabled),
          role: String(entry?.role || 'user'),
          username: String(entry?.username || ''),
        }))
      : [];
    setUsersInventory(users);
    return users;
  };

  const loadDirectory = async (targetPath = '', options?: { preserveSelection?: boolean }) => {
    setBrowserBusy(true);
    try {
      const query = new URLSearchParams();
      if (targetPath) {
        query.set('path', targetPath);
      }

      const suffix = query.toString() ? `?${query.toString()}` : '';
      const res = await appFetch(`${API}/fs/list${suffix}`, { credentials: 'include' });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(String(payload?.error || (res.status === 401 ? 'Login required to read files' : 'Unable to load files')));
      }

      const normalizedPayload = normalizeFsPayload(payload);
      startTransition(() => {
        setBrowser(normalizedPayload);
        setBrowserError('');
        if (!options?.preserveSelection || !normalizedPayload.entries.some((entry) => entry.path === selectedPath)) {
          setSelectedPath('');
        }
        setSelectedPaths((current) => current.filter((entryPath) => normalizedPayload.entries.some((entry) => entry.path === entryPath)));
      });
    } catch (error) {
      setBrowserError(String(error instanceof Error ? error.message : error || 'Unable to load files'));
    } finally {
      setBrowserBusy(false);
    }
  };

  useEffect(() => {
    void syncDriveState();
  }, []);

  usePolling(true, driveState.refreshIntervalMs, syncDriveState);

  useEffect(() => {
    void loadDirectory('');
  }, []);

  useEffect(() => {
    void loadFsOperations();
  }, []);

  useEffect(() => {
    void loadShares().catch(() => {});
    void loadUsers().catch(() => {});
  }, []);

  useEffect(() => {
    setMenuState(null);
    setLocationsOpen(false);
    setDropChoice(null);
    setDropTargetPath('');
  }, [browser.path]);

  useEffect(() => {
    const syncLayout = () => {
      const width = window.innerWidth;
      setIsNarrowLayout(width < 900);
      setIsPhoneLayout(width < 760);
    };

    syncLayout();
    window.addEventListener('resize', syncLayout);
    return () => window.removeEventListener('resize', syncLayout);
  }, []);

  useEffect(() => {
    if (!uploadFolderInputRef.current) {
      return;
    }
    uploadFolderInputRef.current.setAttribute('webkitdirectory', '');
    uploadFolderInputRef.current.setAttribute('directory', '');
  }, []);

  const selectedShare = browser.path === ''
    ? shareInventory.find((share) => share.pathKey === selectedPath) || null
    : browser.share
      ? shareInventory.find((share) => share.id === browser.share?.id) || null
      : null;

  useEffect(() => {
    if (!selectedShare) {
      setShareForm(null);
      setShareStatus('');
      return;
    }

    setShareForm({
      defaultRoleAccess: getShareDefaultRoleAccess(selectedShare),
      description: selectedShare.description,
      isHidden: selectedShare.isHidden,
      isReadOnly: selectedShare.isReadOnly,
      name: selectedShare.name,
      userPermissions: getShareUserPermissionMap(selectedShare),
    });
    setShareStatus('');
  }, [selectedShare]);

  const runManualCheck = async () => {
    setManualBusy(true);
    try {
      const res = await appFetch(`${API}/drives/check`, {
        method: 'POST',
        credentials: 'include',
      });

      if (res.status === 403) {
        setDriveAccessDenied(true);
        setLoadError('Drive management is available to admins only.');
        return;
      }
      if (!res.ok) {
        throw new Error(res.status === 401 ? 'Login required to run a drive check' : 'Drive check failed');
      }

      const payload = normalizeDrivePayload(await res.json());
      startTransition(() => {
        setDriveState(payload);
        setLoadError('');
      });
      await loadDirectory(browser.path, { preserveSelection: true });
    } catch (error) {
      setLoadError(String(error instanceof Error ? error.message : error || 'Drive check failed'));
    } finally {
      setManualBusy(false);
    }
  };

  const runFsCommand = async (endpoint: string, body: Record<string, unknown>) => {
    const res = await appFetch(`${API}${endpoint}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(String(payload?.error || 'Filesystem action failed'));
    }
    return payload;
  };

  const upsertOperation = (operation: FsOperation) => {
    setOperations((current) => {
      const next = [normalizeFsOperation(operation), ...current.filter((entry) => entry.id !== operation.id)];
      return next
        .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
        .slice(0, 16);
    });
  };

  const loadFsOperations = async () => {
    try {
      const res = await appFetch(`${API}/fs/operations?limit=16`, { credentials: 'include' });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(String(payload?.error || 'Unable to read filesystem operations'));
      }

      const nextOperations: FsOperation[] = Array.isArray(payload?.operations)
        ? payload.operations.map((entry: Partial<FsOperation>) => normalizeFsOperation(entry))
        : [];
      const previousActiveIds = new Set(activeOperationIdsRef.current);
      const nextActiveIds = nextOperations.filter((entry) => isFsOperationActive(entry)).map((entry) => entry.id);
      const completedIds = nextOperations
        .filter((entry) => previousActiveIds.has(entry.id) && !isFsOperationActive(entry))
        .map((entry) => entry.id);

      activeOperationIdsRef.current = nextActiveIds;
      startTransition(() => {
        setOperations(nextOperations);
      });

      if (completedIds.length > 0) {
        void loadDirectory(browser.path, { preserveSelection: true });
      }
    } catch {
      // keep operations UI best-effort; filesystem page remains usable without the queue snapshot
    }
  };

  usePolling(true, operations.some((entry) => isFsOperationActive(entry)) ? 1000 : 5000, loadFsOperations);

  const createFsOperation = async (endpoint: string, body: Record<string, unknown>) => {
    const res = await appFetch(`${API}${endpoint}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(String(payload?.error || 'Filesystem operation failed'));
    }
    const operation = normalizeFsOperation(payload?.operation);
    upsertOperation(operation);
    return operation;
  };

  const uploadFileToOperation = async (operation: FsOperation, fileEntry: FsUploadFile, uploadedBytesBeforeFile: number) =>
    new Promise<FsOperation>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API}/fs/operations/${encodeURIComponent(operation.id)}/file?relativePath=${encodeURIComponent(fileEntry.relativePath)}`);
      xhr.withCredentials = true;
      xhr.setRequestHeader('Content-Type', fileEntry.file.type || 'application/octet-stream');
      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) {
          return;
        }
        upsertOperation({
          ...operation,
          message: `Uploading ${fileEntry.relativePath}`,
          processedBytes: Math.min(operation.totalBytes, uploadedBytesBeforeFile + event.loaded),
          processedItems: operation.processedItems,
          updatedAt: new Date().toISOString(),
        });
      };
      xhr.onerror = () => reject(new Error('Upload failed'));
      xhr.onload = () => {
        let payload: { error?: string; operation?: Partial<FsOperation> } = {};
        try {
          payload = xhr.responseText ? JSON.parse(xhr.responseText) as { error?: string; operation?: Partial<FsOperation> } : {};
        } catch {
          payload = {};
        }
        if (xhr.status < 200 || xhr.status >= 300) {
          reject(new Error(String(payload?.error || 'Upload failed')));
          return;
        }
        const nextOperation = normalizeFsOperation(payload?.operation);
        upsertOperation(nextOperation);
        resolve(nextOperation);
      };
      xhr.send(fileEntry.file);
    });

  const startUploadOperation = async (destinationPath: string, files: FsUploadFile[]) => {
    const uploadFiles = dedupeUploadFiles(files);
    if (uploadFiles.length === 0) {
      return;
    }

    setUploadBusy(true);
    setBrowserError('');
    try {
      let operation = await createFsOperation('/fs/operations/upload', {
        destinationPath,
        manifest: uploadFiles.map((entry) => ({
          lastModified: entry.lastModified,
          relativePath: entry.relativePath,
          size: entry.size,
        })),
      });

      let uploadedBytes = operation.processedBytes;
      const uploadedSet = new Set(operation.uploadedFiles || []);
      for (const fileEntry of uploadFiles) {
        if (uploadedSet.has(fileEntry.relativePath)) {
          uploadedBytes += fileEntry.size;
          continue;
        }
        operation = await uploadFileToOperation(operation, fileEntry, uploadedBytes);
        uploadedBytes += fileEntry.size;
      }

      await createFsOperation(`/fs/operations/${operation.id}/finalize`, {});
      await loadFsOperations();
    } catch (error) {
      setBrowserError(String(error instanceof Error ? error.message : error || 'Upload failed'));
    } finally {
      setUploadBusy(false);
    }
  };

  const normalizeTargetEntries = (entries: FsEntry[]) => {
    const seen = new Set<string>();
    return entries.filter((entry) => {
      if (seen.has(entry.path)) {
        return false;
      }
      seen.add(entry.path);
      return true;
    });
  };

  const getSelectionEntries = () => {
    const selected = selectedPaths
      .map((entryPath) => browser.entries.find((entry) => entry.path === entryPath) || null)
      .filter((entry): entry is FsEntry => Boolean(entry));

    if (selected.length > 0) {
      return normalizeTargetEntries(selected);
    }

    const active = browser.entries.find((entry) => entry.path === selectedPath);
    return active ? [active] : [];
  };

  const toggleSelection = (entryPath: string, checked: boolean) => {
    setSelectedPaths((current) => checked
      ? current.includes(entryPath)
        ? current
        : [...current, entryPath]
      : current.filter((value) => value !== entryPath));
  };

  const setSelectionOnly = (entryPath: string) => {
    setSelectedPath(entryPath);
    setSelectedPaths([entryPath]);
  };

  const toggleVisibleSelection = (entryPaths: string[], checked: boolean) => {
    setSelectedPaths((current) => {
      if (checked) {
        return [...new Set([...current, ...entryPaths])];
      }
      const blocked = new Set(entryPaths);
      return current.filter((value) => !blocked.has(value));
    });
  };

  const clearSelection = () => {
    setSelectedPath('');
    setSelectedPaths([]);
  };

  const createFolder = async () => {
    const label = browser.path === '' ? 'Share name' : 'Folder name';
    const name = window.prompt(label);
    if (!name) {
      return;
    }

    try {
      if (browser.path === '') {
        const res = await appFetch(`${API}/shares`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(String(payload?.error || 'Unable to create share'));
        }
        await loadShares();
        setSelectedPath(String(payload?.share?.pathKey || ''));
      } else {
        await runFsCommand('/fs/mkdir', { name, path: browser.path });
      }
      await loadDirectory(browser.path, { preserveSelection: true });
    } catch (error) {
      setBrowserError(String(error instanceof Error ? error.message : error || `Unable to create ${browser.path === '' ? 'share' : 'folder'}`));
    }
  };

  const saveSharePolicy = async () => {
    if (!selectedShare || !shareForm) {
      return;
    }

    setShareBusy(true);
    setShareStatus('');
    try {
      const res = await appFetch(`${API}/shares/${selectedShare.id}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          defaultRoleAccess: shareForm.defaultRoleAccess,
          description: shareForm.description,
          isHidden: shareForm.isHidden,
          isReadOnly: shareForm.isReadOnly,
          name: shareForm.name,
          userPermissions: Object.entries(shareForm.userPermissions)
            .filter(([, accessLevel]) => accessLevel !== 'inherit')
            .map(([username, accessLevel]) => ({ username, accessLevel })),
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(String(payload?.error || 'Unable to update share'));
      }

      await loadShares();
      await loadDirectory(browser.path || '', { preserveSelection: true });
      setShareStatus('Share policy saved.');
    } catch (error) {
      setShareStatus(String(error instanceof Error ? error.message : error || 'Unable to update share'));
    } finally {
      setShareBusy(false);
    }
  };

  const renameEntry = async (entry: FsEntry | null) => {
    if (!entry) {
      return;
    }

    const name = window.prompt('Rename entry', entry.name);
    if (!name || name === entry.name) {
      return;
    }

    try {
      const payload = await runFsCommand('/fs/rename', { path: entry.path, name });
      await loadDirectory(browser.path);
      setSelectedPath(String(payload?.path || ''));
    } catch (error) {
      setBrowserError(String(error instanceof Error ? error.message : error || 'Unable to rename entry'));
    }
  };

  const renameSelected = async () => {
    await renameEntry(getSelectionEntries().length === 1 ? getSelectionEntries()[0] : null);
  };

  const deleteEntries = async (entries: FsEntry[]) => {
    if (entries.length === 0) {
      return;
    }
    const label = entries.length === 1 ? entries[0].name : `${entries.length} entries`;
    if (!window.confirm(`Delete ${label}?`)) {
      return;
    }

    try {
      await createFsOperation('/fs/operations/delete', entries.length === 1
        ? { path: entries[0].path }
        : { paths: entries.map((entry) => entry.path) });
      setBrowserError('');
      clearSelection();
      await loadFsOperations();
    } catch (error) {
      setBrowserError(String(error instanceof Error ? error.message : error || 'Unable to delete entry'));
    }
  };

  const deleteSelected = async () => {
    await deleteEntries(getSelectionEntries());
  };

  const openEntry = async (entry: FsEntry) => {
    setSelectedPath(entry.path);

    if (entry.type === 'directory' || entry.type === 'symlink') {
      await loadDirectory(entry.path);
      return;
    }

    window.open(
      demoMode
        ? createDemoDownloadUrl(entry.path)
        : `${API}/fs/download?path=${encodeURIComponent(entry.path)}`,
      '_blank',
      'noopener,noreferrer'
    );
  };

  const setClipboardFromEntries = (entries: FsEntry[], mode: 'copy' | 'move') => {
    const normalizedEntries = normalizeTargetEntries(entries);
    if (normalizedEntries.length === 0) {
      return;
    }

    const blocked = normalizedEntries.find((entry) => !entry.editable);
    if (blocked) {
      setBrowserError(`This ${blocked.type} cannot be ${mode === 'move' ? 'moved' : 'copied'}.`);
      return;
    }

    setClipboard({
      mode,
      items: normalizedEntries.map((entry) => ({
        name: entry.name,
        path: entry.path,
        type: entry.type,
      })),
    });
    setBrowserError('');
  };

  const setClipboardFromSelection = (mode: 'copy' | 'move') => {
    const entries = getSelectionEntries();
    if (entries.length === 0) {
      return;
    }
    setClipboardFromEntries(entries, mode);
  };

  const pasteClipboard = async () => {
    if (!clipboard) {
      return;
    }

    try {
      const operation = await createFsOperation('/fs/operations/transfer', clipboard.items.length === 1
        ? {
            sourcePath: clipboard.items[0].path,
            destinationPath: browser.path,
            mode: clipboard.mode,
          }
        : {
            sourcePaths: clipboard.items.map((entry) => entry.path),
            destinationPath: browser.path,
            mode: clipboard.mode,
          });
      setSelectedPath(String(operation.destinationPath || ''));
      setBrowserError('');
      if (clipboard.mode === 'move') {
        setClipboard(null);
      }
    } catch (error) {
      setBrowserError(String(error instanceof Error ? error.message : error || 'Paste failed'));
    }
  };

  const handleUploadTrigger = (mode: 'files' | 'folder') => {
    if (mode === 'folder') {
      uploadFolderInputRef.current?.click();
      return;
    }
    uploadFilesInputRef.current?.click();
  };

  const openFsMenu = (entry: FsEntry) => {
    if (isPhoneLayout) {
      setSelectedPath(entry.path);
      setMenuState({ path: entry.path, upward: false });
      return;
    }

    const trigger = menuTriggerRefs.current[entry.path];
    const rect = trigger?.getBoundingClientRect();
    const upward = rect ? rect.bottom > window.innerHeight - 180 : false;
    setSelectedPath(entry.path);
    setMenuState((current) => current?.path === entry.path ? null : { path: entry.path, upward });
  };

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>, mode: 'files' | 'folder') => {
    const files = collectInputUploadFiles(event.target.files, mode);
    event.target.value = '';
    if (files.length === 0) {
      return;
    }

    await startUploadOperation(browser.path, files);
  };

  const startTransferOperation = async (mode: 'copy' | 'move', destinationPath: string, sourcePaths: string[]) => {
    const uniqueSourcePaths = [...new Set(sourcePaths.filter(Boolean))];
    if (uniqueSourcePaths.length === 0) {
      return;
    }
    await createFsOperation('/fs/operations/transfer', uniqueSourcePaths.length === 1
      ? { sourcePath: uniqueSourcePaths[0], destinationPath, mode }
      : { sourcePaths: uniqueSourcePaths, destinationPath, mode });
    if (mode === 'move' && clipboard?.mode === 'move') {
      const movedSet = new Set(uniqueSourcePaths);
      setClipboard((current) => {
        if (!current) {
          return current;
        }
        const items = current.items.filter((entry) => !movedSet.has(entry.path));
        return items.length > 0 ? { ...current, items } : null;
      });
    }
  };

  const handleRowDragStart = (event: React.DragEvent<HTMLElement>, entry: FsEntry) => {
    if (!entry.editable || browser.path === '') {
      event.preventDefault();
      return;
    }

    const selectedEntriesForDrag = selectedPaths.includes(entry.path)
      ? getSelectionEntries().filter((item) => item.editable)
      : [entry].filter((item) => item.editable);
    if (selectedEntriesForDrag.length === 0) {
      event.preventDefault();
      return;
    }

    const sourcePaths = selectedEntriesForDrag.map((item) => item.path);
    setSelectedPath(entry.path);
    setSelectedPaths(sourcePaths);
    event.dataTransfer.effectAllowed = 'copyMove';
    event.dataTransfer.setData('application/x-home-server-fs-paths', JSON.stringify(sourcePaths));
    event.dataTransfer.setData('text/plain', selectedEntriesForDrag.map((item) => item.name).join(', '));
  };

  const handleDropHover = (event: React.DragEvent<HTMLElement>, destinationPath: string, allowWrite: boolean) => {
    if (!allowWrite) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = event.dataTransfer.types.includes('application/x-home-server-fs-paths') ? 'move' : 'copy';
    setDropTargetPath(destinationPath);
  };

  const handleDropLeave = (destinationPath: string) => {
    setDropTargetPath((current) => current === destinationPath ? '' : current);
  };

  const handleExternalDrop = async (event: React.DragEvent<HTMLElement>, destinationPath: string) => {
    event.preventDefault();
    setDropTargetPath('');
    const sourcePathsRaw = event.dataTransfer.getData('application/x-home-server-fs-paths');
    if (sourcePathsRaw) {
      try {
        const parsed = JSON.parse(sourcePathsRaw) as string[];
        const sourcePaths = Array.isArray(parsed) ? parsed.map((entry) => String(entry || '')).filter(Boolean) : [];
        if (sourcePaths.length > 0) {
          const sourceSummary = sourcePaths.length === 1 ? sourcePaths[0].split('/').pop() || sourcePaths[0] : `${sourcePaths.length} items`;
          setDropChoice({
            destinationPath,
            sourcePaths,
            sourceSummary,
            targetName: destinationPath.split('/').pop() || currentFolderLabel,
          });
          return;
        }
      } catch {
        // fall back to external file collection
      }
    }

    try {
      const files = await collectDroppedUploadFiles(event.dataTransfer);
      if (files.length === 0) {
        return;
      }
      await startUploadOperation(destinationPath, files);
    } catch (error) {
      setBrowserError(String(error instanceof Error ? error.message : error || 'Unable to collect dropped files'));
    }
  };

  const drives = driveState.manifest.drives;
  const statusText = driveAccessDenied
    ? 'Drive management is admin-only. Share browsing remains available for accounts with share access.'
    : !driveState.agentInstalled
    ? 'termux-drive-agent is not installed yet. Only C will appear until the agent is available.'
    : drives.length > 0
      ? `${drives.length} removable drive${drives.length === 1 ? '' : 's'} detected.`
      : 'Only C is currently present. Connect a removable drive or run Check Drives.';

  const selectedEntry = browser.entries.find((entry) => entry.path === selectedPath) || null;
  const filteredEntries = deferredSearch
    ? browser.entries.filter((entry) => entry.name.toLowerCase().includes(deferredSearch))
    : browser.entries;
  const selectedEntries = getSelectionEntries();
  const selectedCount = selectedEntries.length;
  const visibleEntryPaths = filteredEntries.map((entry) => entry.path);
  const allVisibleSelected = visibleEntryPaths.length > 0 && visibleEntryPaths.every((entryPath) => selectedPaths.includes(entryPath));
  const clipboardCount = clipboard?.items.length || 0;
  const clipboardLabel = clipboardCount <= 1
    ? clipboard?.items[0]?.name || ''
    : `${clipboardCount} items`;
  const directoryCount = filteredEntries.filter((entry) => entry.type === 'directory' || entry.type === 'symlink').length;
  const fileCount = filteredEntries.length - directoryCount;
  const activeOperations = operations.filter((entry) => isFsOperationActive(entry));
  const recentOperations = operations.slice(0, 8);
  const canWriteCurrentFolder = browser.path === ''
    ? false
    : browser.share?.accessLevel === 'write' && browser.share?.isReadOnly !== true;
  const canCreateShare = browser.path === '' && shareAdminAvailable;
  const selectionCanEdit = selectedEntries.length > 0 && selectedEntries.every((entry) => entry.editable);
  const canRenameSelection = selectedEntries.length === 1 && selectedEntries[0].editable;
  const canOpenSelection = selectedEntries.length === 1;
  const parentPath = browser.breadcrumbs.length > 1 ? browser.breadcrumbs[browser.breadcrumbs.length - 2]?.path || '' : '';
  const quickLinks = browser.path === ''
    ? browser.entries.filter((entry) => entry.type === 'directory' || entry.type === 'symlink')
    : browser.entries
        .filter((entry) => entry.type === 'directory' || entry.type === 'symlink')
        .slice(0, 10);
  const currentFolderLabel = browser.breadcrumbs[browser.breadcrumbs.length - 1]?.label || 'Drives';
  const rootPathLabel = browser.root || 'Resolving root…';

  return (
    <ToolPage
      title="Filesystem"
      subtitle="Drives, shares, and local transfers."
      className="tool-page--filesystem"
      actions={(
        <>
          <Link href="/?tab=home" className="ui-button">
            Home
          </Link>
          {!driveAccessDenied ? (
            <button className="ui-button ui-button--primary" type="button" onClick={runManualCheck} disabled={manualBusy}>
              {manualBusy ? 'Checking…' : 'Check Drives'}
            </button>
          ) : null}
          <button className="ui-button" type="button" onClick={() => void loadDirectory(browser.path, { preserveSelection: true })} disabled={browserBusy}>
            {browserBusy ? 'Refreshing…' : 'Refresh Folder'}
          </button>
        </>
      )}
    >

      <section className="tool-stack">
        <div className="tool-banner">
          <div className="tool-banner__row">
            <div>
              <strong>{statusText}</strong>
              <p className="tool-banner__meta">Last agent scan: {formatTimestamp(driveState.manifest.generatedAt)}</p>
              <p className="tool-banner__meta">Last page refresh: {formatTimestamp(driveState.checkedAt)}</p>
            </div>
            {!driveAccessDenied ? (
              <div className="tool-inline-actions">
                <button className="ui-button" type="button" onClick={() => setShowDriveLog((value) => !value)}>
                  {showDriveLog ? 'Hide Drive Log' : 'Show Drive Log'}
                </button>
              </div>
            ) : null}
          </div>
          {loadError ? <p className="status-message status-message--error">{loadError}</p> : null}
        </div>

        {!driveAccessDenied ? (
        <div className="tool-card-grid">
          <article className="tool-card">
            <p className="tool-card__eyebrow">Internal</p>
            <h2 className="tool-card__title">C</h2>
            <p className="tool-card__meta">Always present through the shared Android storage bind.</p>
          </article>
          {drives.map((drive) => (
            <article key={`${drive.device}-${drive.mountPoint}`} className="tool-card">
              <div className="tool-inline-actions">
                <p className="tool-card__eyebrow">{drive.filesystem || 'drive'}</p>
                <span className={`tool-status-pill ${drive.state === 'mounted' ? 'tool-status-pill--ok' : 'tool-status-pill--error'}`}>
                  {drive.state}
                </span>
              </div>
              <h2 className="tool-card__title">{drive.dirName || `${drive.letter} (${drive.name})`}</h2>
              <p className="tool-card__meta">{drive.mountPoint}</p>
              <p className="tool-card__meta">Device: {drive.device}</p>
              {drive.uuid ? <p className="tool-card__meta">UUID: {drive.uuid}</p> : null}
              {drive.error ? <p className="status-message status-message--error">{drive.error}</p> : null}
            </article>
          ))}
        </div>
        ) : null}

        {showDriveLog && !driveAccessDenied ? (
          <div className="tool-log-shell">
            {driveState.events.length === 0 ? (
              <p className="tool-banner__meta">No drive agent events yet.</p>
            ) : (
              <div className="tool-log-list">
                {driveState.events.map((event, index) => (
                  <article key={`${event.timestamp}-${event.event}-${index}`} className="tool-log-item">
                    <strong>{event.event}</strong>
                    <p className="tool-log-meta">
                      [{formatTimestamp(event.timestamp)}] {event.level}
                      {event.letter ? ` · ${event.letter}` : ''}
                      {event.name ? ` · ${event.name}` : ''}
                      {event.filesystem ? ` · ${event.filesystem}` : ''}
                    </p>
                    {event.mountPoint ? <p className="tool-log-meta">{event.mountPoint}</p> : null}
                    {event.error ? <p className="tool-log-meta">{event.error}</p> : null}
                  </article>
                ))}
              </div>
            )}
          </div>
        ) : null}

        <section className="fs-shell">
          {isNarrowLayout && locationsOpen ? (
            <button className="fs-drawer-backdrop" type="button" aria-label="Close locations" onClick={() => setLocationsOpen(false)} />
          ) : null}

          <aside className={`fs-sidebar ${isNarrowLayout ? 'fs-sidebar--drawer' : ''} ${locationsOpen ? 'fs-sidebar--drawer-open' : ''}`}>
            <div className="fs-sidebar__section">
              <div className="fs-sidebar__header">
                <strong>Locations</strong>
              </div>
              <button
                className={`fs-shortcut ${browser.path === '' ? 'fs-shortcut--active' : ''}`}
                type="button"
                onClick={() => void loadDirectory('')}
              >
                Drives Root
              </button>
              {quickLinks.map((entry) => (
                <button
                  key={entry.path}
                  className={`fs-shortcut ${topLevelName(browser.path) === topLevelName(entry.path) ? 'fs-shortcut--active' : ''}`}
                  type="button"
                  onClick={() => void loadDirectory(entry.path)}
                >
                  <span>{entry.name}</span>
                  <small>{browser.path === '' ? (entry.shareSourceType || 'share') : (entry.type === 'directory' || entry.type === 'symlink' ? 'folder' : 'file')}</small>
                </button>
              ))}
            </div>

            <div className="fs-sidebar__section">
              <div className="fs-sidebar__header">
                <strong>Selection</strong>
              </div>
              {selectedCount > 1 ? (
                <div className="fs-selection">
                  <p>{selectedCount} entries selected</p>
                  <span>Batch actions are available in the command bar.</span>
                  <span>{selectedEntries.filter((entry) => entry.type === 'directory' || entry.type === 'symlink').length} folders · {selectedEntries.filter((entry) => entry.type !== 'directory' && entry.type !== 'symlink').length} files</span>
                </div>
              ) : selectedEntry ? (
                <div className="fs-selection">
                  <p>{selectedEntry.name}</p>
                  <span>{browser.path === '' ? (selectedEntry.shareSourceType || 'share') : selectedEntry.type}</span>
                  <span>{browser.path === '' ? `${selectedEntry.accessLevel || 'read'} access` : selectedEntry.type === 'file' ? formatBytes(selectedEntry.size) : 'directory'}</span>
                  <span>{formatEntryTime(selectedEntry.modifiedAt)}</span>
                </div>
              ) : (
                <p className="tool-banner__meta">Pick a file or folder to act on it.</p>
              )}
            </div>

            {browser.path === '' && shareAdminAvailable && selectedShare && shareForm ? (
              <div className="fs-sidebar__section">
                <div className="fs-sidebar__header">
                  <strong>Share Policy</strong>
                </div>
                <div className="fs-policy-form">
                  <label className="fs-policy-field">
                    <span>Name</span>
                    <input
                      className="ui-input"
                      type="text"
                      value={shareForm.name}
                      onChange={(event) => setShareForm((current) => current ? { ...current, name: event.target.value } : current)}
                    />
                  </label>
                  <label className="fs-policy-field">
                    <span>Description</span>
                    <textarea
                      className="ui-input fs-policy-textarea"
                      value={shareForm.description}
                      onChange={(event) => setShareForm((current) => current ? { ...current, description: event.target.value } : current)}
                      rows={3}
                    />
                  </label>
                  <label className="fs-policy-field">
                    <span>Default user access</span>
                    <select
                      className="ui-input"
                      value={shareForm.defaultRoleAccess}
                      onChange={(event) => setShareForm((current) => current ? { ...current, defaultRoleAccess: normalizeDefaultRoleAccess(event.target.value) } : current)}
                    >
                      <option value="deny">Deny</option>
                      <option value="read">Read only</option>
                      <option value="write">Read and write</option>
                    </select>
                  </label>
                  {usersInventory.filter((user) => user.role !== 'admin').length > 0 ? (
                    <div className="fs-policy-field">
                      <span>User-specific access</span>
                      <div className="fs-policy-user-list">
                        {usersInventory
                          .filter((user) => user.role !== 'admin')
                          .map((user) => (
                            <label key={user.id} className="fs-policy-user-row">
                              <div>
                                <strong>{user.username}</strong>
                                <small>{user.isDisabled ? 'disabled account' : 'user override'}</small>
                              </div>
                              <select
                                className="ui-input"
                                value={shareForm.userPermissions[user.username.toLowerCase()] || 'inherit'}
                                onChange={(event) => {
                                  const nextValue = normalizeUserOverrideAccess(event.target.value);
                                  setShareForm((current) => current ? {
                                    ...current,
                                    userPermissions: {
                                      ...current.userPermissions,
                                      [user.username.toLowerCase()]: nextValue,
                                    },
                                  } : current);
                                }}
                              >
                                <option value="inherit">Inherit default</option>
                                <option value="deny">Deny</option>
                                <option value="read">Read only</option>
                                <option value="write">Read and write</option>
                              </select>
                            </label>
                          ))}
                      </div>
                    </div>
                  ) : null}
                  <label className="fs-policy-check">
                    <input
                      type="checkbox"
                      checked={shareForm.isReadOnly}
                      onChange={(event) => setShareForm((current) => current ? { ...current, isReadOnly: event.target.checked } : current)}
                    />
                    <span>Mark this share read-only</span>
                  </label>
                  <label className="fs-policy-check">
                    <input
                      type="checkbox"
                      checked={shareForm.isHidden}
                      onChange={(event) => setShareForm((current) => current ? { ...current, isHidden: event.target.checked } : current)}
                    />
                    <span>Hide this share from non-admin users unless explicitly granted</span>
                  </label>
                  <div className="fs-policy-meta">
                    <span>Path: {selectedShare.pathKey}</span>
                    <span>Source: {selectedShare.sourceType}</span>
                  </div>
                  <div className="fs-policy-actions">
                    <button className="ui-button ui-button--primary" type="button" onClick={() => void saveSharePolicy()} disabled={shareBusy}>
                      {shareBusy ? 'Saving…' : 'Save Policy'}
                    </button>
                  </div>
                  {shareStatus ? <p className={`status-message ${shareStatus.includes('saved') ? '' : 'status-message--error'}`}>{shareStatus}</p> : null}
                </div>
              </div>
            ) : null}
          </aside>

          <div className="fs-main">
            <div className="fs-topbar fs-topbar--path">
              <div className="fs-pathbar-shell">
                {isNarrowLayout ? (
                  <button className="ui-button" type="button" onClick={() => setLocationsOpen(true)}>
                    Locations
                  </button>
                ) : null}
                <div className="fs-pathbar" aria-label="Filesystem path">
                  {browser.breadcrumbs.map((crumb, index) => (
                    <button key={`${crumb.label}-${crumb.path}`} className="fs-crumb fs-crumb--path" type="button" onClick={() => void loadDirectory(crumb.path)}>
                      <span>{crumb.label}</span>
                      {index < browser.breadcrumbs.length - 1 ? <span className="fs-crumb__divider">/</span> : null}
                    </button>
                  ))}
                </div>
              </div>
              <div className="fs-topbar__actions">
                <button className="ui-button" type="button" onClick={() => void loadDirectory(parentPath)} disabled={browser.path === ''}>
                  Up
                </button>
                <button className="ui-button" type="button" onClick={() => void loadDirectory(browser.path, { preserveSelection: true })} disabled={browserBusy}>
                  {browserBusy ? 'Refreshing…' : 'Refresh'}
                </button>
              </div>
            </div>

            <div className="fs-topbar fs-topbar--details">
              <div className="fs-titlebar">
                <h2>Visible entries</h2>
                <div className="fs-titlebar__meta">
                  <span>{currentFolderLabel}</span>
                  <span>{directoryCount} folders</span>
                  <span>{fileCount} files</span>
                  <span>{selectedCount} selected</span>
                </div>
              </div>
              <div className="fs-actions fs-actions--rail">
                <input
                  className="ui-input fs-search"
                  type="search"
                  placeholder="Filter current folder"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
                <button className="ui-button" type="button" onClick={createFolder} disabled={browser.path === '' ? !canCreateShare : !canWriteCurrentFolder}>
                  {browser.path === '' ? 'New Share' : 'New Folder'}
                </button>
                <button className="ui-button" type="button" onClick={() => handleUploadTrigger('files')} disabled={uploadBusy || !canWriteCurrentFolder}>
                  {uploadBusy ? 'Uploading…' : 'Upload Files'}
                </button>
                <button className="ui-button" type="button" onClick={() => handleUploadTrigger('folder')} disabled={uploadBusy || !canWriteCurrentFolder}>
                  Upload Folder
                </button>
                <button className="ui-button" type="button" onClick={renameSelected} disabled={!canRenameSelection}>
                  Rename
                </button>
                <button className="ui-button" type="button" onClick={deleteSelected} disabled={!selectionCanEdit}>
                  Delete
                </button>
                <button className="ui-button" type="button" onClick={() => setClipboardFromSelection('copy')} disabled={!selectionCanEdit}>
                  Copy
                </button>
                <button className="ui-button" type="button" onClick={() => setClipboardFromSelection('move')} disabled={!selectionCanEdit}>
                  Cut
                </button>
                <button
                  className="ui-button"
                  type="button"
                  onClick={() => selectedEntries[0] && void openEntry(selectedEntries[0])}
                  disabled={!canOpenSelection}
                >
                  {selectedEntries[0]?.type === 'file' ? 'Download' : 'Open'}
                </button>
                <button className="ui-button" type="button" onClick={clearSelection} disabled={selectedCount === 0}>
                  Clear
                </button>
                <input ref={uploadFilesInputRef} type="file" multiple hidden onChange={(event) => void handleUpload(event, 'files')} />
                <input ref={uploadFolderInputRef} type="file" multiple hidden onChange={(event) => void handleUpload(event, 'folder')} />
              </div>
            </div>

            <div className="fs-meta">
              <span>{rootPathLabel}</span>
              {browser.share ? <span>{browser.share.name} · {browser.share.accessLevel}{browser.share.isReadOnly ? ' · read-only share' : ''}</span> : <span>Shared folders</span>}
              <span>{filteredEntries.length} visible entr{filteredEntries.length === 1 ? 'y' : 'ies'}</span>
            </div>

            {browserError ? <p className="status-message status-message--error">{browserError}</p> : null}

            {recentOperations.length > 0 ? (
              <section className="fs-operations-panel">
                <div className="fs-operations-panel__header">
                  <div>
                    <strong>Operations queue</strong>
                    <span>{activeOperations.length > 0 ? `${activeOperations.length} active` : 'Recent activity'}</span>
                  </div>
                  <button className="ui-button" type="button" onClick={() => void loadFsOperations()}>
                    Refresh Queue
                  </button>
                </div>
                <div className="fs-operations-list">
                  {recentOperations.map((operation) => {
                    const progressLabel = formatOperationProgress(operation);
                    const progressValue = Number.parseInt(progressLabel, 10) || 0;
                    return (
                      <article key={operation.id} className={`fs-operation-card fs-operation-card--${operation.status}`}>
                        <div className="fs-operation-card__topline">
                          <strong>{describeOperation(operation)}</strong>
                          <span>{operation.status}</span>
                        </div>
                        <div className="fs-operation-card__meta">
                          <span>{operation.totalItems > 0 ? `${operation.processedItems}/${operation.totalItems} items` : 'Preparing items'}</span>
                          <span>{operation.totalBytes > 0 ? `${formatBytes(operation.processedBytes)} / ${formatBytes(operation.totalBytes)}` : progressLabel}</span>
                          <span>{formatEntryTime(operation.updatedAt || operation.createdAt)}</span>
                        </div>
                        <div className="fs-operation-progress" aria-hidden="true">
                          <span style={{ width: `${Math.min(100, Math.max(0, progressValue))}%` }} />
                        </div>
                        <p className="fs-operation-card__message">{operation.message || describeOperation(operation)}</p>
                        {operation.failureCount > 0 ? (
                          <p className="status-message status-message--error">
                            {operation.failureCount} failure{operation.failureCount === 1 ? '' : 's'}
                            {operation.failures[0]?.path ? ` · ${operation.failures[0].path}` : ''}
                          </p>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              </section>
            ) : null}

            {clipboard ? (
              <div className="fs-clipboard-card">
                <div className="fs-clipboard-copy">
                  <span>{clipboard.mode === 'move' ? 'Cut' : 'Copy'} queued</span>
                  <strong>{clipboardLabel}</strong>
                  <small>Paste into {currentFolderLabel}</small>
                </div>
                <div className="fs-browser-actions">
                  <button className="ui-button ui-button--primary" type="button" onClick={() => void pasteClipboard()} disabled={!canWriteCurrentFolder}>
                    Paste Here
                  </button>
                  <button className="ui-button" type="button" onClick={() => setClipboard(null)}>
                    Clear
                  </button>
                </div>
              </div>
            ) : null}

            {dropChoice ? (
              <div className="fs-drop-choice">
                <div className="fs-drop-choice__copy">
                  <span>Drop target ready</span>
                  <strong>{dropChoice.sourceSummary}</strong>
                  <small>{dropChoice.targetName}</small>
                </div>
                <div className="fs-browser-actions">
                  <button className="ui-button ui-button--primary" type="button" onClick={() => { void startTransferOperation('move', dropChoice.destinationPath, dropChoice.sourcePaths); setDropChoice(null); }}>
                    Move Here
                  </button>
                  <button className="ui-button" type="button" onClick={() => { void startTransferOperation('copy', dropChoice.destinationPath, dropChoice.sourcePaths); setDropChoice(null); }}>
                    Copy Here
                  </button>
                  <button className="ui-button" type="button" onClick={() => setDropChoice(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}

            <div
              className={`fs-browser-list ${dropTargetPath === browser.path ? 'fs-browser-list--drop' : ''}`}
              onDragLeave={() => handleDropLeave(browser.path)}
              onDragOver={(event) => handleDropHover(event, browser.path, canWriteCurrentFolder)}
              onDrop={(event) => { if (canWriteCurrentFolder) { void handleExternalDrop(event, browser.path); } }}
            >
              <div className="fs-list-head">
                <label className="fs-check fs-check--head">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={(event) => toggleVisibleSelection(visibleEntryPaths, event.target.checked)}
                  />
                  <span>{allVisibleSelected ? 'Unselect visible' : 'Select visible'}</span>
                </label>
                <span>{selectedCount > 0 ? `${selectedCount} selected` : 'No selection'}</span>
              </div>
              {filteredEntries.length === 0 ? (
                <div className="tool-empty fs-empty">
                  {browserBusy ? 'Loading folder…' : 'This folder is empty.'}
                </div>
              ) : (
                filteredEntries.map((entry) => {
                  const isDirectory = entry.type === 'directory' || entry.type === 'symlink';
                  const isSelected = selectedPath === entry.path || selectedPaths.includes(entry.path);
                  const canDropIntoEntry = isDirectory && entry.editable;

                  return (
                    <article
                      key={entry.path}
                      className={`fs-browser-item ${isSelected ? 'fs-browser-item--selected' : ''} ${dropTargetPath === entry.path ? 'fs-browser-item--drop-target' : ''}`}
                      draggable={entry.editable && browser.path !== ''}
                      onDragLeave={() => handleDropLeave(entry.path)}
                      onDragOver={(event) => handleDropHover(event, entry.path, canDropIntoEntry)}
                      onDragStart={(event) => handleRowDragStart(event, entry)}
                      onDrop={(event) => { if (canDropIntoEntry) { void handleExternalDrop(event, entry.path); } }}
                    >
                      <label className="fs-check" onClick={(event) => event.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedPaths.includes(entry.path)}
                          onChange={(event) => toggleSelection(entry.path, event.target.checked)}
                        />
                      </label>

                      <button className="fs-browser-main" type="button" onClick={() => void openEntry(entry)}>
                        <span className={`fs-entry-icon fs-entry-icon--${isDirectory ? 'directory' : 'file'} fs-entry-icon--tile`} aria-hidden="true" />
                        <span className="fs-browser-copy">
                          <strong>{entry.name}</strong>
                          <span>{isDirectory ? 'Folder' : 'File'} · {formatEntryTime(entry.modifiedAt)}</span>
                        </span>
                      </button>

                      <div className="fs-browser-meta">
                        <span>{isDirectory ? '—' : formatBytes(entry.size)}</span>
                        <span>{browser.path === '' ? `${entry.shareSourceType || 'share'} · ${entry.accessLevel || 'read'}` : entry.editable ? 'editable' : 'protected'}</span>
                      </div>

                      <div className="fs-browser-actions">
                        <button className="ui-button" type="button" onClick={() => void openEntry(entry)}>
                          {isDirectory ? 'Open' : 'Download'}
                        </button>
                        <div className="fs-row-menu">
                          <MenuButton
                            aria-controls={menuState?.path === entry.path ? `fs-row-menu-${entry.path}` : undefined}
                            className="ui-button fs-row-menu__trigger"
                            disabled={browserBusy}
                            label={`Open actions for ${entry.name}`}
                            open={menuState?.path === entry.path}
                            ref={(node) => {
                              menuTriggerRefs.current[entry.path] = node;
                            }}
                            onClick={(event) => {
                              event.stopPropagation();
                              openFsMenu(entry);
                            }}
                          />
                          {menuState?.path === entry.path && !isPhoneLayout ? (
                            <div id={`fs-row-menu-${entry.path}`} className={`fs-row-menu__panel ${menuState.upward ? 'fs-row-menu__panel--upward' : ''}`}>
                              <button className="ui-button fs-row-menu__item" type="button" onClick={() => { setSelectionOnly(entry.path); setMenuState(null); }}>
                                Select only
                              </button>
                              <button className="ui-button fs-row-menu__item" type="button" onClick={() => { setClipboardFromEntries([entry], 'copy'); setMenuState(null); }} disabled={!entry.editable}>
                                Copy
                              </button>
                              <button className="ui-button fs-row-menu__item" type="button" onClick={() => { setClipboardFromEntries([entry], 'move'); setMenuState(null); }} disabled={!entry.editable}>
                                Cut
                              </button>
                              <button className="ui-button fs-row-menu__item" type="button" onClick={() => { setSelectedPath(entry.path); setSelectedPaths([entry.path]); setMenuState(null); void renameEntry(entry); }} disabled={!entry.editable}>
                                Rename
                              </button>
                              <button className="ui-button fs-row-menu__item" type="button" onClick={() => { setSelectedPath(entry.path); setSelectedPaths([entry.path]); setMenuState(null); void deleteEntries([entry]); }} disabled={!entry.editable}>
                                Delete
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                      {dropChoice?.destinationPath === entry.path ? (
                        <div className="fs-row-drop-choice">
                          <span>{dropChoice.sourceSummary}</span>
                          <div className="fs-browser-actions">
                            <button className="ui-button ui-button--primary" type="button" onClick={() => { void startTransferOperation('move', dropChoice.destinationPath, dropChoice.sourcePaths); setDropChoice(null); }}>
                              Move Here
                            </button>
                            <button className="ui-button" type="button" onClick={() => { void startTransferOperation('copy', dropChoice.destinationPath, dropChoice.sourcePaths); setDropChoice(null); }}>
                              Copy Here
                            </button>
                            <button className="ui-button" type="button" onClick={() => setDropChoice(null)}>
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </article>
                  );
                })
              )}
            </div>
          </div>
        </section>
      </section>

      <DialogSurface
        open={Boolean(menuState && isPhoneLayout)}
        onClose={() => setMenuState(null)}
        overlayClassName="fs-mobile-sheet"
        overlayStyle={{ background: 'rgba(0, 0, 0, 0.44)' }}
        panelClassName="fs-mobile-sheet__panel"
        labelledBy="fs-mobile-sheet-title"
      >
        <div className="fs-mobile-sheet__header">
          <strong id="fs-mobile-sheet-title">{browser.entries.find((entry) => entry.path === menuState?.path)?.name || 'Actions'}</strong>
          <button className="ui-button" type="button" onClick={() => setMenuState(null)}>
            Close
          </button>
        </div>
        <div className="fs-mobile-sheet__actions">
          <button className="ui-button" type="button" onClick={() => { if (menuState) { setSelectionOnly(menuState.path); } setMenuState(null); }}>
            Select only
          </button>
          <button
            className="ui-button"
            type="button"
            onClick={() => {
              const entry = menuState ? browser.entries.find((item) => item.path === menuState.path) : null;
              if (entry) {
                setClipboardFromEntries([entry], 'copy');
              }
              setMenuState(null);
            }}
          >
            Copy
          </button>
          <button
            className="ui-button"
            type="button"
            onClick={() => {
              const entry = menuState ? browser.entries.find((item) => item.path === menuState.path) : null;
              if (entry) {
                setClipboardFromEntries([entry], 'move');
              }
              setMenuState(null);
            }}
          >
            Cut
          </button>
          <button
            className="ui-button"
            type="button"
            onClick={() => {
              const entry = menuState ? browser.entries.find((item) => item.path === menuState.path) || null : null;
              if (menuState) {
                setSelectedPath(menuState.path);
                setSelectedPaths([menuState.path]);
              }
              setMenuState(null);
              void renameEntry(entry);
            }}
          >
            Rename
          </button>
          <button
            className="ui-button"
            type="button"
            onClick={() => {
              const entry = menuState ? browser.entries.find((item) => item.path === menuState.path) || null : null;
              if (menuState) {
                setSelectedPath(menuState.path);
                setSelectedPaths([menuState.path]);
              }
              setMenuState(null);
              void deleteEntries(entry ? [entry] : []);
            }}
          >
            Delete
          </button>
        </div>
      </DialogSurface>
    </ToolPage>
  );
}
