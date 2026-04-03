'use client';

export type FsOperationStatus = 'queued' | 'receiving' | 'running' | 'cancelling' | 'success' | 'partial' | 'failed' | 'cancelled';
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
    ? payload.status
    : 'failed',
  totalBytes: Math.max(0, Number(payload?.totalBytes || 0) || 0),
  totalItems: Math.max(0, Number(payload?.totalItems || 0) || 0),
  updatedAt: String(payload?.updatedAt || ''),
  uploadedFiles: Array.isArray(payload?.uploadedFiles)
    ? payload.uploadedFiles.map((entry) => normalizeRelativePath(entry || '')).filter(Boolean)
    : [],
});

export const isFsOperationActive = (operation: FsOperation) =>
  operation.status === 'queued' || operation.status === 'receiving' || operation.status === 'running' || operation.status === 'cancelling';

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
