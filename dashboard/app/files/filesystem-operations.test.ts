import { describe, expect, it, vi } from 'vitest';
import {
  collectDirectoryPickerUploadFiles,
  collectDroppedUploadFiles,
  collectInputUploadFiles,
  dedupeUploadFiles,
  isFsOperationActive,
  normalizeFsOperation,
  runFsUploadSequence,
} from './filesystem-operations';

describe('filesystem-operations helpers', () => {
  it('normalizes operation payloads and statuses', () => {
    const normalized = normalizeFsOperation({
      id: 123 as unknown as string,
      kind: 'unknown' as unknown as 'copy',
      status: 'standby',
      manifest: [
        {
          relativePath: '../unsafe/path',
          size: -1,
          lastModified: -1,
        },
      ],
      failures: [{ error: '', path: 1 as unknown as string }],
      conflict: {
        reason: 'exists',
        sourcePath: '../share/file.mkv',
        sourceType: 'file',
        targetPath: '/share/file.mkv',
        targetType: 'file',
        sizeRelation: 'different',
        sourceSize: 10,
        targetSize: 9,
      },
    });

    expect(normalized.id).toBe('123');
    expect(normalized.kind).toBe('copy');
    expect(normalized.status).toBe('standby');
    expect(normalized.manifest?.[0]).toEqual({
      relativePath: 'unsafe/path',
      size: 0,
      lastModified: 0,
    });
    expect(normalized.failures[0]).toEqual({
      error: 'Operation failed',
      path: '1',
    });
    expect(normalized.conflict?.sourcePath).toBe('share/file.mkv');
    expect(normalized.conflict?.sizeRelation).toBe('different');
    expect(isFsOperationActive(normalized)).toBe(true);
  });

  it('dedupes uploads by relativePath', () => {
    const fileA = new File(['a'], 'a.txt', { lastModified: 1 });
    const fileB = new File(['b'], 'a.txt', { lastModified: 2 });
    const deduped = dedupeUploadFiles([
      { file: fileA, relativePath: 'a.txt', size: 1, lastModified: 1 },
      { file: fileB, relativePath: 'a.txt', size: 2, lastModified: 2 },
    ]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].file).toBe(fileB);
  });

  it('collects files from input list', () => {
    const file = new File(['x'], 'x.txt', { lastModified: 5 });
    const files = collectInputUploadFiles([file], 'files');
    expect(files).toHaveLength(1);
    expect(files[0].relativePath).toBe('x.txt');
  });

  it('collects nested files from showDirectoryPicker', async () => {
    const topFile = new File(['top'], 'notes.txt', { lastModified: 2 });
    const nestedFile = new File(['nested'], 'movie.mkv', { lastModified: 3 });
    const makeFileHandle = (file: File) => ({
      kind: 'file' as const,
      getFile: async () => file,
    });
    const makeDirectoryHandle = (
      entries: Array<[string, { kind: 'file' | 'directory'; getFile?: () => Promise<File>; entries?: () => AsyncIterable<[string, unknown]> }]>
    ) => ({
      kind: 'directory' as const,
      entries: async function* () {
        for (const entry of entries) {
          yield entry;
        }
      },
    });

    const rootDirectory = makeDirectoryHandle([
      ['notes.txt', makeFileHandle(topFile)],
      ['movies', makeDirectoryHandle([
        ['movie.mkv', makeFileHandle(nestedFile)],
      ])],
    ]);

    const win = window as Window & typeof globalThis & { showDirectoryPicker?: () => Promise<unknown> };
    const previous = win.showDirectoryPicker;
    win.showDirectoryPicker = async () => rootDirectory;
    try {
      const files = await collectDirectoryPickerUploadFiles();
      expect(files.map((entry) => entry.relativePath).sort()).toEqual(['movies/movie.mkv', 'notes.txt']);
    } finally {
      win.showDirectoryPicker = previous;
    }
  });

  it('collects dropped files via File System Access handles', async () => {
    const dropped = new File(['drop'], 'sample.txt', { lastModified: 7 });
    const fileHandle = {
      kind: 'file' as const,
      getFile: async () => dropped,
    };
    const item = {
      kind: 'file',
      getAsFileSystemHandle: async () => fileHandle,
      getAsFile: () => null,
    } as unknown as DataTransferItem;
    const dataTransfer = {
      items: [item],
      files: [] as unknown as FileList,
    } as unknown as DataTransfer;

    const files = await collectDroppedUploadFiles(dataTransfer);
    expect(files).toHaveLength(1);
    expect(files[0].relativePath).toBe('sample.txt');
  });

  it('runs upload sequence and skips files already uploaded by the operation', async () => {
    const fileA = new File(['a'], 'a.txt', { lastModified: 1 });
    const fileB = new File(['b'], 'b.txt', { lastModified: 2 });
    const createFsOperation = vi.fn(async () => normalizeFsOperation({
      id: 'op-1',
      kind: 'upload',
      status: 'receiving',
      processedBytes: 1,
      processedItems: 1,
      totalBytes: 3,
      totalItems: 2,
      uploadedFiles: ['a.txt'],
    }));
    const uploadFileToOperation = vi.fn(async (operation, _file, uploadedBytesBeforeFile) => normalizeFsOperation({
      ...operation,
      processedBytes: uploadedBytesBeforeFile + 2,
      processedItems: 2,
      uploadedFiles: ['a.txt', 'b.txt'],
    }));
    const finalizeFsOperation = vi.fn(async () => undefined);

    await runFsUploadSequence(
      '/Shared',
      [
        { file: fileA, lastModified: 1, relativePath: 'a.txt', size: 1 },
        { file: fileB, lastModified: 2, relativePath: 'b.txt', size: 2 },
      ],
      {
        createFsOperation,
        finalizeFsOperation,
        uploadFileToOperation,
      }
    );

    expect(createFsOperation).toHaveBeenCalledTimes(1);
    expect(uploadFileToOperation).toHaveBeenCalledTimes(1);
    expect(uploadFileToOperation.mock.calls[0][1].relativePath).toBe('b.txt');
    expect(finalizeFsOperation).toHaveBeenCalledWith('op-1');
  });

  it('cancels the created upload operation when a file upload fails', async () => {
    const fileA = new File(['a'], 'a.txt', { lastModified: 1 });
    const createFsOperation = vi.fn(async () => normalizeFsOperation({
      id: 'op-cancel',
      kind: 'upload',
      status: 'receiving',
    }));
    const uploadFileToOperation = vi.fn(async () => {
      throw new Error('Upload failed');
    });
    const finalizeFsOperation = vi.fn(async () => undefined);
    const cancelFsOperation = vi.fn(async () => undefined);

    await expect(runFsUploadSequence(
      '/Shared',
      [{ file: fileA, lastModified: 1, relativePath: 'a.txt', size: 1 }],
      {
        cancelFsOperation,
        createFsOperation,
        finalizeFsOperation,
        uploadFileToOperation,
      }
    )).rejects.toThrow('Upload failed');

    expect(cancelFsOperation).toHaveBeenCalledWith('op-cancel');
    expect(finalizeFsOperation).not.toHaveBeenCalled();
  });

  it('does not auto-cancel when finalize fails', async () => {
    const fileA = new File(['a'], 'a.txt', { lastModified: 1 });
    const createFsOperation = vi.fn(async () => normalizeFsOperation({
      id: 'op-finalize',
      kind: 'upload',
      status: 'receiving',
      uploadedFiles: [],
    }));
    const uploadFileToOperation = vi.fn(async (operation) => normalizeFsOperation({
      ...operation,
      uploadedFiles: ['a.txt'],
    }));
    const finalizeFsOperation = vi.fn(async () => {
      throw new Error('Finalize failed');
    });
    const cancelFsOperation = vi.fn(async () => undefined);

    await expect(runFsUploadSequence(
      '/Shared',
      [{ file: fileA, lastModified: 1, relativePath: 'a.txt', size: 1 }],
      {
        cancelFsOperation,
        createFsOperation,
        finalizeFsOperation,
        uploadFileToOperation,
      }
    )).rejects.toThrow('Finalize failed');

    expect(cancelFsOperation).not.toHaveBeenCalled();
    expect(finalizeFsOperation).toHaveBeenCalledWith('op-finalize');
  });
});
