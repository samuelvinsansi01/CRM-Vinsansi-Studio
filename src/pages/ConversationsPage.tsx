import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { Archive, ArchiveRestore, CalendarDays, Check, CheckCheck, Clock3, Inbox, MessageCircle, RefreshCcw, Search, Send, Smartphone, TriangleAlert } from 'lucide-react';
import { Button, Drawer, Field, Panel, SelectField, Tag, ToastViewport, type ToastItem } from '../design-system/components';
import { PageHeader } from '../design-system/layouts/PageHeader';
import { useOrganizationContext } from '../providers/OrganizationProvider';
import { getSupabaseClient } from '../lib/supabase';
import {
  getConversationDelta, ignoreConversationContact, listChatChips, listConversationMessages, listConversationUnreadCounts, listConversationsPage,
  listPromotionBranches, listPromotionCities, listPromotionContactSources, listPromotionCountries, listPromotionStates, mapConversationMessageRow,
  markConversationRead, promoteConversationContact, restoreConversationContact, setConversationArchived, sortConversationMessages,
  type ChatChip, type Conversation, type ConversationCursor, type ConversationMessage, type PromotionOption,
} from '../repositories/conversations/conversations.repository';
import {
  getConversationCommercial,
  sendConversationMessage,
  setConversationCommercialStage,
  setConversationPreviewDueDate,
  type ConversationCommercialContext,
} from '../services/conversations/conversations.gateway';
import { COMMERCIAL_STAGE_LABELS, type CommercialStage } from '../services/leads/crmLead.types';

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

function formatDateOnly(value?: string) {
  if (!value) return '—';
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return '—';
  return new Intl.DateTimeFormat('pt-BR').format(new Date(year, month - 1, day));
}

function todayInputValue() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function initials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return (parts.slice(0, 2).map((part) => part[0]).join('') || '?').toUpperCase();
}

function displayContact(conversation: Conversation) {
  return conversation.displayName || conversation.contactName || conversation.phone || conversation.remoteJid || 'Contato sem nome';
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

function commercialStageOptions(context: ConversationCommercialContext) {
  return context.allowedTransitions.map((value) => ({ value, label: COMMERCIAL_STAGE_LABELS[value] }));
}

const MESSAGE_PAGE_SIZE = 80;
type ContactFilter='active'|'ignored';
type PromotionForm={name:string;alternativeName:string;branchId:string;countryId:string;stateId:string;cityId:string;contactSourceId:string};
const emptyPromotionForm:PromotionForm={name:'',alternativeName:'',branchId:'',countryId:'',stateId:'',cityId:'',contactSourceId:''};

export function ConversationsPage() {
  const { hasPermission, organizationId } = useOrganizationContext();
  const canReply = hasPermission('whatsapp.reply');
  const canEditLeads = hasPermission('leads.edit');
  const canCreateLeads = hasPermission('leads.create');
  const [chips, setChips] = useState<ChatChip[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const [conversationCursor,setConversationCursor]=useState<ConversationCursor|null>(null);
  const [loadingMoreConversations,setLoadingMoreConversations]=useState(false);
  const [unreadByChip, setUnreadByChip] = useState<Record<string, number>>({});
  const [selectedChipId, setSelectedChipId] = useState<string | null>(null);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [contactFilter, setContactFilter] = useState<ContactFilter>('active');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search.trim(), 250);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [commercial, setCommercial] = useState<ConversationCommercialContext | null>(null);
  const [commercialLoading, setCommercialLoading] = useState(false);
  const [commercialSaving, setCommercialSaving] = useState(false);
  const [previewDueDateDraft, setPreviewDueDateDraft] = useState('');
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [promotionOpen,setPromotionOpen]=useState(false);
  const [promotionSaving,setPromotionSaving]=useState(false);
  const [promotionForm,setPromotionForm]=useState<PromotionForm>(emptyPromotionForm);
  const [promotionBranches,setPromotionBranches]=useState<PromotionOption[]>([]);
  const [promotionCountries,setPromotionCountries]=useState<PromotionOption[]>([]);
  const [promotionStates,setPromotionStates]=useState<PromotionOption[]>([]);
  const [promotionCities,setPromotionCities]=useState<PromotionOption[]>([]);
  const [promotionSources,setPromotionSources]=useState<PromotionOption[]>([]);
  const threadRef = useRef<HTMLDivElement>(null);
  const notificationTargetRef = useRef(readNotificationConversationTarget());
  const commercialRequestRef = useRef(0);
  const previewDateDirtyRef = useRef(false);
  const conversationsRequestRef = useRef(0);
  const messagesRequestRef = useRef(0);
  const conversationSyncRunningRef = useRef(false);
  const conversationSyncPendingRef = useRef(false);
  const messageSyncRunningRef = useRef(false);
  const messageSyncPendingRef = useRef(false);
  const selectedConversationIdRef = useRef<string | null>(null);
  const conversationRealtimeReadyRef = useRef(false);
  const messageRealtimeReadyRef = useRef(false);
  const unreadRefreshTimerRef = useRef<number | null>(null);
  const hiddenAtRef=useRef<number|null>(null);

  const selectedConversation = conversations.find((item) => item.id === selectedConversationId) ?? null;
  const visibleConversations = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('pt-BR');
    if (!term) return conversations;
    return conversations.filter((item) => [item.displayName, item.leadName, item.alternativeName, item.contactName, item.phone, item.remoteJid, item.lastMessagePreview]
      .some((value) => value.toLocaleLowerCase('pt-BR').includes(term)));
  }, [conversations, search]);

  useEffect(() => {
    selectedConversationIdRef.current = selectedConversationId;
  }, [selectedConversationId]);

  const toast = useCallback((item: Omit<ToastItem, 'id'>) => {
    const id = crypto.randomUUID?.() ?? String(Date.now());
    setToasts((current) => [{ id, ...item }, ...current].slice(0, 4));
    window.setTimeout(() => setToasts((current) => current.filter((entry) => entry.id !== id)), 3400);
  }, []);

  const loadChips = useCallback(async () => {
    if (!organizationId) return;
    const [next, unread] = await Promise.all([
      listChatChips(organizationId),
      listConversationUnreadCounts(organizationId),
    ]);
    setChips(next);
    setUnreadByChip(unread);
    setSelectedChipId((current) => {
      const targetChipId = notificationTargetRef.current?.chipId;
      if (targetChipId && next.some((chip) => chip.id === targetChipId)) return targetChipId;
      return current && next.some((chip) => chip.id === current) ? current : next[0]?.id ?? null;
    });
  }, [organizationId]);

  const loadConversations = useCallback(async (quiet = false) => {
    const requestId = ++conversationsRequestRef.current;
    if (!organizationId || !selectedChipId) {
      setConversations([]);
      setConversationCursor(null);
      setSelectedConversationId(null);
      if (!quiet) setLoading(false);
      return;
    }
    if (!quiet) setLoading(true);
    try {
      const page = await listConversationsPage(organizationId, selectedChipId, includeArchived, 50, contactFilter, null, debouncedSearch);
      const next=page.items;
      if (requestId !== conversationsRequestRef.current) return;
      setConversations(next);
      setConversationCursor(page.nextCursor);
      setSelectedConversationId((current) => {
        const targetConversationId = notificationTargetRef.current?.conversationId;
        if (targetConversationId && next.some((conversation) => conversation.id === targetConversationId)) {
          notificationTargetRef.current = null;
          window.sessionStorage.removeItem('crm:notification:conversation-target');
          return targetConversationId;
        }
        // Não seleciona a primeira conversa automaticamente. Abrir a Inbox não pode
        // marcar uma mensagem como lida sem uma ação explícita do operador.
        return current && next.some((conversation) => conversation.id === current) ? current : null;
      });
      setError('');
    } catch (cause) {
      if (requestId !== conversationsRequestRef.current) return;
      setError(cause instanceof Error ? cause.message : 'Falha ao carregar as conversas.');
    } finally {
      if (!quiet && requestId === conversationsRequestRef.current) setLoading(false);
    }
  }, [organizationId, selectedChipId, includeArchived, contactFilter, debouncedSearch]);

  const loadMoreConversations=useCallback(async()=>{
    if(!organizationId||!selectedChipId||!conversationCursor||loadingMoreConversations)return;
    setLoadingMoreConversations(true);
    try{
      const page=await listConversationsPage(organizationId,selectedChipId,includeArchived,50,contactFilter,conversationCursor,debouncedSearch);
      setConversations((current)=>{const byId=new Map(current.map((item)=>[item.id,item]));for(const item of page.items)byId.set(item.id,item);return [...byId.values()];});
      setConversationCursor(page.nextCursor);
    }catch(cause){setError(cause instanceof Error?cause.message:'Falha ao carregar mais conversas.');}
    finally{setLoadingMoreConversations(false);}
  },[contactFilter,conversationCursor,debouncedSearch,includeArchived,loadingMoreConversations,organizationId,selectedChipId]);

  const loadMessages = useCallback(async (conversationId: string | null, quiet = false) => {
    const requestId = ++messagesRequestRef.current;
    if (!organizationId || !conversationId) {
      setMessages([]);
      setHasOlderMessages(false);
      return;
    }
    try {
      const next = await listConversationMessages(organizationId, conversationId, MESSAGE_PAGE_SIZE);
      if (requestId !== messagesRequestRef.current || selectedConversationIdRef.current !== conversationId) return;
      setMessages((current) => {
        if (!quiet || current.length <= MESSAGE_PAGE_SIZE) return next;
        const byId = new Map(current.map((item) => [item.id, item]));
        next.forEach((item) => byId.set(item.id, item));
        return sortConversationMessages([...byId.values()]);
      });
      if (!quiet) setHasOlderMessages(next.length >= MESSAGE_PAGE_SIZE);
      if (!quiet) window.requestAnimationFrame(() => threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight }));
    } catch (cause) {
      if (requestId !== messagesRequestRef.current) return;
      setError(cause instanceof Error ? cause.message : 'Falha ao carregar as mensagens.');
    }
  }, [organizationId]);

  const loadOlderMessages = useCallback(async () => {
    if (!organizationId || !selectedConversationId || loadingOlderMessages || !messages.length) return;
    const numericIds = messages.map((item) => Number(item.id)).filter(Number.isSafeInteger);
    const beforeId = numericIds.length ? String(Math.min(...numericIds)) : null;
    if (!beforeId) { setHasOlderMessages(false); return; }
    setLoadingOlderMessages(true);
    try {
      const older = await listConversationMessages(organizationId, selectedConversationId, MESSAGE_PAGE_SIZE, beforeId);
      setMessages((current) => {
        const byId = new Map(current.map((item) => [item.id, item]));
        older.forEach((item) => byId.set(item.id, item));
        return sortConversationMessages([...byId.values()]);
      });
      setHasOlderMessages(older.length >= MESSAGE_PAGE_SIZE);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao carregar o histórico anterior.');
    } finally {
      setLoadingOlderMessages(false);
    }
  }, [loadingOlderMessages, messages, organizationId, selectedConversationId]);

  const loadCommercial = useCallback(async (conversationId: string | null, quiet = false) => {
    const requestId = ++commercialRequestRef.current;
    if (!conversationId) {
      setCommercial(null);
      setPreviewDueDateDraft('');
      previewDateDirtyRef.current = false;
      return;
    }
    if (!quiet) setCommercialLoading(true);
    try {
      const next = await getConversationCommercial(conversationId);
      if (commercialRequestRef.current !== requestId) return;
      setCommercial(next);
      if (!previewDateDirtyRef.current) setPreviewDueDateDraft(next.previewDueDate || '');
    } catch (cause) {
      if (commercialRequestRef.current !== requestId) return;
      if (!quiet) setError(cause instanceof Error ? cause.message : 'Falha ao carregar o estágio comercial.');
    } finally {
      if (!quiet && commercialRequestRef.current === requestId) setCommercialLoading(false);
    }
  }, []);

  const loadUnreadCounts = useCallback(async () => {
    if (!organizationId) return;
    const unread = await listConversationUnreadCounts(organizationId);
    setUnreadByChip(unread);
  }, [organizationId]);

  const syncConversationList = useCallback(async () => {
    if (!organizationId || !selectedChipId) return;
    if (conversationSyncRunningRef.current) {
      conversationSyncPendingRef.current = true;
      return;
    }
    conversationSyncRunningRef.current = true;
    try {
      do {
        conversationSyncPendingRef.current = false;
        await loadConversations(true);
      } while (conversationSyncPendingRef.current);
    } finally {
      conversationSyncRunningRef.current = false;
    }
  }, [loadConversations, organizationId, selectedChipId]);

  const syncSelectedMessages = useCallback(async () => {
    if (!organizationId) return;
    if (messageSyncRunningRef.current) {
      messageSyncPendingRef.current = true;
      return;
    }
    messageSyncRunningRef.current = true;
    try {
      do {
        messageSyncPendingRef.current = false;
        await loadMessages(selectedConversationIdRef.current, true);
      } while (messageSyncPendingRef.current);
    } finally {
      messageSyncRunningRef.current = false;
    }
  }, [loadMessages, organizationId]);

  const refresh = useCallback(async (quiet = false) => {
    if (!organizationId) return;
    if (!quiet) setLoading(true);
    try {
      // Atualiza primeiro o que o operador está vendo. Chips/contadores são
      // secundários e não entram mais no mesmo burst de requisições.
      if (selectedChipId) await loadConversations(true);
      if (selectedConversationId) await loadMessages(selectedConversationId, true);
      void loadChips().catch(() => undefined);
      if (selectedConversationId) void loadCommercial(selectedConversationId, true);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao atualizar o chat.');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [loadChips, loadCommercial, loadConversations, loadMessages, organizationId, selectedChipId, selectedConversationId]);

  // Carrega chips primeiro; a conversa só é consultada quando existe chip selecionado.
  useEffect(() => {
    void loadChips().catch((cause) => setError(cause instanceof Error ? cause.message : 'Falha ao carregar chips.'));
  }, [loadChips]);

  useEffect(() => {
    if (!selectedChipId) return;
    void loadConversations();
  }, [loadConversations, selectedChipId]);

  useEffect(() => {
    previewDateDirtyRef.current = false;
    setCommercial(null);
    setPreviewDueDateDraft('');
    void Promise.all([loadMessages(selectedConversationId), loadCommercial(selectedConversationId)]);
    if (selectedConversationId) {
      if (!organizationId) return;
      void markConversationRead(organizationId, selectedConversationId).then(() => {
        setConversations((current) => current.map((item) => item.id === selectedConversationId ? { ...item, unreadCount: 0 } : item));
        const selected = conversations.find((item) => item.id === selectedConversationId);
        const chipId = selected?.chipId;
        if (chipId) setUnreadByChip((current) => ({ ...current, [chipId]: Math.max(0, (current[chipId] ?? 0) - (selected?.unreadCount ?? 0)) }));
      }).catch(() => undefined);
    }
  }, [loadCommercial, loadMessages, organizationId, selectedConversationId]);

  useEffect(() => {
    if (!organizationId) return;
    const client = getSupabaseClient();
    let cancelled = false;
    let conversationChannel: ReturnType<typeof client.channel> | null = null;
    let messageChannel: ReturnType<typeof client.channel> | null = null;

    const scheduleUnreadRefresh = () => {
      if (unreadRefreshTimerRef.current !== null) window.clearTimeout(unreadRefreshTimerRef.current);
      unreadRefreshTimerRef.current = window.setTimeout(() => {
        unreadRefreshTimerRef.current = null;
        if (!cancelled && document.visibilityState === 'visible') void loadUnreadCounts().catch(() => undefined);
      }, 1_200);
    };

    const applyConversationDelta = async (conversationId:string) => {
      try {
        const delta=await getConversationDelta(organizationId,conversationId);
        if(cancelled)return;
        setConversations((current)=>{
          const without=current.filter((item)=>item.id!==conversationId);
          if(!delta)return without;
          const visibleChip=!selectedChipId||delta.chipId===selectedChipId;
          const visibleArchive=includeArchived?delta.status==='archived':delta.status==='open';
          const visibleState=contactFilter==='ignored'?delta.contactState==='ignored':delta.contactState!=='ignored';
          if(!visibleChip||!visibleArchive||!visibleState)return without;
          return [...without,delta].sort((left,right)=>{
            const leftAt=left.lastMessageAt?new Date(left.lastMessageAt).getTime():0;
            const rightAt=right.lastMessageAt?new Date(right.lastMessageAt).getTime():0;
            return rightAt-leftAt||Number(right.id)-Number(left.id);
          });
        });
      } catch { /* fallback timer reconcilia apenas se Realtime cair */ }
    };

    const handleConversationChange = (payload: { eventType?: string; new?: Record<string, unknown>; old?: Record<string, unknown> }) => {
      const row=payload.new&&Object.keys(payload.new).length?payload.new:payload.old??{};
      const conversationId=String(row.conversations_id??'').trim();
      if(!conversationId)return;
      scheduleUnreadRefresh();
      void applyConversationDelta(conversationId);
    };

    const handleMessageChange = (payload: { new?: Record<string, unknown>; old?: Record<string, unknown> }) => {
      const row = payload.new && Object.keys(payload.new).length ? payload.new : payload.old ?? {};
      const conversationId = String(row.conversations_id ?? '').trim();
      if (!conversationId || conversationId !== selectedConversationIdRef.current) return;
      const message = mapConversationMessageRow(row);
      if (!message.id) return;
      const thread = threadRef.current;
      const stickToBottom = !thread || thread.scrollHeight - thread.scrollTop - thread.clientHeight < 120;
      setMessages((current) => {
        const byId = new Map(current.map((item) => [item.id, item]));
        byId.set(message.id, message);
        return sortConversationMessages([...byId.values()]);
      });
      if (stickToBottom) window.requestAnimationFrame(() => threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight }));
    };

    const conversationFilter = `organizations_id=eq.${organizationId}`;
    conversationChannel = client.channel(`crm-conversations-list-${organizationId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'conversations', filter: conversationFilter }, handleConversationChange)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversations', filter: conversationFilter }, handleConversationChange);
    conversationChannel.subscribe((status) => {
      conversationRealtimeReadyRef.current = status === 'SUBSCRIBED';
    });

    if (selectedConversationId) {
      const messageFilter = `conversations_id=eq.${selectedConversationId}`;
      messageChannel = client.channel(`crm-conversation-messages-${organizationId}-${selectedConversationId}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'conversation_messages', filter: messageFilter }, handleMessageChange)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversation_messages', filter: messageFilter }, handleMessageChange);
      messageChannel.subscribe((status) => {
        messageRealtimeReadyRef.current = status === 'SUBSCRIBED';
      });
    } else {
      messageRealtimeReadyRef.current = true;
    }

    const fallbackTimer = window.setInterval(() => {
      if (cancelled || document.visibilityState !== 'visible') return;
      if (!conversationRealtimeReadyRef.current) {
        void syncConversationList();
        void loadUnreadCounts().catch(() => undefined);
      }
      if (!messageRealtimeReadyRef.current) void syncSelectedMessages();
    }, 15_000);

    const onVisibilityChange = () => {
      if(document.visibilityState==='hidden'){hiddenAtRef.current=Date.now();return;}
      const hiddenFor=hiddenAtRef.current?Date.now()-hiddenAtRef.current:0;
      hiddenAtRef.current=null;
      if(hiddenFor>120_000){
        void syncConversationList();
        void syncSelectedMessages();
        void loadUnreadCounts().catch(()=>undefined);
      }
    };
    window.addEventListener('focus', onVisibilityChange);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      conversationRealtimeReadyRef.current = false;
      messageRealtimeReadyRef.current = false;
      if (unreadRefreshTimerRef.current !== null) {
        window.clearTimeout(unreadRefreshTimerRef.current);
        unreadRefreshTimerRef.current = null;
      }
      window.clearInterval(fallbackTimer);
      window.removeEventListener('focus', onVisibilityChange);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (conversationChannel) void client.removeChannel(conversationChannel);
      if (messageChannel) void client.removeChannel(messageChannel);
    };
  }, [contactFilter, includeArchived, loadUnreadCounts, organizationId, selectedChipId, selectedConversationId, syncConversationList, syncSelectedMessages]);

  useEffect(() => {
    if (!threadRef.current) return;
    threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [selectedConversationId]);

  const openPromotionDrawer=async()=>{
    if(!organizationId||!selectedConversation||!canCreateLeads)return;
    try{
      const [branches,countries,sources]=await Promise.all([listPromotionBranches(organizationId),listPromotionCountries(),listPromotionContactSources(organizationId)]);
      const brazil=countries.find((item)=>item.name.toLocaleLowerCase('pt-BR')==='brasil')??countries[0];
      const source=sources.find((item)=>/whatsapp|manual/i.test(`${item.key??''} ${item.name}`))??sources[0];
      setPromotionBranches(branches);setPromotionCountries(countries);setPromotionSources(sources);
      setPromotionForm({name:selectedConversation.contactName||selectedConversation.displayName||selectedConversation.phone||'Contato WhatsApp',alternativeName:'',branchId:'',countryId:brazil?.id??'',stateId:'',cityId:'',contactSourceId:source?.id??''});
      setPromotionOpen(true);
    }catch(cause){setError(cause instanceof Error?cause.message:'Falha ao preparar cadastro do lead.');}
  };

  useEffect(()=>{if(!promotionOpen||!promotionForm.countryId){setPromotionStates([]);return;}void listPromotionStates(promotionForm.countryId).then(setPromotionStates).catch(()=>setPromotionStates([]));},[promotionOpen,promotionForm.countryId]);
  useEffect(()=>{if(!promotionOpen||!promotionForm.stateId){setPromotionCities([]);return;}void listPromotionCities(promotionForm.stateId).then(setPromotionCities).catch(()=>setPromotionCities([]));},[promotionOpen,promotionForm.stateId]);

  const handleIgnoreContact=async()=>{if(!organizationId||!selectedConversation||!canReply)return;try{await ignoreConversationContact(organizationId,selectedConversation.id);setConversations((current)=>current.filter((item)=>item.id!==selectedConversation.id));setSelectedConversationId(null);toast({title:'Contato ignorado',description:'Novas mensagens deste contato serão descartadas operacionalmente.',tone:'success'});}catch(cause){setError(cause instanceof Error?cause.message:'Falha ao ignorar contato.');}};
  const handleRestoreContact=async()=>{if(!organizationId||!selectedConversation||!canReply)return;try{await restoreConversationContact(organizationId,selectedConversation.id,selectedConversation.contactId);setConversations((current)=>current.filter((item)=>item.id!==selectedConversation.id));setSelectedConversationId(null);toast({title:'Contato restaurado',description:'Mensagens futuras voltarão a entrar como Não cadastrado.',tone:'success'});}catch(cause){setError(cause instanceof Error?cause.message:'Falha ao restaurar contato.');}};
  const handlePromoteContact=async()=>{if(!organizationId||!selectedConversation||promotionSaving)return;setPromotionSaving(true);try{await promoteConversationContact(organizationId,selectedConversation.id,{name:promotionForm.name,alternativeName:promotionForm.alternativeName||undefined,branchId:Number(promotionForm.branchId),countryId:Number(promotionForm.countryId),stateId:promotionForm.stateId?Number(promotionForm.stateId):null,cityId:promotionForm.cityId?Number(promotionForm.cityId):null,contactSourceId:Number(promotionForm.contactSourceId)});const delta=await getConversationDelta(organizationId,selectedConversation.id);if(delta)setConversations((current)=>current.map((item)=>item.id===delta.id?delta:item));setPromotionOpen(false);toast({title:'Lead criado',description:'A conversa e o histórico foram preservados no mesmo contato.',tone:'success'});}catch(cause){setError(cause instanceof Error?cause.message:'Falha ao cadastrar contato como lead.');}finally{setPromotionSaving(false);}};

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
      // O envio já foi aceito pelo backend/provider. A reconciliação visual é
      // secundária e jamais pode transformar um envio confirmado em "Falha".
      setMessages((current) => current.filter((item) => item.id !== optimisticId));
      void loadMessages(selectedConversation.id, true).catch(() => undefined);
      setError('');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Falha ao enviar a mensagem.';
      setMessages((current) => current.map((item) => item.id === optimisticId ? { ...item, status: 'failed', errorMessage: message } : item));
      setError(message);
    } finally { setSending(false); }
  };

  const handleArchive = async () => {
    if (!canReply || !organizationId) return;
    if (!selectedConversation) return;
    try {
      await setConversationArchived(organizationId, selectedConversation.id, selectedConversation.status !== 'archived', selectedConversation.version);
      await getConversationDelta(organizationId,selectedConversation.id).then((delta)=>{if(delta)setConversations((current)=>current.map((item)=>item.id===delta.id?delta:item));});
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Falha ao alterar a conversa.'); }
  };

  const changeCommercialStage = async (nextStage: CommercialStage) => {
    if (!selectedConversation || !commercial?.editable || !canEditLeads || commercialSaving || commercial.stage === nextStage) return;
    setCommercialSaving(true);
    try {
      const next = await setConversationCommercialStage(selectedConversation.id, nextStage);
      setCommercial(next);
      setPreviewDueDateDraft(next.previewDueDate || '');
      previewDateDirtyRef.current = false;
      toast({ title: 'Estágio atualizado', description: nextStage === 'aprovado' ? 'Projeto aprovado. Ele já está disponível em Projetos.' : `Empresa movida para ${COMMERCIAL_STAGE_LABELS[nextStage]}.`, tone: 'success' });
    } catch (cause) {
      toast({ title: 'Não foi possível atualizar', description: cause instanceof Error ? cause.message : 'Tente novamente.', tone: 'danger' });
    } finally {
      setCommercialSaving(false);
    }
  };

  const savePreviewDueDate = async () => {
    if (!selectedConversation || !commercial?.previewDueDateEditable || !canEditLeads || commercialSaving) return;
    if (previewDueDateDraft && previewDueDateDraft < todayInputValue()) {
      toast({ title: 'Data inválida', description: 'A nova data prevista não pode estar no passado.', tone: 'danger' });
      return;
    }
    setCommercialSaving(true);
    try {
      const next = await setConversationPreviewDueDate(selectedConversation.id, previewDueDateDraft || null);
      setCommercial(next);
      setPreviewDueDateDraft(next.previewDueDate || '');
      previewDateDirtyRef.current = false;
      toast({ title: 'Data da prévia atualizada', description: next.previewDueDate ? `Envio previsto para ${formatDateOnly(next.previewDueDate)}.` : 'A data prevista foi removida.', tone: 'success' });
    } catch (cause) {
      toast({ title: 'Não foi possível salvar a data', description: cause instanceof Error ? cause.message : 'Tente novamente.', tone: 'danger' });
    } finally {
      setCommercialSaving(false);
    }
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
          <div className="chat-list-actions"><SelectField density="compact" value={contactFilter} options={[{value:'active',label:'Ativos'},{value:'ignored',label:'Ignorados'}]} onChange={(value)=>{setContactFilter(value as ContactFilter);setSelectedConversationId(null);}} /><label className="chat-archive-toggle"><input type="checkbox" checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)} /> Arquivadas</label></div>
        )}>
          <label className="chat-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar contato ou mensagem" /></label>
          <div className="chat-conversation-list">
            {loading && !visibleConversations.length ? <div className="chat-empty"><Clock3 size={24} /><span>Carregando...</span></div> : null}
            {!loading && !visibleConversations.length ? <div className="chat-empty"><Inbox size={26} /><span>Nenhuma conversa para este chip.</span></div> : null}
            {visibleConversations.map((conversation) => (
              <button key={conversation.id} className={`chat-conversation ${selectedConversationId === conversation.id ? 'is-active' : ''}`} onClick={() => setSelectedConversationId(conversation.id)}>
                <span className="chat-avatar">{initials(displayContact(conversation))}</span>
                <span className="chat-conversation__content">
                  <span className="chat-conversation__title"><strong>{displayContact(conversation)}</strong><time>{formatTime(conversation.lastMessageAt)}</time></span><span className="chat-conversation__state">{conversation.contactState==='unknown'?'Não cadastrado':conversation.contactState==='ignored'?'Ignorado':'Lead'}</span>
                  <span className="chat-conversation__preview">{conversation.lastMessageDirection === 'outbound' ? 'Você: ' : ''}{conversation.lastMessagePreview || 'Sem mensagens'}</span>
                </span>
                {conversation.unreadCount ? <span className="chat-badge">{conversation.unreadCount}</span> : null}
              </button>
            ))}
            {conversationCursor?<div className="chat-load-older"><Button size="sm" variant="secondary" loading={loadingMoreConversations} onClick={()=>void loadMoreConversations()}>Carregar mais conversas</Button></div>:null}
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
                {selectedConversation.contactState==='lead' && selectedConversation.leadId ? <Tag tone="primary">Empresa #{selectedConversation.leadId}</Tag> : selectedConversation.contactState==='ignored'?<Tag tone="neutral">Ignorado</Tag>:<Tag tone="neutral">Não cadastrado</Tag>}
                {selectedConversation.contactState==='unknown' ? <span className="chat-contact-actions">{canCreateLeads?<Button size="sm" onClick={()=>void openPromotionDrawer()}>Cadastrar como lead</Button>:null}{canReply?<Button size="sm" variant="secondary" onClick={()=>void handleIgnoreContact()}>Ignorar</Button>:null}</span>:null}
                {selectedConversation.contactState==='ignored'&&canReply?<span className="chat-contact-actions"><Button size="sm" variant="secondary" onClick={()=>void handleRestoreContact()}>Restaurar</Button></span>:null}
              </div>

              <div className="chat-commercial-context">
                {commercialLoading ? <div className="chat-commercial-context__loading"><Clock3 size={15} /><span>Carregando Comercial...</span></div> : null}
                {!commercialLoading && commercial && !commercial.linked ? (
                  <div className="chat-commercial-context__empty"><span>Esta conversa ainda não está vinculada a uma empresa da base.</span></div>
                ) : null}
                {!commercialLoading && commercial?.linked ? (
                  <>
                    <div className="chat-commercial-context__lead">
                      <span className="chat-commercial-context__eyebrow">Comercial</span>
                      <strong>{commercial.displayName || commercial.leadName || `Empresa #${commercial.leadId}`}</strong>
                      {commercial.alternativeName && commercial.leadName && commercial.alternativeName !== commercial.leadName ? <small>Original: {commercial.leadName}</small> : null}
                    </div>
                    <div className="chat-commercial-context__controls">
                      {commercial.stage ? (
                        commercial.allowedTransitions.length <= 1 ? (
                          <Tag tone={commercial.stage === 'aprovado' ? 'success' : commercial.stage === 'recusado' ? 'danger' : 'neutral'}>{COMMERCIAL_STAGE_LABELS[commercial.stage]}</Tag>
                        ) : (
                          <SelectField
                            className="commercial-stage-select chat-commercial-stage-select"
                            density="compact"
                            value={commercial.stage}
                            options={commercialStageOptions(commercial)}
                            disabled={!commercial.editable || !canEditLeads || commercialSaving}
                            onChange={(value) => void changeCommercialStage(value as CommercialStage)}
                          />
                        )
                      ) : <Tag tone="neutral">Comercial disponível após o envio</Tag>}

                      {commercial.stage === 'aguardando_previa' ? (
                        <div className="chat-commercial-design-date">
                          <Field
                            aria-label="Enviar prévia até"
                            density="compact"
                            type="date"
                            min={todayInputValue()}
                            value={previewDueDateDraft}
                            disabled={!commercial.previewDueDateEditable || !canEditLeads || commercialSaving}
                            onChange={(value) => { previewDateDirtyRef.current = true; setPreviewDueDateDraft(value); }}
                          />
                          {commercial.previewDueDateEditable && canEditLeads ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              iconLeft={CalendarDays}
                              loading={commercialSaving}
                              disabled={!previewDateDirtyRef.current}
                              onClick={() => void savePreviewDueDate()}
                            >Salvar data</Button>
                          ) : null}
                        </div>
                      ) : commercial.previewDueDate ? <Tag tone="neutral">Prévia: {formatDateOnly(commercial.previewDueDate)}</Tag> : null}
                    </div>
                  </>
                ) : null}
              </div>

              <div className="chat-messages" ref={threadRef}>
                {hasOlderMessages ? <div className="chat-load-older"><Button size="sm" variant="secondary" loading={loadingOlderMessages} onClick={() => void loadOlderMessages()}>Carregar mensagens anteriores</Button></div> : null}
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
      <Drawer open={promotionOpen} title="Cadastrar como lead" description="O contato canônico e a conversa serão preservados; apenas o vínculo com o novo lead será criado." onClose={()=>!promotionSaving&&setPromotionOpen(false)} footer={<><Button variant="secondary" disabled={promotionSaving} onClick={()=>setPromotionOpen(false)}>Cancelar</Button><Button loading={promotionSaving} disabled={!promotionForm.name.trim()||!promotionForm.branchId||!promotionForm.countryId||!promotionForm.contactSourceId} onClick={()=>void handlePromoteContact()}>Cadastrar lead</Button></>}>
        <div className="drawer-form"><Field label="Nome" value={promotionForm.name} onChange={(name)=>setPromotionForm((v)=>({...v,name}))}/><Field label="Nome alternativo" value={promotionForm.alternativeName} onChange={(alternativeName)=>setPromotionForm((v)=>({...v,alternativeName}))}/><Field label="WhatsApp" value={selectedConversation?.phone||''} readOnly/><label className="drawer-field"><span>Ramo</span><SelectField value={promotionForm.branchId} options={promotionBranches.map((x)=>({value:x.id,label:x.name}))} placeholder="Selecione" onChange={(branchId)=>setPromotionForm((v)=>({...v,branchId}))}/></label><label className="drawer-field"><span>País</span><SelectField value={promotionForm.countryId} options={promotionCountries.map((x)=>({value:x.id,label:x.name}))} placeholder="Selecione" onChange={(countryId)=>setPromotionForm((v)=>({...v,countryId,stateId:'',cityId:''}))}/></label><label className="drawer-field"><span>Estado</span><SelectField value={promotionForm.stateId} options={promotionStates.map((x)=>({value:x.id,label:x.name}))} placeholder="Opcional" onChange={(stateId)=>setPromotionForm((v)=>({...v,stateId,cityId:''}))}/></label><label className="drawer-field"><span>Cidade</span><SelectField value={promotionForm.cityId} options={promotionCities.map((x)=>({value:x.id,label:x.name}))} placeholder="Opcional" onChange={(cityId)=>setPromotionForm((v)=>({...v,cityId}))}/></label><label className="drawer-field"><span>Origem</span><SelectField value={promotionForm.contactSourceId} options={promotionSources.map((x)=>({value:x.id,label:x.name}))} placeholder="Selecione" onChange={(contactSourceId)=>setPromotionForm((v)=>({...v,contactSourceId}))}/></label></div>
      </Drawer>

      <ToastViewport toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((item) => item.id !== id))} />
    </div>
  );
}
