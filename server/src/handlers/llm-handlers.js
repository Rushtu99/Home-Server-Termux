const buildLlmHandlers = ({
  appDb,
  fs,
  path,
  crypto,
  services,
  checkService,
  buildLlmState,
  sanitizeModelId,
  findModelById,
  setActiveModel,
  getCustomLlmModels,
  saveCustomLlmModels,
  startLlmPullJob,
  readLlmPullJob,
  fetchOnlineModels,
  setOnlineModelPreference,
  onlineModelCacheTtlMs,
  setOnlineModelCache,
  extractUpstreamErrorText,
  toClientFacingUpstreamError,
  llmChatSystemPrompt,
  llmMaxTokens,
  llmTemperature,
  callOnlineChatCompletion,
  callLlmChatCompletion,
  Readable,
  controlPlane,
}) => {
  const llmStateHandler = async (req, res) => {
    try {
      const payload = await buildLlmState();
      res.json(payload);
    } catch (err) {
      res.status(500).json({ error: String(err || 'Unable to load LLM state') });
    }
  };

  const llmModelSelectHandler = async (req, res) => {
    const modelId = sanitizeModelId(req.body?.modelId);
    if (!modelId) {
      return res.status(400).json({ error: 'modelId is required' });
    }
    const model = findModelById(modelId);
    if (!model) {
      return res.status(404).json({ error: 'Model not found' });
    }
    if (!model.installed || !fs.existsSync(model.path)) {
      return res.status(409).json({ error: 'Model is not installed locally' });
    }
    setActiveModel({ modelId: model.id, modelPath: model.path });
    const running = await checkService(services.llm).catch(() => false);
    return res.json({
      success: true,
      model,
      restartRequired: running,
    });
  };

  const llmModelAddLocalHandler = (req, res) => {
    const label = String(req.body?.label || '').trim();
    const modelPath = String(req.body?.path || '').trim();
    if (!modelPath) {
      return res.status(400).json({ error: 'path is required' });
    }
    if (!path.isAbsolute(modelPath)) {
      return res.status(400).json({ error: 'path must be absolute' });
    }
    if (!fs.existsSync(modelPath) || !fs.statSync(modelPath).isFile()) {
      return res.status(400).json({ error: 'path must point to an existing file' });
    }
    if (!modelPath.toLowerCase().endsWith('.gguf')) {
      return res.status(400).json({ error: 'path must point to a .gguf model file' });
    }

    const modelId = sanitizeModelId(`local-${label || path.basename(modelPath, '.gguf')}-${crypto.randomUUID().slice(0, 6)}`);
    const current = getCustomLlmModels();
    current.push({
      id: modelId,
      label: label || path.basename(modelPath, '.gguf'),
      path: modelPath,
    });
    saveCustomLlmModels(current);
    return res.json({
      success: true,
      model: findModelById(modelId),
    });
  };

  const llmModelPullHandler = (req, res) => {
    const modelId = sanitizeModelId(req.body?.modelId);
    if (!modelId) {
      return res.status(400).json({ error: 'modelId is required' });
    }
    const model = findModelById(modelId);
    if (!model || model.source !== 'preset') {
      return res.status(404).json({ error: 'Preset model not found' });
    }
    if (model.installed && fs.existsSync(model.path)) {
      return res.json({ success: true, alreadyInstalled: true, model });
    }
    try {
      const job = startLlmPullJob(model);
      return res.json({
        success: true,
        jobId: job.id,
        modelId: model.id,
      });
    } catch (err) {
      return res.status(500).json({ error: String(err || 'Unable to start pull job') });
    }
  };

  const llmModelPullStatusHandler = (req, res) => {
    const job = readLlmPullJob(req.params.jobId || '');
    if (!job) {
      return res.status(404).json({ error: 'Pull job not found' });
    }
    return res.json(job);
  };

  const llmOnlineModelsRefreshHandler = async (req, res) => {
    try {
      const online = await fetchOnlineModels({ force: true });
      return res.json({ success: true, online });
    } catch (err) {
      return res.status(500).json({ error: String(err || 'Unable to refresh online models') });
    }
  };

  const llmOnlineModelSelectHandler = async (req, res) => {
    const modelId = String(req.body?.modelId || '').trim();
    if (!modelId) {
      return res.status(400).json({ error: 'modelId is required' });
    }
    const online = await fetchOnlineModels({ force: true });
    if (!online.configured) {
      return res.status(409).json({ error: 'Online provider is not configured.' });
    }
    if (!online.available) {
      return res.status(409).json({ error: online.error || 'Online provider is unavailable.' });
    }
    const model = online.models.find((entry) => entry.id === modelId);
    if (!model) {
      return res.status(400).json({ error: 'A valid online model is required.' });
    }
    setOnlineModelPreference(model.id);
    setOnlineModelCache({
      expiresAt: Date.now() + onlineModelCacheTtlMs,
      payload: {
        ...online,
        activeModelId: model.id,
      },
    });
    return res.json({
      success: true,
      model,
    });
  };

  const llmConversationsHandler = (req, res) => {
    try {
      const conversations = appDb.listLlmConversations(req.session?.userId);
      return res.json({ conversations });
    } catch (err) {
      return res.status(500).json({ error: String(err || 'Unable to list conversations') });
    }
  };

  const llmConversationMessagesHandler = (req, res) => {
    const conversationId = Number(req.params.id || 0);
    if (!Number.isInteger(conversationId) || conversationId <= 0) {
      return res.status(400).json({ error: 'Valid conversation id is required' });
    }
    const conversation = appDb.getLlmConversation(conversationId);
    if (!conversation || conversation.userId !== req.session?.userId) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    return res.json({
      conversation,
      messages: appDb.listLlmMessages(conversationId),
    });
  };

  const llmConversationDeleteHandler = (req, res) => {
    const conversationId = Number(req.params.id || 0);
    if (!Number.isInteger(conversationId) || conversationId <= 0) {
      return res.status(400).json({ error: 'Valid conversation id is required' });
    }
    const conversation = appDb.getLlmConversation(conversationId);
    if (!conversation || conversation.userId !== req.session?.userId) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    appDb.deleteLlmConversation(conversationId);
    return res.json({ success: true, id: conversationId });
  };

  const readUpstreamErrorMessage = async (response, fallbackMessage) => {
    const rawMessage = await extractUpstreamErrorText(response, fallbackMessage);
    if (rawMessage && rawMessage !== fallbackMessage) {
      console.warn('[llm] upstream error', {
        message: rawMessage,
        status: response.status,
      });
    }
    return toClientFacingUpstreamError({
      status: response.status,
      rawMessage,
      fallbackMessage,
    });
  };

  const parseSseBlocks = (buffer) => {
    const events = [];
    let remaining = buffer;
    let boundary = remaining.indexOf('\n\n');
    while (boundary >= 0) {
      const rawBlock = remaining.slice(0, boundary).replace(/\r/g, '');
      remaining = remaining.slice(boundary + 2);
      boundary = remaining.indexOf('\n\n');
      if (!rawBlock.trim()) {
        continue;
      }

      let eventName = 'message';
      const dataLines = [];
      for (const line of rawBlock.split('\n')) {
        if (!line || line.startsWith(':')) {
          continue;
        }
        if (line.startsWith('event:')) {
          eventName = line.slice(6).trim() || 'message';
          continue;
        }
        if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trimStart());
        }
      }
      events.push({
        data: dataLines.join('\n'),
        event: eventName,
      });
    }

    return { events, remaining };
  };

  const extractStreamDeltaText = (payload) => {
    const choice = Array.isArray(payload?.choices) ? payload.choices[0] : null;
    if (choice && typeof choice === 'object') {
      const delta = choice.delta;
      if (typeof delta?.content === 'string') {
        return delta.content;
      }
      if (Array.isArray(delta?.content)) {
        return delta.content
          .map((part) => (typeof part?.text === 'string' ? part.text : ''))
          .join('');
      }
      if (typeof choice.text === 'string') {
        return choice.text;
      }
    }
    if (typeof payload?.content === 'string') {
      return payload.content;
    }
    return '';
  };

  const llmChatStreamHandler = async (req, res) => {
    const text = String(req.body?.message || '').trim();
    if (!text) {
      return res.status(400).json({ error: 'message is required' });
    }

    const mode = String(req.body?.mode || 'local').trim().toLowerCase() === 'online' ? 'online' : 'local';
    const llmState = await buildLlmState();
    let selectedModelId = '';
    if (mode === 'local') {
      if (!llmState.available) {
        return res.status(409).json({ error: llmState.blocker || 'LLM service is unavailable' });
      }
      if (!llmState.running) {
        return res.status(409).json({ error: 'LLM service is stopped. Start Local LLM first.' });
      }
      if (!llmState.activeModel || !llmState.activeModel.installed) {
        return res.status(409).json({ error: 'No active model is installed. Select and install a model first.' });
      }
      selectedModelId = llmState.activeModel.id;
    } else {
      const online = llmState.online || {};
      if (!online.configured) {
        return res.status(409).json({ error: 'Online provider is not configured.' });
      }
      if (!online.available) {
        return res.status(409).json({ error: online.error || 'Online provider is unavailable.' });
      }
      const requestedOnlineModelId = String(req.body?.onlineModelId || req.body?.modelId || '').trim();
      selectedModelId = requestedOnlineModelId || String(online.activeModelId || '');
      if (!selectedModelId || !Array.isArray(online.models) || !online.models.some((entry) => entry.id === selectedModelId)) {
        return res.status(400).json({ error: 'A valid online model is required.' });
      }
    }

    let conversation = null;
    const requestedConversationId = Number(req.body?.conversationId || 0);
    if (Number.isInteger(requestedConversationId) && requestedConversationId > 0) {
      const existing = appDb.getLlmConversation(requestedConversationId);
      if (!existing || existing.userId !== req.session?.userId) {
        return res.status(404).json({ error: 'Conversation not found' });
      }
      conversation = existing;
    } else {
      conversation = appDb.createLlmConversation({
        userId: req.session?.userId,
        title: text.slice(0, 80),
      });
    }

    appDb.appendLlmMessage({
      conversationId: conversation.id,
      role: 'user',
      content: text,
      modelId: selectedModelId,
    });

    const history = appDb.listLlmMessages(conversation.id);
    const messages = [
      { role: 'system', content: llmChatSystemPrompt },
      ...history.map((entry) => ({ role: entry.role, content: entry.content })),
    ];

    const chatPayload = {
      model: selectedModelId,
      messages,
      stream: true,
      max_tokens: llmMaxTokens,
      temperature: llmTemperature,
    };

    const upstream = mode === 'online'
      ? await callOnlineChatCompletion(chatPayload, { stream: true })
      : await callLlmChatCompletion(chatPayload, { stream: true });

    if (!upstream.ok) {
      const errorMessage = await readUpstreamErrorMessage(upstream, 'LLM request failed');
      return res.status(502).json({ error: errorMessage });
    }

    if (!upstream.body) {
      return res.status(502).json({ error: 'Upstream stream is unavailable' });
    }

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const emit = (eventName, payload) => {
      if (res.writableEnded) {
        return;
      }
      res.write(`event: ${eventName}\n`);
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    let terminalSent = false;
    const sendTerminal = (kind, payload) => {
      if (terminalSent || res.writableEnded) {
        return;
      }
      terminalSent = true;
      emit(kind, payload);
      res.end();
    };

    let clientDisconnected = false;
    req.on('close', () => {
      clientDisconnected = true;
      if (typeof upstream.body.cancel === 'function') {
        upstream.body.cancel().catch(() => {});
      }
    });

    emit('meta', {
      conversationId: conversation.id,
      mode,
      modelId: selectedModelId,
      startedAt: new Date().toISOString(),
    });

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let seq = 0;
    let assistantText = '';

    try {
      while (!clientDisconnected) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const parsed = parseSseBlocks(buffer);
        buffer = parsed.remaining;

        for (const event of parsed.events) {
          if (!event.data) {
            continue;
          }
          if (event.data === '[DONE]') {
            continue;
          }

          const payload = JSON.parse(event.data);
          const delta = extractStreamDeltaText(payload);
          if (!delta) {
            continue;
          }
          seq += 1;
          assistantText += delta;
          emit('delta', {
            seq,
            text: delta,
          });
        }
      }

      if (clientDisconnected) {
        return;
      }

      const normalizedAssistantText = assistantText.trim();
      if (!normalizedAssistantText) {
        sendTerminal('error', {
          code: 'upstream_error',
          message: 'LLM returned an empty response',
        });
        return;
      }

      let assistantMessage = null;
      try {
        assistantMessage = appDb.appendLlmMessage({
          conversationId: conversation.id,
          role: 'assistant',
          content: normalizedAssistantText,
          modelId: selectedModelId,
        });
      } catch {
        sendTerminal('error', {
          code: 'persistence_error',
          message: 'Unable to persist streamed assistant message',
        });
        return;
      }

      sendTerminal('done', {
        conversationId: conversation.id,
        assistantMessage,
      });
    } catch (err) {
      if (clientDisconnected) {
        return;
      }
      sendTerminal('error', {
        code: 'upstream_error',
        message: String(err?.message || err || 'Stream failed'),
      });
    } finally {
      reader.releaseLock();
    }
  };

  const llmChatHandler = async (req, res) => {
    const text = String(req.body?.message || '').trim();
    if (!text) {
      return res.status(400).json({ error: 'message is required' });
    }

    const mode = String(req.body?.mode || 'local').trim().toLowerCase() === 'online' ? 'online' : 'local';
    const llmState = await buildLlmState();
    let selectedModelId = '';
    if (mode === 'local') {
      if (!llmState.available) {
        return res.status(409).json({ error: llmState.blocker || 'LLM service is unavailable' });
      }
      if (!llmState.running) {
        return res.status(409).json({ error: 'LLM service is stopped. Start Local LLM first.' });
      }
      if (!llmState.activeModel || !llmState.activeModel.installed) {
        return res.status(409).json({ error: 'No active model is installed. Select and install a model first.' });
      }
      selectedModelId = llmState.activeModel.id;
    } else {
      const online = llmState.online || {};
      if (!online.configured) {
        return res.status(409).json({ error: 'Online provider is not configured.' });
      }
      if (!online.available) {
        return res.status(409).json({ error: online.error || 'Online provider is unavailable.' });
      }
      const requestedOnlineModelId = String(req.body?.onlineModelId || req.body?.modelId || '').trim();
      selectedModelId = requestedOnlineModelId || String(online.activeModelId || '');
      if (!selectedModelId || !Array.isArray(online.models) || !online.models.some((entry) => entry.id === selectedModelId)) {
        return res.status(400).json({ error: 'A valid online model is required.' });
      }
    }

    let conversation = null;
    const requestedConversationId = Number(req.body?.conversationId || 0);
    if (Number.isInteger(requestedConversationId) && requestedConversationId > 0) {
      const existing = appDb.getLlmConversation(requestedConversationId);
      if (!existing || existing.userId !== req.session?.userId) {
        return res.status(404).json({ error: 'Conversation not found' });
      }
      conversation = existing;
    } else {
      conversation = appDb.createLlmConversation({
        userId: req.session?.userId,
        title: text.slice(0, 80),
      });
    }

    appDb.appendLlmMessage({
      conversationId: conversation.id,
      role: 'user',
      content: text,
      modelId: selectedModelId,
    });

    const history = appDb.listLlmMessages(conversation.id);
    const messages = [
      { role: 'system', content: llmChatSystemPrompt },
      ...history.map((entry) => ({ role: entry.role, content: entry.content })),
    ];

    const chatPayload = {
      model: selectedModelId,
      messages,
      stream: false,
      max_tokens: llmMaxTokens,
      temperature: llmTemperature,
    };
    const { response, body } = mode === 'online'
      ? await callOnlineChatCompletion(chatPayload)
      : await callLlmChatCompletion(chatPayload);
    if (!response.ok) {
      const rawMessage = body?.error?.message || body?.error;
      if (rawMessage) {
        console.warn('[llm] upstream request failed', {
          message: String(rawMessage),
          status: response.status,
        });
      }
      return res.status(502).json({
        error: toClientFacingUpstreamError({
          status: response.status,
          rawMessage,
          fallbackMessage: 'LLM request failed',
        }),
      });
    }

    const assistantText = String(body?.choices?.[0]?.message?.content || '').trim();
    if (!assistantText) {
      return res.status(502).json({ error: 'LLM returned an empty response' });
    }

    const assistantMessage = appDb.appendLlmMessage({
      conversationId: conversation.id,
      role: 'assistant',
      content: assistantText,
      modelId: selectedModelId,
    });

    return res.json({
      success: true,
      conversationId: conversation.id,
      mode,
      assistantMessage,
    });
  };

  const openAiModelsHandler = async (req, res) => {
    const state = await buildLlmState();
    const models = state.models
      .filter((entry) => entry.installed)
      .map((entry) => ({
        id: entry.id,
        object: 'model',
        owned_by: entry.source || 'local',
        created: 0,
      }));
    return res.json({
      object: 'list',
      data: models,
      active_model: state.activeModelId,
    });
  };

  const openAiChatCompletionsHandler = async (req, res) => {
    const state = await buildLlmState();
    if (!state.available) {
      return res.status(409).json({ error: { message: state.blocker || 'LLM service unavailable', type: 'service_unavailable' } });
    }
    if (!state.running) {
      return res.status(409).json({ error: { message: 'LLM service is stopped', type: 'service_unavailable' } });
    }

    const requestedModelId = sanitizeModelId(req.body?.model || state.activeModelId);
    if (requestedModelId !== state.activeModelId) {
      return res.status(409).json({
        error: {
          message: `Model '${requestedModelId}' is not active. Switch active model to continue.`,
          type: 'model_mismatch',
        },
      });
    }

    const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
    if (messages.length === 0) {
      return res.status(400).json({ error: { message: 'messages are required', type: 'invalid_request_error' } });
    }

    const stream = Boolean(req.body?.stream);
    const payload = {
      ...req.body,
      model: state.activeModelId,
      max_tokens: req.body?.max_tokens || llmMaxTokens,
      temperature: Number.isFinite(Number(req.body?.temperature)) ? Number(req.body.temperature) : llmTemperature,
      stream,
    };
    if (!Array.isArray(payload.messages) || payload.messages.length === 0 || payload.messages[0]?.role !== 'system') {
      payload.messages = [{ role: 'system', content: llmChatSystemPrompt }, ...messages];
    }

    if (stream) {
      const upstream = await callLlmChatCompletion(payload, { stream: true });
      if (!upstream.ok) {
        const rawMessage = await extractUpstreamErrorText(upstream, 'Upstream LLM stream failed');
        if (rawMessage) {
          console.warn('[llm] upstream stream failed', {
            message: rawMessage,
            status: upstream.status,
          });
        }
        return res.status(502).json({
          error: {
            message: toClientFacingUpstreamError({
              status: upstream.status,
              rawMessage,
              fallbackMessage: 'Upstream LLM stream failed',
            }),
            type: 'upstream_error',
          },
        });
      }
      res.status(200);
      res.setHeader('Content-Type', upstream.headers.get('content-type') || 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      if (!upstream.body) {
        return res.end();
      }
      Readable.fromWeb(upstream.body).pipe(res);
      return;
    }

    const { response, body } = await callLlmChatCompletion(payload);
    if (!response.ok) {
      const rawMessage = body?.error?.message || body?.error;
      if (rawMessage) {
        console.warn('[llm] upstream openai compat failed', {
          message: String(rawMessage),
          status: response.status,
        });
      }
      return res.status(502).json({
        error: {
          message: toClientFacingUpstreamError({
            status: response.status,
            rawMessage,
            fallbackMessage: 'Upstream LLM request failed',
          }),
          type: 'upstream_error',
        },
      });
    }
    return res.json(body);
  };

  const handlers = {
    llmStateHandler,
    llmModelSelectHandler,
    llmModelAddLocalHandler,
    llmModelPullHandler,
    llmModelPullStatusHandler,
    llmOnlineModelsRefreshHandler,
    llmOnlineModelSelectHandler,
    llmConversationsHandler,
    llmConversationMessagesHandler,
    llmConversationDeleteHandler,
    llmChatStreamHandler,
    llmChatHandler,
    openAiModelsHandler,
    openAiChatCompletionsHandler,
  };

  if (!controlPlane || typeof controlPlane.wrapHandler !== 'function') {
    return handlers;
  }

  return Object.fromEntries(
    Object.entries(handlers).map(([name, handler]) => [
      name,
      controlPlane.wrapHandler({ scope: 'ai', action: name }, handler),
    ])
  );
};

module.exports = {
  buildLlmHandlers,
};
