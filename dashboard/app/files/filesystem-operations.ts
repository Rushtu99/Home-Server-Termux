'use client';

export type FsOperationStatus = 'queued' | 'receiving' | 'running' | 'standby' | 'cancelling' | 'success' | 'partial' | 'failed' | 'cancelled';
export type FsOperationKind = 'upload' | 'copy' | 'move' | 'delete';

export type FsOperationFailure = {
  error: string;
  path: string;
};

export type FsOperation = {
  createdAt: string;
  destinationPath: string;
  failureCount: number;
  failures: FsOperationFailure[];
  id: string;
  kind: FsOperationKind;
  manifest?: FsUploadManifestEntry[];
  message: string;
  processedBytes: number;
  processedItems: number;
  sourcePaths: string[];
  status: FsOperationStatus;
  totalBytes: number;
  totalItems: number;
  updatedAt: string;
  uploadedFiles?: string[];
  conflict?: {
    reason: string;
    sourcePath: string;
    sourceSize: number | null;
    sourceType: string;
    targetPath: string;
    targetSize: number | null;
    targetType: string;
    sizeRelation: 'same' | 'different' | 'unknown';
  } | null;
  conflictPolicy?: {
    replaceAllDifferentSize: boolean;
    skipAllSameSize: boolean;
  };
};

export type FsUploadManifestEntry = {
  lastModified: number;
  relativePath: string;
  size: number;
};

export type FsUploadFile = FsUploadManifestEntry & {
  file: File;
};

type FileSystemEntryLike = {
  createReader?: () => FileSystemDirectoryReaderLike;
  file?: (success: (file: File) => void, failure?: (error: Error) => void) => void;
  isDirectory?: boolean;
  isFile?: boolean;
  name?: string;
};

type FileSystemDirectoryReaderLike = {
  readEntries: (
    success: (entries: FileSystemEntryLike[]) => void,
    failure?: (error: Error) => void
  ) => void;
};

type FileSystemHandleLike = {
  kind?: 'file' | 'directory';
  name?: string;
};

type FileSystemFileHandleLike = FileSystemHandleLike & {
  getFile?: () => Promise<File>;
};

type FileSystemDirectoryHandleLike = FileSystemHandleLike & {
  entries?: () => AsyncIterable<[string, FileSystemHandleLike]>;
};

type DirectoryPickerWindow = Window & typeof globalThis & {
  showDirectoryPicker?: () => Promise<FileSystemDirectoryHandleLike>;
};

type FileSystemHandleDataTransferItemLike = DataTransferItem & {
  getAsFileSystemHandle?: () => Promise<FileSystemHandleLike | null>;
};

const normalizeRelativePath = (value = '') =>
  String(value || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment && segment !== '.' && segment !== '..')
    .join('/');

export const normalizeFsOperation = (payload: Partial<FsOperation> | null | undefined): FsOperation => ({
  createdAt: String(payload?.createdAt || ''),
  destinationPath: String(payload?.destinationPath || ''),
  failureCount: Math.max(0, Number(payload?.failureCount || 0) || 0),
  failures: Array.isArray(payload?.failures)
    ? payload.failures.map((entry) => ({
        error: String(entry?.error || 'Operation failed'),
        path: String(entry?.path || ''),
      }))
    : [],
  id: String(payload?.id || ''),
  kind: payload?.kind === 'move' || payload?.kind === 'delete' || payload?.kind === 'upload' ? payload.kind : 'copy',
  manifest: Array.isArray(payload?.manifest)
    ? payload.manifest.map((entry) => ({
        lastModified: Math.max(0, Number(entry?.lastModified || 0) || 0),
        relativePath: normalizeRelativePath(entry?.relativePath || ''),
        size: Math.max(0, Number(entry?.size || 0) || 0),
      })).filter((entry) => entry.relativePath)
    : [],
  message: String(payload?.message || ''),
  processedBytes: Math.max(0, Number(payload?.processedBytes || 0) || 0),
  processedItems: Math.max(0, Number(payload?.processedItems || 0) || 0),
  sourcePaths: Array.isArray(payload?.sourcePaths) ? payload.sourcePaths.map((entry) => String(entry || '')).filter(Boolean) : [],
  status: payload?.status === 'queued' || payload?.status === 'receiving' || payload?.status === 'running' || payload?.status === 'cancelling' || payload?.status === 'success' || payload?.status === 'partial' || payload?.status === 'cancelled'
    || payload?.status === 'standby'
    ? payload.status
    : 'failed',
  totalBytes: Math.max(0, Number(payload?.totalBytes || 0) || 0),
  totalItems: Math.max(0, Number(payload?.totalItems || 0) || 0),
  updatedAt: String(payload?.updatedAt || ''),
  uploadedFiles: Array.isArray(payload?.uploadedFiles)
    ? payload.uploadedFiles.map((entry) => normalizeRelativePath(entry || '')).filter(Boolean)
    : [],
  conflict: payload?.conflict && typeof payload.conflict === 'object'
    ? {
        reason: String(payload.conflict.reason || 'exists'),
        sourcePath: normalizeRelativePath(payload.conflict.sourcePath || ''),
        sourceSize: Number.isFinite(Number(payload.conflict.sourceSize)) ? Number(payload.conflict.sourceSize) : null,
        sourceType: String(payload.conflict.sourceType || ''),
        targetPath: normalizeRelativePath(payload.conflict.targetPath || ''),
        targetSize: Number.isFinite(Number(payload.conflict.targetSize)) ? Number(payload.conflict.targetSize) : null,
        targetType: String(payload.conflict.targetType || ''),
        sizeRelation: payload.conflict.sizeRelation === 'same' || payload.conflict.sizeRelation === 'different' ? payload.conflict.sizeRelation : 'unknown',
      }
    : null,
  conflictPolicy: {
    replaceAllDifferentSize: Boolean(payload?.conflictPolicy?.replaceAllDifferentSize),
    skipAllSameSize: Boolean(payload?.conflictPolicy?.skipAllSameSize),
  },
});

export const isFsOperationActive = (operation: FsOperation) =>
  operation.status === 'queued' || operation.status === 'receiving' || operation.status === 'running' || operation.status === 'standby' || operation.status === 'cancelling';

const fileFromEntry = (entry: FileSystemEntryLike) => new Promise<File>((resolve, reject) => {
  if (!entry.file) {
    reject(new Error('File entry is not readable'));
    return;
  }
  entry.file(resolve, reject);
});

const readDirectoryEntries = (reader: FileSystemDirectoryReaderLike) => new Promise<FileSystemEntryLike[]>((resolve, reject) => {
  reader.readEntries(resolve, reject);
});

const readAllDirectoryEntries = async (reader: FileSystemDirectoryReaderLike) => {
  const entries: FileSystemEntryLike[] = [];
  while (true) {
    const chunk = await readDirectoryEntries(reader);
    if (chunk.length === 0) {
      break;
    }
    entries.push(...chunk);
  }
  return entries;
};

const collectEntryFiles = async (entry: FileSystemEntryLike, prefix = ''): Promise<FsUploadFile[]> => {
  const entryName = String(entry?.name || '').trim();
  const nextPrefix = normalizeRelativePath(prefix ? `${prefix}/${entryName}` : entryName);

  if (entry.isFile) {
    const file = await fileFromEntry(entry);
    const relativePath = normalizeRelativePath(prefix ? `${prefix}/${file.name}` : file.name);
    return relativePath ? [{
      file,
      lastModified: Math.max(0, Number(file.lastModified || 0) || 0),
      relativePath,
      size: Math.max(0, Number(file.size || 0) || 0),
    }] : [];
  }

  if (entry.isDirectory && entry.createReader) {
    const childEntries = await readAllDirectoryEntries(entry.createReader());
    const files = await Promise.all(childEntries.map((child) => collectEntryFiles(child, nextPrefix)));
    return files.flat();
  }

  return [];
};

const collectFileHandle = async (handle: FileSystemFileHandleLike, prefix = ''): Promise<FsUploadFile[]> => {
  if (!handle?.getFile) {
    return [];
  }
  const file = await handle.getFile();
  const relativePath = normalizeRelativePath(prefix ? `${prefix}/${file.name}` : file.name);
  if (!relativePath) {
    return [];
  }
  return [{
    file,
    lastModified: Math.max(0, Number(file.lastModified || 0) || 0),
    relativePath,
    size: Math.max(0, Number(file.size || 0) || 0),
  }];
};

const collectDirectoryHandleFiles = async (
  handle: FileSystemDirectoryHandleLike,
  prefix = ''
): Promise<FsUploadFile[]> => {
  if (!handle?.entries) {
    return [];
  }
  const files: FsUploadFile[] = [];
  for await (const [name, childHandle] of handle.entries()) {
    const nextPrefix = normalizeRelativePath(prefix ? `${prefix}/${name}` : name);
    if (childHandle?.kind === 'directory') {
      files.push(...(await collectDirectoryHandleFiles(childHandle as FileSystemDirectoryHandleLike, nextPrefix)));
      continue;
    }
    if (childHandle?.kind === 'file') {
      files.push(...(await collectFileHandle(childHandle as FileSystemFileHandleLike, prefix)));
    }
  }
  return files;
};

export const collectDirectoryPickerUploadFiles = async (): Promise<FsUploadFile[]> => {
  if (typeof window === 'undefined') {
    return [];
  }
  const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
  if (typeof picker !== 'function') {
    return [];
  }
  const directoryHandle = await picker();
  const files = await collectDirectoryHandleFiles(directoryHandle);
  return dedupeUploadFiles(files);
};

export const collectInputUploadFiles = (
  fileList: FileList | File[] | null | undefined,
  mode: 'files' | 'folder'
): FsUploadFile[] => {
  const files = Array.from(fileList || []);
  const mapped = files.map((file) => {
    const withRelative = file as File & { webkitRelativePath?: string };
    const relativePath = normalizeRelativePath(
      mode === 'folder' ? withRelative.webkitRelativePath || file.name : file.name
    );
    return relativePath ? {
      file,
      lastModified: Math.max(0, Number(file.lastModified || 0) || 0),
      relativePath,
      size: Math.max(0, Number(file.size || 0) || 0),
    } : null;
  }).filter((entry): entry is FsUploadFile => Boolean(entry));

  return dedupeUploadFiles(mapped);
};

export const collectDroppedUploadFiles = async (dataTransfer: DataTransfer): Promise<FsUploadFile[]> => {
  const items = Array.from(dataTransfer.items || []);
  const entryFiles = await Promise.all(items.map(async (item) => {
    const getFileSystemHandle = (item as FileSystemHandleDataTransferItemLike).getAsFileSystemHandle;
    if (typeof getFileSystemHandle === 'function') {
      const handle = await getFileSystemHandle.call(item);
      if (handle?.kind === 'directory') {
        return collectDirectoryHandleFiles(handle as FileSystemDirectoryHandleLike);
      }
      if (handle?.kind === 'file') {
        return collectFileHandle(handle as FileSystemFileHandleLike);
      }
    }

    const getEntry = (item as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntryLike | null }).webkitGetAsEntry;
    if (typeof getEntry === 'function') {
      const entry = getEntry.call(item);
      if (entry) {
        return collectEntryFiles(entry);
      }
    }

    const file = item.getAsFile();
    if (!file) {
      return [];
    }
    return collectInputUploadFiles([file], 'files');
  }));

  const flattened = entryFiles.flat();
  if (flattened.length > 0) {
    return dedupeUploadFiles(flattened);
  }
  return collectInputUploadFiles(dataTransfer.files, 'files');
};

export const dedupeUploadFiles = (files: FsUploadFile[]): FsUploadFile[] => {
  const byPath = new Map<string, FsUploadFile>();
  files.forEach((entry) => {
    byPath.set(entry.relativePath, entry);
  });
  return [...byPath.values()];
};

type FsUploadSequenceDeps = {
  cancelFsOperation?: (operationId: string) => Promise<void>;
  createFsOperation: (endpoint: string, payload: Record<string, unknown>) => Promise<FsOperation>;
  finalizeFsOperation: (operationId: string) => Promise<void>;
  uploadFileToOperation: (operation: FsOperation, fileEntry: FsUploadFile, uploadedBytesBeforeFile: number) => Promise<FsOperation>;
};

export const runFsUploadSequence = async (
  destinationPath: string,
  files: FsUploadFile[],
  deps: FsUploadSequenceDeps
) => {
  const uploadFiles = dedupeUploadFiles(files);
  if (uploadFiles.length === 0) {
    return;
  }

  let operation: FsOperation | null = null;
  try {
    operation = await deps.createFsOperation('/fs/operations/upload', {
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
      operation = await deps.uploadFileToOperation(operation, fileEntry, uploadedBytes);
      uploadedBytes += fileEntry.size;
    }
  } catch (error) {
    if (deps.cancelFsOperation && operation?.id) {
      try {
        await deps.cancelFsOperation(operation.id);
      } catch {
        // best effort cleanup on partial upload failures
      }
    }
    throw error;
  }

  if (!operation) {
    return;
  }

  await deps.finalizeFsOperation(operation.id);
};
