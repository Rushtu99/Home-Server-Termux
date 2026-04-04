export type LlmChatStreamHandlers = {
  onMeta: (payload: { conversationId: number; mode: 'local' | 'online'; modelId: string; startedAt: string }) => void;
  onDelta: (payload: { seq: number; text: string }) => void;
  onDone: (payload: {
    conversationId: number;
    assistantMessage: {
      id: number;
      role: 'assistant';
      content: string;
      createdAt: string;
      modelId: string;
    };
  }) => void;
  onError: (payload: { code: string; message: string }) => void;
};

export const parseSseChunk = (chunk: string) => {
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of chunk.split('\n')) {
    if (!line || line.startsWith(':')) {
      continue;
    }
    if (line.startsWith('event:')) {
      event = line.slice(6).trim() || 'message';
      continue;
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }
  return {
    data: dataLines.join('\n'),
    event,
  };
};

export const dispatchLlmStreamEvent = (
  parsed: { event: string; data: string },
  handlers: LlmChatStreamHandlers
): boolean => {
  if (!parsed.data) {
    return false;
  }

  const json = JSON.parse(parsed.data) as Record<string, unknown>;

  if (parsed.event === 'meta') {
    handlers.onMeta({
      conversationId: Number(json.conversationId || 0),
      mode: String(json.mode || 'local') === 'online' ? 'online' : 'local',
      modelId: String(json.modelId || ''),
      startedAt: String(json.startedAt || ''),
    });
    return false;
  }

  if (parsed.event === 'delta') {
    handlers.onDelta({
      seq: Number(json.seq || 0),
      text: String(json.text || ''),
    });
    return false;
  }

  if (parsed.event === 'done') {
    handlers.onDone({
      conversationId: Number(json.conversationId || 0),
      assistantMessage: {
        id: Number((json.assistantMessage as Record<string, unknown> | undefined)?.id || 0),
        role: 'assistant',
        content: String((json.assistantMessage as Record<string, unknown> | undefined)?.content || ''),
        createdAt: String((json.assistantMessage as Record<string, unknown> | undefined)?.createdAt || ''),
        modelId: String((json.assistantMessage as Record<string, unknown> | undefined)?.modelId || ''),
      },
    });
    return true;
  }

  if (parsed.event === 'error') {
    handlers.onError({
      code: String(json.code || 'upstream_error'),
      message: String(json.message || 'Stream failed'),
    });
    return true;
  }

  return false;
};
