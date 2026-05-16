'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  deleteLlmConversation,
  getLlmConversationMessages,
  listLlmConversations,
  refreshOnlineModels,
  selectLlmModel,
  selectOnlineModel,
  sendLlmChatStream,
} from '../api';
import { EmptyState, MetricGrid, MetricTile, SectionCard, StatusBadge } from '../components';
import { toErrorMessage } from '../errors';
import {
  asArray,
  asRecord,
  LocalTabBar,
  renderAnimatedAssistantText,
  toPercent,
  WorkspaceActions,
} from './shared';

export function AiWorkspace({
  payload,
  workspaceActions,
}: {
  payload: Record<string, unknown>;
  workspaceActions?: WorkspaceActions;
}) {
  const llm = asRecord(payload.llmState);
  const monitor = asRecord(payload.monitor);
  const models = asArray<Record<string, unknown>>(llm.models);
  const online = asRecord(llm.online);
  const onlineModels = asArray<Record<string, unknown>>(online.models);
  const firstOnlineModelId = String(onlineModels[0]?.id || '');
  const [modelId, setModelId] = useState(String(llm.activeModelId || ''));
  const [onlineModelId, setOnlineModelId] = useState(String(online.activeModelId || firstOnlineModelId || ''));
  const [llmBusy, setLlmBusy] = useState<'local' | 'online-refresh' | 'online' | ''>('');
  const [llmStatus, setLlmStatus] = useState('');
  const [chatMode, setChatMode] = useState<'local' | 'online'>('local');
  const [chatInput, setChatInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [chatStatus, setChatStatus] = useState('');
  const [chatConversationId, setChatConversationId] = useState<number | null>(null);
  const [chatTranscript, setChatTranscript] = useState<Array<{ id?: number; role: string; content: string; createdAt?: string }>>([]);
  const [conversationBusy, setConversationBusy] = useState(false);
  const [conversations, setConversations] = useState<Array<Record<string, unknown>>>([]);
  const [activeTab, setActiveTab] = useState<'chat' | 'manage'>('chat');

  useEffect(() => {
    setModelId(String(llm.activeModelId || ''));
  }, [llm.activeModelId]);

  useEffect(() => {
    setOnlineModelId(String(online.activeModelId || firstOnlineModelId || ''));
  }, [online.activeModelId, firstOnlineModelId]);

  const loadConversations = useCallback(async () => {
    setConversationBusy(true);
    try {
      const response = await listLlmConversations();
      const items = asArray<Record<string, unknown>>(response.conversations)
        .slice()
        .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
      setConversations(items);
    } catch (error) {
      setChatStatus(toErrorMessage(error, 'Unable to load conversation history'));
    } finally {
      setConversationBusy(false);
    }
  }, []);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  const applyLocalModel = async () => {
    if (!modelId.trim()) {
      return;
    }
    setLlmBusy('local');
    try {
      const response = await selectLlmModel(modelId.trim());
      setLlmStatus(response.success === false ? String(response.error || 'Unable to select local model') : 'Local model updated.');
      workspaceActions?.onRefresh();
    } catch (error) {
      setLlmStatus(toErrorMessage(error, 'Unable to select local model'));
    } finally {
      setLlmBusy('');
    }
  };

  const refreshOnline = async () => {
    setLlmBusy('online-refresh');
    try {
      const response = await refreshOnlineModels();
      setLlmStatus(response.success === false ? String(response.error || 'Unable to refresh online models') : 'Online models refreshed.');
      workspaceActions?.onRefresh();
    } catch (error) {
      setLlmStatus(toErrorMessage(error, 'Unable to refresh online models'));
    } finally {
      setLlmBusy('');
    }
  };

  const applyOnlineModel = async () => {
    if (!onlineModelId.trim()) {
      return;
    }
    setLlmBusy('online');
    try {
      const response = await selectOnlineModel(onlineModelId.trim());
      setLlmStatus(response.success === false ? String(response.error || 'Unable to select online model') : 'Online model updated.');
      workspaceActions?.onRefresh();
    } catch (error) {
      setLlmStatus(toErrorMessage(error, 'Unable to select online model'));
    } finally {
      setLlmBusy('');
    }
  };

  const sendQuickPrompt = async () => {
    const message = chatInput.trim();
    if (!message) {
      return;
    }

    setChatBusy(true);
    setChatStatus('');
    const createdAt = new Date().toISOString();
    const pendingAssistantId = -Date.now();
    setChatTranscript((current) => [
      ...current,
      { role: 'user', content: message, createdAt },
      { id: pendingAssistantId, role: 'assistant', content: '', createdAt },
    ]);
    setChatInput('');

    try {
      await sendLlmChatStream({
        message,
        mode: chatMode,
        conversationId: chatConversationId,
        onlineModelId: chatMode === 'online' ? onlineModelId || undefined : undefined,
      }, {
        onMeta: (meta) => {
          if (Number.isInteger(meta.conversationId) && Number(meta.conversationId) > 0) {
            setChatConversationId(Number(meta.conversationId));
          }
        },
        onDelta: (delta) => {
          if (!delta.text) {
            return;
          }
          setChatTranscript((current) => current.map((entry) => (
            entry.id === pendingAssistantId
              ? { ...entry, content: `${entry.content}${delta.text}` }
              : entry
          )));
        },
        onDone: (done) => {
          setChatTranscript((current) => current.map((entry) => (
            entry.id === pendingAssistantId
              ? {
                  id: Number(done.assistantMessage?.id || 0) || undefined,
                  role: String(done.assistantMessage?.role || 'assistant'),
                  content: String(done.assistantMessage?.content || entry.content || 'No response text returned.'),
                  createdAt: String(done.assistantMessage?.createdAt || entry.createdAt || new Date().toISOString()),
                }
              : entry
          )));
          if (Number.isInteger(done.conversationId) && Number(done.conversationId) > 0) {
            setChatConversationId(Number(done.conversationId));
          }
        },
        onError: (streamErr) => {
          const errorMessage = String(streamErr.message || 'Chat request failed');
          setChatStatus(errorMessage);
          setChatTranscript((current) => current.map((entry) => (
            entry.id === pendingAssistantId
              ? {
                  ...entry,
                  content: `Error: ${errorMessage}`,
                }
              : entry
          )));
        },
      });
      void loadConversations();
    } catch (error) {
      const errorMessage = toErrorMessage(error, 'Chat request failed');
      setChatStatus(errorMessage);
      setChatTranscript((current) => current.map((entry) => (
        entry.id === pendingAssistantId
          ? {
              ...entry,
              content: `Error: ${errorMessage}`,
            }
          : entry
      )));
    } finally {
      setChatBusy(false);
      workspaceActions?.onRefresh();
    }
  };

  const loadConversationMessages = async (conversationId: number) => {
    if (!conversationId) {
      return;
    }
    setConversationBusy(true);
    try {
      const response = await getLlmConversationMessages(conversationId);
      const messages = asArray<Record<string, unknown>>(response.messages).map((entry) => ({
        id: Number(entry.id || 0) || undefined,
        role: String(entry.role || 'assistant'),
        content: String(entry.content || ''),
        createdAt: String(entry.createdAt || ''),
      }));
      setChatConversationId(conversationId);
      setChatTranscript(messages);
      setChatStatus('');
    } catch (error) {
      setChatStatus(toErrorMessage(error, 'Unable to load conversation'));
    } finally {
      setConversationBusy(false);
    }
  };

  const removeConversation = async (conversationId: number) => {
    if (!conversationId) {
      return;
    }
    setConversationBusy(true);
    try {
      await deleteLlmConversation(conversationId);
      if (chatConversationId === conversationId) {
        setChatConversationId(null);
        setChatTranscript([]);
      }
      await loadConversations();
      setChatStatus('Conversation deleted.');
    } catch (error) {
      setChatStatus(toErrorMessage(error, 'Unable to delete conversation'));
    } finally {
      setConversationBusy(false);
    }
  };

  const lastUserMessage = [...chatTranscript].reverse().find((entry) => entry.role === 'user')?.content || '';

  return (
    <>
      <LocalTabBar
        label="AI workspace tabs"
        items={[
          { key: 'chat', label: 'Chat' },
          { key: 'manage', label: 'Manage' },
        ]}
        activeKey={activeTab}
        onChange={(key) => setActiveTab(key as 'chat' | 'manage')}
      />
      <MetricGrid>
        <MetricTile label="Runtime" value={Boolean(llm.running) ? 'Running' : 'Stopped'} helper={String(llm.blocker || 'Local LLM service state')} />
        <MetricTile label="Active model" value={String(llm.activeModelId || 'none')} helper="Selected local or online model" />
        <MetricTile label="Installed models" value={models.filter((entry) => Boolean(entry.installed)).length} helper={`${models.length} total configured`} />
        <MetricTile label="Online provider" value={Boolean(online.available) ? 'Available' : 'Unavailable'} helper={String(online.error || 'Online model provider status')} />
        <MetricTile label="Host CPU load" value={toPercent(monitor.cpuLoad)} helper={String(monitor.timestamp || 'Latest AI workspace sample')} />
      </MetricGrid>

      {activeTab === 'chat' ? (
      <SectionCard title="Chat" subtitle="V1-style threaded chat with conversation history and compact routing controls.">
        <div className="dash2-chat-controls">
          <div className="dash2-chat-actions">
            <label>
              <span>Chat mode</span>
              <select className="ui-input" value={chatMode} onChange={(event) => setChatMode(event.target.value === 'online' ? 'online' : 'local')}>
                <option value="local">Local</option>
                <option value="online">Online</option>
              </select>
            </label>
            {chatMode === 'online' ? (
              <label>
                <span>Online model</span>
                <select className="ui-input" value={onlineModelId} onChange={(event) => setOnlineModelId(event.target.value)}>
                  {onlineModels.length === 0 ? <option value="">No models</option> : null}
                  {onlineModels.map((entry, index) => (
                    <option key={`${String(entry.id || 'online')}-${index}`} value={String(entry.id || '')}>
                      {String(entry.label || entry.id || 'Model')}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <button className="ui-button" type="button" onClick={() => { setChatConversationId(null); setChatTranscript([]); setChatStatus(''); }}>
              New chat
            </button>
            <button className="ui-button" type="button" disabled={conversationBusy} onClick={() => void loadConversations()}>
              {conversationBusy ? 'Loading…' : 'Refresh history'}
            </button>
          </div>
        </div>

        <div className="dash2-chatbox-layout">
          <aside className="dash2-chatbox-rail">
            <h3>Conversation history</h3>
            {conversations.length === 0 ? <p className="dash2-admin-note">No conversations yet.</p> : (
              <ul className="dash2-list">
                {conversations.map((entry) => {
                  const conversationId = Number(entry.id || 0);
                  const selected = chatConversationId === conversationId;
                  return (
                    <li key={`history-${conversationId}`} className={selected ? 'dash2-chat-history-item dash2-chat-history-item--active' : 'dash2-chat-history-item'}>
                      <button className="ui-button" type="button" onClick={() => void loadConversationMessages(conversationId)}>
                        <strong>{String(entry.title || `Conversation ${conversationId}`)}</strong>
                        <p className="dash2-small-copy">{String(entry.updatedAt || '')}</p>
                      </button>
                      <button className="ui-button dash2-ui-button--danger" type="button" disabled={conversationBusy} onClick={() => void removeConversation(conversationId)}>
                        Delete
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </aside>

          <section className="dash2-chatbox-thread">
            {chatTranscript.length > 0 ? (
              <div className="dash2-chat-log" aria-live="polite">
                {chatTranscript.map((entry, index) => (
                  <article key={`${entry.id || index}-${entry.role}`} className={`dash2-chat-log__entry dash2-chat-log__entry--${entry.role === 'user' ? 'user' : 'assistant'}`}>
                    <strong>{entry.role === 'user' ? 'You' : 'Assistant'}</strong>
                    {entry.role === 'assistant' ? renderAnimatedAssistantText(entry.content) : <p>{entry.content}</p>}
                    <div className="dash2-chat-log__meta">
                      <span>{entry.createdAt ? new Date(entry.createdAt).toLocaleString() : ''}</span>
                      {entry.role !== 'user' ? (
                        <button className="ui-button" type="button" onClick={() => navigator.clipboard?.writeText(entry.content).catch(() => {})}>
                          Copy
                        </button>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState title="No conversation yet" message="Send a prompt to start a new chat thread." />
            )}
            <label>
              <span>Prompt</span>
              <textarea
                className="ui-input dash2-chat-input"
                rows={4}
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
                placeholder="Ask a question…"
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    if (!chatBusy && chatInput.trim()) {
                      void sendQuickPrompt();
                    }
                  }
                }}
              />
            </label>
            <div className="dash2-chat-actions">
              <button className="ui-button" type="button" disabled={chatBusy || !lastUserMessage} onClick={() => setChatInput(lastUserMessage)}>
                Retry last
              </button>
              <button className="ui-button ui-button--primary" type="button" disabled={chatBusy || !chatInput.trim()} onClick={() => void sendQuickPrompt()}>
                {chatBusy ? 'Sending…' : 'Send'}
              </button>
              {chatConversationId ? <StatusBadge tone="muted">Conversation #{chatConversationId}</StatusBadge> : null}
            </div>
          </section>
        </div>
        {chatStatus ? <p className="dash2-admin-note">{chatStatus}</p> : null}
      </SectionCard>
      ) : (
      <SectionCard title="Manage" subtitle="Bring the V1 runtime and model-management controls back into a dedicated management view.">
        <div className="dash2-llm-controls">
          <label>
            <span>Local model</span>
            <select className="ui-input" value={modelId} onChange={(event) => setModelId(event.target.value)}>
              {models.map((entry, index) => (
                <option key={`${String(entry.id || 'model')}-${index}`} value={String(entry.id || '')}>
                  {String(entry.label || entry.id || 'Model')}
                </option>
              ))}
            </select>
          </label>
          <button className="ui-button" type="button" disabled={llmBusy !== ''} onClick={() => void applyLocalModel()}>
            {llmBusy === 'local' ? 'Applying…' : 'Use local model'}
          </button>
          <button className="ui-button" type="button" disabled={llmBusy !== ''} onClick={() => void refreshOnline()}>
            {llmBusy === 'online-refresh' ? 'Refreshing…' : 'Refresh online models'}
          </button>
          <label>
            <span>Online model</span>
            <select className="ui-input" value={onlineModelId} onChange={(event) => setOnlineModelId(event.target.value)}>
              {onlineModels.length === 0 ? <option value="">No models</option> : null}
              {onlineModels.map((entry, index) => (
                <option key={`${String(entry.id || 'online')}-${index}`} value={String(entry.id || '')}>
                  {String(entry.label || entry.id || 'Model')}
                </option>
              ))}
            </select>
          </label>
          <button className="ui-button" type="button" disabled={llmBusy !== '' || !onlineModelId} onClick={() => void applyOnlineModel()}>
            {llmBusy === 'online' ? 'Applying…' : 'Use online model'}
          </button>
        </div>
        {llmStatus ? <p className="dash2-admin-note">{llmStatus}</p> : null}
        {models.length === 0 ? <EmptyState title="No models" message="No local models are configured." /> : (
          <ul className="dash2-list">
            {models.map((entry, index) => (
              <li key={`${String(entry.id || 'model')}-${index}`}>
                <div>
                  <strong>{String(entry.label || entry.id || 'Model')}</strong>
                  <p>{String(entry.path || 'No path')}</p>
                </div>
                <StatusBadge tone={Boolean(entry.installed) ? 'ok' : 'warn'}>{Boolean(entry.installed) ? 'installed' : 'missing'}</StatusBadge>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
      )}
    </>
  );
}

