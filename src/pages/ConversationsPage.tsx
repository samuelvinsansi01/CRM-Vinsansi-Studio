import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Archive, ArchiveRestore, Check, CheckCheck, Clock3, Inbox, MessageCircle, RefreshCcw, Search, Send, Smartphone, TriangleAlert } from 'lucide-react';
import { Button, Panel, Tag } from '../design-system/components';
import { PageHeader } from '../design-system/layouts/PageHeader';
import { useOrganizationContext } from '../providers/OrganizationProvider';
import {
  listChatChips, listConversationMessages, listConversationUnreadCounts, listConversations, markConversationRead, setConversationArchived,
  type ChatChip, type Conversation, type ConversationMessage,
} from '../repositories/conversations/conversations.repository';
import { sendConversationMessage } from '../services/conversations/conversations.gateway';

function formatTime(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function formatMessageTime(message: ConversationMessage) {
  const date = new Date(message.providerTimestamp || message.createdAt);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function initials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return (parts.slice(0, 2).map((part) => part[0]).join('') || '?').toUpperCase();
}

function displayContact(conversation: Conversation) {
  return conversation.contactName || conversation.phone || conversation.remoteJid || 'Contato sem nome';
}


function readNotificationConversationTarget() {
  const raw = window.sessionStorage.getItem('crm:notification:conversation-target');
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const conversationId = String(value.conversationId ?? '').trim();
    const chipId = String(value.chipId ?? '').trim();
    return conversationId ? { conversationId, chipId } : null;
  } catch {
    window.sessionStorage.removeItem('crm:notification:conversation-target');
    return null;
  }
}

function MessageStatus({ status }: { status: ConversationMessage['status'] }) {
  if (status === 'read') return <CheckCheck size={14} aria-label="Lida" />;
  if (status === 'delivered') return <CheckCheck size={14} aria-label="Entregue" />;
  if (status === 'sent') return <Check size={14} aria-label="Enviada" />;
  if (status === 'pending' || status === 'sending') return <Clock3 size={13} aria-label="Enviando" />;
  if (status === 'failed' || status === 'reconciliation_required') return <TriangleAlert size={14} aria-label="Falha" />;
  return null;
}

export function ConversationsPage() {
  const { hasPermission } = useOrganizationContext();
  const canReply = hasPermission('whatsapp.reply');
  const [chips, setChips] = useState<ChatChip[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [unreadByChip, setUnreadByChip] = useState<Record<string, number>>({});
  const [selectedChipId, setSelectedChipId] = useState<string | null>(null);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const threadRef = useRef<HTMLDivElement>(null);
  const notificationTargetRef = useRef(readNotificationConversationTarget());

  const selectedConversation = conversations.find((item) => item.id === selectedConversationId) ?? null;
  const visibleConversations = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('pt-BR');
    if (!term) return conversations;
    return conversations.filter((item) => [item.contactName, item.phone, item.remoteJid, item.lastMessagePreview]
      .some((value) => value.toLocaleLowerCase('pt-BR').includes(term)));
  }, [conversations, search]);

  const loadChips = useCallback(async () => {
    const [next, unread] = await Promise.all([listChatChips(), listConversationUnreadCounts()]);
    setChips(next);
    setUnreadByChip(unread);
    setSelectedChipId((current) => {
      const targetChipId = notificationTargetRef.current?.chipId;
      if (targetChipId && next.some((chip) => chip.id === targetChipId)) return targetChipId;
      return current && next.some((chip) => chip.id === current) ? current : next[0]?.id ?? null;
    });
  }, []);

  const loadConversations = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const next = await listConversations(selectedChipId, includeArchived);
      setConversations(next);
      setSelectedConversationId((current) => {
        const targetConversationId = notificationTargetRef.current?.conversationId;
        if (targetConversationId && next.some((conversation) => conversation.id === targetConversationId)) {
          notificationTargetRef.current = null;
          window.sessionStorage.removeItem('crm:notification:conversation-target');
          return targetConversationId;
        }
        return current && next.some((conversation) => conversation.id === current) ? current : next[0]?.id ?? null;
      });
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao carregar as conversas.');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [selectedChipId, includeArchived]);

  const loadMessages = useCallback(async (conversationId: string | null, quiet = false) => {
    if (!conversationId) { setMessages([]); return; }
    try {
      const next = await listConversationMessages(conversationId);
      setMessages(next);
      if (!quiet) window.requestAnimationFrame(() => threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao carregar as mensagens.');
    }
  }, []);

  const refresh = useCallback(async (quiet = false) => {
    try {
      if (!chips.length) await loadChips();
      await loadConversations(quiet);
      setUnreadByChip(await listConversationUnreadCounts());
      await loadMessages(selectedConversationId, quiet);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao atualizar o chat.');
    }
  }, [chips.length, loadChips, loadConversations, loadMessages, selectedConversationId]);

  useEffect(() => { void loadChips().catch((cause) => setError(cause instanceof Error ? cause.message : 'Falha ao carregar chips.')); }, [loadChips]);
  useEffect(() => { void loadConversations(); }, [loadConversations]);
  useEffect(() => {
    void loadMessages(selectedConversationId);
    if (selectedConversationId) {
      void markConversationRead(selectedConversationId).then(() => {
        setConversations((current) => current.map((item) => item.id === selectedConversationId ? { ...item, unreadCount: 0 } : item));
        const chipId = conversations.find((item) => item.id === selectedConversationId)?.chipId;
        if (chipId) setUnreadByChip((current) => ({ ...current, [chipId]: Math.max(0, (current[chipId] ?? 0) - (conversations.find((item) => item.id === selectedConversationId)?.unreadCount ?? 0)) }));
      }).catch(() => undefined);
    }
  }, [loadMessages, selectedConversationId]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh(true);
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (!threadRef.current) return;
    threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [messages.length, selectedConversationId]);

  const handleSend = async () => {
    if (!canReply) return;
    if (!selectedConversation || !draft.trim() || sending) return;
    const body = draft.trim();
    const optimisticId = `optimistic-${crypto.randomUUID()}`;
    const optimistic: ConversationMessage = {
      id: optimisticId, conversationId: selectedConversation.id, externalId: null, direction: 'outbound', fromMe: true,
      type: 'text', body, mediaUrl: '', mediaMimeType: '', mediaFileName: '', quotedExternalId: null,
      status: 'sending', providerTimestamp: new Date().toISOString(), createdAt: new Date().toISOString(), errorMessage: '',
    };
    setDraft(''); setSending(true); setMessages((current) => [...current, optimistic]);
    try {
      await sendConversationMessage(selectedConversation.id, body);
      await Promise.all([loadMessages(selectedConversation.id, true), loadConversations(true)]);
      setError('');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Falha ao enviar a mensagem.';
      setMessages((current) => current.map((item) => item.id === optimisticId ? { ...item, status: 'failed', errorMessage: message } : item));
      setError(message);
    } finally { setSending(false); }
  };

  const handleArchive = async () => {
    if (!canReply) return;
    if (!selectedConversation) return;
    try {
      await setConversationArchived(selectedConversation.id, selectedConversation.status !== 'archived');
      await loadConversations();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Falha ao alterar a conversa.'); }
  };

  return (
    <div className="chat-page">
      <PageHeader
        title="Conversas"
        description="Atenda as conversas do WhatsApp separadas por chip, com histórico recebido pelos webhooks da Evolution."
        action={<Button variant="secondary" iconLeft={RefreshCcw} loading={loading} onClick={() => void refresh()}>Atualizar</Button>}
      />

      {error ? <div className="chat-alert"><TriangleAlert size={17} /><span>{error}</span></div> : null}

      <div className="chat-layout">
        <Panel className="chat-chips" title="Chips">
          {!chips.length ? <div className="chat-empty"><Smartphone size={24} /><span>Nenhum chip cadastrado.</span></div> : null}
          <div className="chat-chip-list">
            {chips.map((chip) => (
              <button key={chip.id} className={`chat-chip ${selectedChipId === chip.id ? 'is-active' : ''}`} onClick={() => { setSelectedChipId(chip.id); setSelectedConversationId(null); }}>
                <span className={`chat-presence ${chip.connected ? 'is-online' : ''}`} />
                <span className="chat-chip__content"><strong>{chip.name}</strong><small>{chip.phone || chip.instanceName}</small></span>
                {unreadByChip[chip.id] ? <span className="chat-badge">{unreadByChip[chip.id]}</span> : null}
              </button>
            ))}
          </div>
        </Panel>

        <Panel className="chat-conversations" title="Conversas" actions={(
          <label className="chat-archive-toggle"><input type="checkbox" checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)} /> Arquivadas</label>
        )}>
          <label className="chat-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar contato ou mensagem" /></label>
          <div className="chat-conversation-list">
            {loading && !visibleConversations.length ? <div className="chat-empty"><Clock3 size={24} /><span>Carregando...</span></div> : null}
            {!loading && !visibleConversations.length ? <div className="chat-empty"><Inbox size={26} /><span>Nenhuma conversa para este chip.</span></div> : null}
            {visibleConversations.map((conversation) => (
              <button key={conversation.id} className={`chat-conversation ${selectedConversationId === conversation.id ? 'is-active' : ''}`} onClick={() => setSelectedConversationId(conversation.id)}>
                <span className="chat-avatar">{initials(displayContact(conversation))}</span>
                <span className="chat-conversation__content">
                  <span className="chat-conversation__title"><strong>{displayContact(conversation)}</strong><time>{formatTime(conversation.lastMessageAt)}</time></span>
                  <span className="chat-conversation__preview">{conversation.lastMessageDirection === 'outbound' ? 'Você: ' : ''}{conversation.lastMessagePreview || 'Sem mensagens'}</span>
                </span>
                {conversation.unreadCount ? <span className="chat-badge">{conversation.unreadCount}</span> : null}
              </button>
            ))}
          </div>
        </Panel>

        <Panel className="chat-thread" title={selectedConversation ? displayContact(selectedConversation) : 'Mensagens'} actions={selectedConversation && canReply ? (
          <Button size="sm" variant="ghost" iconLeft={selectedConversation.status === 'archived' ? ArchiveRestore : Archive} onClick={() => void handleArchive()}>
            {selectedConversation.status === 'archived' ? 'Reabrir' : 'Arquivar'}
          </Button>
        ) : undefined}>
          {!selectedConversation ? <div className="chat-thread-empty"><MessageCircle size={38} /><strong>Selecione uma conversa</strong><span>As mensagens aparecerão aqui.</span></div> : (
            <>
              <div className="chat-thread__identity">
                <span>{selectedConversation.phone || selectedConversation.remoteJid}</span>
                {selectedConversation.leadId ? <Tag tone="primary">Lead #{selectedConversation.leadId}</Tag> : <Tag tone="neutral">Sem lead vinculado</Tag>}
              </div>
              <div className="chat-messages" ref={threadRef}>
                {!messages.length ? <div className="chat-empty"><Inbox size={24} /><span>Nenhuma mensagem registrada.</span></div> : null}
                {messages.map((message) => (
                  <article key={message.id} className={`chat-message chat-message--${message.direction} ${message.status === 'failed' || message.status === 'reconciliation_required' ? 'has-error' : ''}`}>
                    {message.body ? <p>{message.body}</p> : <p className="chat-message__placeholder">[{message.type || 'mídia'}]</p>}
                    {message.mediaUrl ? <a href={message.mediaUrl} target="_blank" rel="noreferrer">Abrir {message.mediaFileName || message.type || 'mídia'}</a> : null}
                    {message.errorMessage ? <small className="chat-message__error">{message.errorMessage}</small> : null}
                    <footer><time>{formatMessageTime(message)}</time>{message.direction === 'outbound' ? <MessageStatus status={message.status} /> : null}</footer>
                  </article>
                ))}
              </div>
              {canReply ? <div className="chat-composer">
                <textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Digite uma mensagem" rows={2} maxLength={4096}
                  onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void handleSend(); } }} />
                <Button iconLeft={Send} loading={sending} disabled={!draft.trim() || selectedConversation.status === 'archived'} onClick={() => void handleSend()}>Enviar</Button>
              </div> : null}
            </>
          )}
        </Panel>
      </div>
    </div>
  );
}
