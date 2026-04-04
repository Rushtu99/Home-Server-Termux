import { describe, expect, it } from 'vitest';
import {
  collectInputUploadFiles,
  dedupeUploadFiles,
  isFsOperationActive,
  normalizeFsOperation,
} from './filesystem-operations';

describe('filesystem-operations helpers', () => {
  it('normalizes operation payloads and statuses', () => {
    const normalized = normalizeFsOperation({
      id: 123 as unknown as string,
      kind: 'unknown' as unknown as 'copy',
      status: 'queued',
      manifest: [
        {
          relativePath: '../unsafe/path',
          size: -1,
          lastModified: -1,
        },
      ],
      failures: [{ error: '', path: 1 as unknown as string }],
    });

    expect(normalized.id).toBe('123');
    expect(normalized.kind).toBe('copy');
    expect(normalized.status).toBe('queued');
    expect(normalized.manifest?.[0]).toEqual({
      relativePath: 'unsafe/path',
      size: 0,
      lastModified: 0,
    });
    expect(normalized.failures[0]).toEqual({
      error: 'Operation failed',
      path: '1',
    });
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
});
