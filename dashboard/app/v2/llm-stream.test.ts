import { describe, expect, it, vi } from 'vitest';
import { dispatchLlmStreamEvent, parseSseChunk } from './llm-stream';

describe('llm-stream helpers', () => {
  it('parses SSE chunks', () => {
    expect(parseSseChunk('event: delta\ndata: {\"seq\":1,\"text\":\"a\"}\n')).toEqual({
      event: 'delta',
      data: '{"seq":1,"text":"a"}',
    });
  });

  it('dispatches meta/delta/done/error events', () => {
    const onMeta = vi.fn();
    const onDelta = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();
    const handlers = { onMeta, onDelta, onDone, onError };

    expect(dispatchLlmStreamEvent({ event: 'meta', data: '{"conversationId":7,"mode":"online","modelId":"x","startedAt":"t"}' }, handlers)).toBe(false);
    expect(dispatchLlmStreamEvent({ event: 'delta', data: '{"seq":2,"text":"hello"}' }, handlers)).toBe(false);
    expect(dispatchLlmStreamEvent({ event: 'done', data: '{"conversationId":7,"assistantMessage":{"id":1,"content":"ok","createdAt":"c","modelId":"m"}}' }, handlers)).toBe(true);
    expect(dispatchLlmStreamEvent({ event: 'error', data: '{"code":"upstream_error","message":"bad"}' }, handlers)).toBe(true);

    expect(onMeta).toHaveBeenCalledTimes(1);
    expect(onDelta).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
