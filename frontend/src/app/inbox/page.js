'use client';

/**
 * Unified Inbox.
 *
 * The DATA LAYER is master's, restored verbatim in behaviour — seven socket
 * listeners, the ten-case folder matcher, the 24-hour window and its send
 * gate, per-conversation auto-reply, brand deals. Master is what runs in
 * production; this file changes how the screen looks, never what it shows or
 * how it flows.
 *
 * One payload shape is worth naming, because a previous rewrite got it wrong
 * and the failure was silent: `new_message` arrives as
 * `{ conversationId, accountId, message: {...}, contact: {...} }`, NOT as the
 * message itself. Reading it as the message gave every live DM an undefined
 * id and blank content.
 *
 * NOTHING HERE IS INVENTED. If the assistant has not classified a
 * conversation, the tag says so; if it has not scored one, the meters are
 * absent rather than showing a plausible number. There are no delivery ticks,
 * because the backend stores no delivery or read state.
 */

import { useCallback, useEffect, useMemo, useRef, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  getMe, getConversations, getMessages, getAccounts,
  getConversationAnalysis, generateReply, getDraftCredits, sendReply, setConversationRead,
  updateBrandDealStatus, getNotifications, toggleAutoReply,
  clearChat, deleteConversation,
} from '@/lib/api';
import { INBOX_FILTERS, getCategoryMeta } from '@/lib/categories';
import Icon from '@/app/components/Icon';
import AppShell from '@/app/components/ui/AppShell';
import {
  Avatar, Badge, Button, EmptyState, IconTile, Meter, Modal, Popover, PopoverItem, Select,
  Skeleton, Textarea,
} from '@/app/components/ui';
import InboxFilterList from './InboxFilterList';
import UnsortedMessagesBanner from '@/app/components/billing/UnsortedMessagesBanner';
import {
  inbox as t, settings as settingsCopy, common, errors, empty, confirm as confirmCopy,
} from '@/content/copy';
import {
  customerTypeLabel, recommendedActionLabel, brandDealStatusLabel, messageTypePreviewLabel,
  replyModeSendsAutomatically,
} from '@/content/labels';
import { formatTime, formatTimeAgo, formatCurrency } from '@/content/format';
import { createSocket } from '@/lib/socket';
import { rememberDestination } from '@/lib/pendingDestination';
import styles from './inbox.module.css';

const BRAND_DEAL_STATUSES = ['new', 'contacted', 'negotiating', 'confirmed', 'declined'];

/** One idempotency key per "Draft a reply" click — see lib/api generateReply. */
function newDraftKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return `d_${crypto.randomUUID().replace(/-/g, '')}`;
  return `d_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * labels.js tones -> Badge tones.
 *
 * Spam, scam and abusive arrive as warning/danger, but they map to NEUTRAL.
 * Warning is reserved for something the user must act on — a token expiring, a
 * reply window closing. Spam is a fact about a message, not a task.
 */
const NEUTRAL_CATEGORIES = new Set(['spam', 'scam', 'abusive']);

function categoryTone(id, tone) {
  if (NEUTRAL_CATEGORIES.has(id)) return 'neutral';
  return tone === 'positive' ? 'positive' : 'neutral';
}

function InboxPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialAccountId = searchParams.get('accountId') || '';
  const initialConversationId = searchParams.get('conversationId') || '';
  const initialFilter = searchParams.get('filter') || 'all';

  const [user, setUser] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [selectedAccountId, setSelectedAccountId] = useState(initialAccountId);
  const [selectedFilter, setSelectedFilter] = useState(initialFilter);
  const [conversations, setConversations] = useState([]);
  const [selectedConv, setSelectedConv] = useState(null);
  const [messages, setMessages] = useState([]);
  const [contactInfo, setContactInfo] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [draftText, setDraftText] = useState('');
  const [customPromptText, setCustomPromptText] = useState('');
  const [generating, setGenerating] = useState(false);
  // { remaining, unlimited, allowed, reason } while billing is on; null = no counter.
  const [draftCredits, setDraftCredits] = useState(null);
  const draftsBlocked = Boolean(draftCredits && !draftCredits.allowed);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [loading, setLoading] = useState(true);
  const [notifUnreadCount, setNotifUnreadCount] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showClearModal, setShowClearModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const [nowTs, setNowTs] = useState(() => Date.now());

  const messagesEndRef = useRef(null);
  const messageIdsRef = useRef(new Set());
  const selectedConvRef = useRef(selectedConv);
  const composerRef = useRef(null);
  const detailsBtnRef = useRef(null);

  useEffect(() => { selectedConvRef.current = selectedConv; }, [selectedConv]);

  // The 24-hour window closes on the clock, not on a user action, so the
  // countdown needs its own tick. It also keeps the calculation below pure.
  useEffect(() => {
    const id = setInterval(() => setNowTs(Date.now()), 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const folderCounts = useMemo(() => {
    const counts = {};
    INBOX_FILTERS.forEach((f) => {
      counts[f.id] = conversations.filter((c) => matchesFolder(c, f.id)).length;
    });
    return counts;
  }, [conversations]);

  const filteredConversations = useMemo(
    () => conversations.filter((c) => matchesFolder(c, selectedFilter)),
    [conversations, selectedFilter],
  );

  const loadConversations = useCallback(async (accId = selectedAccountId) => {
    try {
      const data = await getConversations(accId);
      setConversations(data);
      return data;
    } catch (err) {
      console.error('Failed to load conversations:', err);
      return [];
    }
  }, [selectedAccountId]);

  const selectConversation = useCallback(async (convId) => {
    setSelectedConv(convId);
    selectedConvRef.current = convId;
    setMessages([]);
    setAnalysis(null);
    setDraftText('');
    setSendError('');
    setDrawerOpen(false);
    messageIdsRef.current.clear();
    setMobileChatOpen(true);

    try {
      const data = await getMessages(convId);
      const unique = data.messages.filter((m) => {
        if (messageIdsRef.current.has(m.id)) return false;
        messageIdsRef.current.add(m.id);
        return true;
      });
      setMessages(unique);
      setContactInfo(data.conversation.contact);
      setCustomPromptText(data.conversation.autoReplyPrompt || '');

      // The GET marks it read server-side; mirror that, and carry across the
      // fields only the detail endpoint returns.
      setConversations((prev) => prev.map((c) => (c.id === convId ? {
        ...c,
        unread: false,
        needsAttention: false,
        needsHuman: false,
        autoReplyEnabled: data.conversation.autoReplyEnabled,
        autoReplyPrompt: data.conversation.autoReplyPrompt,
        messagingWindow: data.conversation.messagingWindow || c.messagingWindow,
      } : c)));

      const analysisData = await getConversationAnalysis(convId).catch(() => null);
      if (analysisData) setAnalysis(analysisData);
    } catch (err) {
      console.error('Failed to load messages:', err);
    }
  }, []);

  /**
   * Open the first conversation in a folder so the chat pane is not empty.
   * Called at load and on account change rather than from an effect watching
   * the list, which would re-select on every socket update. Skipped on a phone,
   * where selecting replaces the list.
   */
  const autoSelectFirst = useCallback((rows, folderId) => {
    if (typeof window !== 'undefined' && window.innerWidth < 768) return;
    const first = (rows || []).find((c) => matchesFolder(c, folderId));
    if (first) selectConversation(first.id);
  }, [selectConversation]);

  /* ---------------- Socket handlers: master's, verbatim ---------------- */

  const handleNewMessage = useCallback((data) => {
    if (!data?.conversationId || !data?.message) return;
    const isOpen = selectedConvRef.current === data.conversationId;
    const isInbound = data.message?.direction === 'inbound';

    setConversations((prev) => {
      const existing = prev.find((c) => c.id === data.conversationId);
      if (!existing) {
        loadConversations();
        return prev;
      }
      return prev
        .map((c) => (c.id === data.conversationId ? {
          ...c,
          lastMessage: data.message.content || messageTypePreviewLabel(data.message.messageType || 'text'),
          lastMessageAt: data.message.igTimestamp || new Date().toISOString(),
          unread: !isOpen,
          messagingWindow: isInbound
            ? { status: 'open', canReply: true, hoursRemaining: 24 }
            : (existing.messagingWindow || { status: 'unknown', canReply: true }),
          ...(data.conversation || {}),
        } : c))
        .sort((a, b) => new Date(b.lastMessageAt || 0) - new Date(a.lastMessageAt || 0));
    });

    if (isOpen) {
      setMessages((prev) => {
        if (messageIdsRef.current.has(data.message.id)) return prev;
        messageIdsRef.current.add(data.message.id);
        return [...prev, data.message];
      });
      setConversationRead(data.conversationId).catch(() => {});
    }
  }, [loadConversations]);

  const handleConversationRead = useCallback((data) => {
    if (!data?.conversationId) return;
    setConversations((prev) => prev.map((c) => (c.id === data.conversationId ? {
      ...c,
      unread: Boolean(data.unread),
      needsAttention: data.needsAttention !== undefined ? Boolean(data.needsAttention) : false,
      needsHuman: data.needsHuman !== undefined ? Boolean(data.needsHuman) : false,
    } : c)));
  }, []);

  const handleAnalysisCompleted = useCallback((data) => {
    if (!data?.conversationId) return;
    setConversations((prev) => prev.map((c) => (c.id === data.conversationId ? {
      ...c,
      category: data.category || c.category,
      intent: data.intent || c.intent,
      customerType: data.customerType || c.customerType,
      leadQuality: data.leadQuality ?? c.leadQuality,
      purchaseIntent: data.purchaseIntent ?? c.purchaseIntent,
      riskLevel: data.riskLevel || c.riskLevel,
      scamProbability: data.scamProbability ?? c.scamProbability,
      aiExplanation: data.aiExplanation || c.aiExplanation,
      recommendedAction: data.recommendedAction || c.recommendedAction,
      needsHuman: data.needsHuman ?? c.needsHuman,
      priority: data.priority || c.priority,
      priorityScore: data.priorityScore ?? c.priorityScore,
      needsAttention: data.needsAttention ?? c.needsAttention,
      summary: data.summary || c.summary,
    } : c)));

    if (selectedConvRef.current === data.conversationId) {
      setAnalysis((prev) => ({
        ...(prev || {}),
        category: data.category,
        priority: data.priority,
        priorityScore: data.priorityScore,
        latestAnalysis: { ...(prev?.latestAnalysis || {}), recommendedAction: data.recommendedAction },
        summary: { ...(prev?.summary || {}), summary: data.summary || prev?.summary?.summary },
      }));
    }
  }, []);

  const handleBrandDealDetected = useCallback((data) => {
    if (selectedConvRef.current === data?.conversationId) {
      setAnalysis((prev) => (prev ? { ...prev, brandDeal: data.brandDeal } : prev));
    }
    loadConversations();
  }, [loadConversations]);

  const handleChatCleared = useCallback((data) => {
    if (!data?.conversationId) return;
    setConversations((prev) => prev.map((c) => (c.id === data.conversationId
      ? { ...c, lastMessage: null, unread: false, needsAttention: false, needsHuman: false }
      : c)));
    if (selectedConvRef.current === data.conversationId) {
      setMessages([]);
      messageIdsRef.current.clear();
    }
  }, []);

  const handleConversationDeleted = useCallback((data) => {
    if (!data?.conversationId) return;
    setConversations((prev) => prev.filter((c) => c.id !== data.conversationId));
    if (selectedConvRef.current === data.conversationId) {
      setSelectedConv(null);
      selectedConvRef.current = null;
      setMessages([]);
      setAnalysis(null);
      setContactInfo(null);
      setMobileChatOpen(false);
    }
  }, []);

  /* ---------------------------- Bootstrap ----------------------------- */

  useEffect(() => {
    async function init() {
      try {
        const userData = await getMe();
        // Same guard the shared AppShell applies. The inbox uses ui/AppShell
        // and passes `user` in, so it does its own check rather than being
        // covered by that one.
        if (!userData?.onboardingCompleted) {
          rememberDestination();
          router.replace('/onboarding');
          return;
        }
        setUser(userData);
        // Draft credits: only while billing is on; null (billing off) = no counter.
        if (userData?.features?.billing) getDraftCredits().then(setDraftCredits).catch(() => {});
        setAccounts(await getAccounts());

        const rows = await loadConversations(initialAccountId);
        if (initialConversationId) await selectConversation(initialConversationId);
        else autoSelectFirst(rows, initialFilter);

        getNotifications().then((d) => setNotifUnreadCount(d.unreadCount || 0)).catch(() => {});
      } catch (err) {
        router.push('/login');
      } finally {
        setLoading(false);
      }
    }
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  /**
   * After a dropped connection, reload what the bootstrap loaded: any event
   * sent while the socket was down never arrives. The open thread only gains
   * the messages it is missing, through the same id set the live handler uses —
   * reopening it via selectConversation would wipe a half-written reply. It
   * runs before the list reload because the GET marks it read server-side.
   */
  const catchUp = useCallback(async () => {
    const convId = selectedConvRef.current;
    if (convId) {
      try {
        const data = await getMessages(convId);
        if (selectedConvRef.current === convId) {
          const missed = data.messages.filter((m) => !messageIdsRef.current.has(m.id));
          missed.forEach((m) => messageIdsRef.current.add(m.id));
          if (missed.length) setMessages((prev) => [...prev, ...missed]);
        }
      } catch (err) {
        console.error('Failed to reload messages after reconnect:', err);
      }
    }
    loadConversations();
    getAccounts().then(setAccounts).catch(() => {});
    getNotifications().then((d) => setNotifUnreadCount(d.unreadCount || 0)).catch(() => {});
    if (user?.features?.billing) getDraftCredits().then(setDraftCredits).catch(() => {});
  }, [loadConversations, user]);

  useEffect(() => {
    if (!user) return undefined;
    const socket = createSocket({ onReconnect: catchUp });

    socket.on('new_message', handleNewMessage);
    socket.on('conversation_read', handleConversationRead);
    socket.on('analysis_completed', handleAnalysisCompleted);
    socket.on('brand_deal_detected', handleBrandDealDetected);
    socket.on('notification', () => setNotifUnreadCount((c) => c + 1));
    socket.on('chat_cleared', handleChatCleared);
    socket.on('conversation_deleted', handleConversationDeleted);

    return () => socket.disconnect();
  }, [user, catchUp, handleNewMessage, handleConversationRead, handleAnalysisCompleted,
    handleBrandDealDetected, handleChatCleared, handleConversationDeleted]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Closing always returns focus to the button that opened the panel —
  // otherwise a keyboard user is dropped at the top of the document.
  const openDrawer = useCallback((e) => {
    detailsBtnRef.current = e?.currentTarget || null;
    setDrawerOpen(true);
  }, []);

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    // Back to whichever control opened it — the status line and the Details
    // button both do, and landing on the other one is disorienting.
    detailsBtnRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!drawerOpen) return undefined;
    function onKey(e) { if (e.key === 'Escape') closeDrawer(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawerOpen, closeDrawer]);

  /* ----------------------------- Actions ------------------------------ */

  async function handleAccountChange(accId) {
    setSelectedAccountId(accId);
    setSelectedConv(null);
    selectedConvRef.current = null;
    setMessages([]);
    setContactInfo(null);
    setMobileChatOpen(false);
    autoSelectFirst(await loadConversations(accId), selectedFilter);
  }

  async function handleGenerateReply() {
    if (!selectedConv || generating || draftsBlocked) return;
    setGenerating(true);
    setSendError('');
    try {
      const result = await generateReply(selectedConv, undefined, newDraftKey());
      if (result?.draftCredits) setDraftCredits(result.draftCredits);
      if (result?.text) {
        setDraftText(result.text);
        composerRef.current?.focus();
      }
    } catch (err) {
      // The server reports the counter on failures too (a failed draft costs
      // nothing; a blocked one says why).
      const body = err?.response?.data;
      if (body?.draftCredits) setDraftCredits(body.draftCredits);
      // Out of credits / no plan: the counter row says so with a billing link,
      // so no second error line.
      if (err?.response?.status === 402) return;
      // Deliberately NOT err.response.data.error. The backend returns its own
      // copy of this sentence, so the server string wins and any wording fix
      // here would be invisible. The server's useful half is `details`, which
      // is for the log, not for the person holding the phone.
      setSendError(errors.generateReply);
    } finally {
      setGenerating(false);
    }
  }

  async function handleSend() {
    if (!selectedConv || !draftText.trim() || sending || !canSend) return;
    setSending(true);
    setSendError('');
    try {
      const result = await sendReply(selectedConv, draftText.trim());
      messageIdsRef.current.add(result.message.id);
      setMessages((prev) => [...prev, result.message]);
      setDraftText('');
      setConversations((prev) => prev.map((c) => (c.id === selectedConv
        ? { ...c, lastMessage: result.message.content, unread: false, needsAttention: false }
        : c)));
    } catch (err) {
      setSendError(err.response?.data?.error || errors.sendReply);
    } finally {
      setSending(false);
    }
  }

  async function handleToggleAutoReply(nextEnabled, nextPrompt) {
    if (!selectedConv) return;
    try {
      const res = await toggleAutoReply(
        selectedConv,
        nextEnabled,
        nextPrompt !== undefined ? nextPrompt : customPromptText,
      );
      setConversations((prev) => prev.map((c) => (c.id === selectedConv
        ? { ...c, autoReplyEnabled: res.autoReplyEnabled, autoReplyPrompt: res.autoReplyPrompt }
        : c)));
      setCustomPromptText(res.autoReplyPrompt || '');
    } catch (err) {
      setSendError(err.response?.data?.error || errors.toggleAutomation);
    }
  }

  async function handleBrandDealStatusChange(status) {
    if (!analysis?.brandDeal) return;
    try {
      const updated = await updateBrandDealStatus(analysis.brandDeal.id, status);
      setAnalysis((prev) => ({ ...prev, brandDeal: updated }));
    } catch (err) {
      console.error('Failed to update brand deal status:', err);
    }
  }

  async function handleClearChat() {
    if (!selectedConv || actionLoading) return;
    setActionLoading(true);
    try {
      await clearChat(selectedConv);
      messageIdsRef.current.clear();
      setMessages([]);
      setConversations((prev) => prev.map((c) => (c.id === selectedConv
        ? { ...c, lastMessage: null, unread: false, needsAttention: false, needsHuman: false }
        : c)));
    } catch (err) {
      setSendError(err.response?.data?.error || errors.clearChat);
    } finally {
      setActionLoading(false);
      setShowClearModal(false);
    }
  }

  async function handleDeleteConversation() {
    if (!selectedConv || actionLoading) return;
    setActionLoading(true);
    try {
      await deleteConversation(selectedConv);
      setConversations((prev) => prev.filter((c) => c.id !== selectedConv));
      setSelectedConv(null);
      selectedConvRef.current = null;
      setMessages([]);
      setAnalysis(null);
      setContactInfo(null);
      setMobileChatOpen(false);
    } catch (err) {
      setSendError(err.response?.data?.error || errors.deleteConversation);
    } finally {
      setActionLoading(false);
      setShowDeleteModal(false);
    }
  }

  /* --------------------------- Derived view --------------------------- */

  const activeConv = conversations.find((c) => c.id === selectedConv);
  const contactName = contactInfo?.name || contactInfo?.username
    || activeConv?.contact?.name || activeConv?.contact?.username || '';

  const activeCategory = analysis?.category || activeConv?.category || null;
  const categoryMeta = activeCategory ? getCategoryMeta(activeCategory) : null;
  const rawIntentMeta = activeConv?.intent ? getCategoryMeta(activeConv.intent) : null;
  const intentMeta = rawIntentMeta && rawIntentMeta.id !== 'other' ? rawIntentMeta : null;
  const customerType = activeConv?.customerType && activeConv.customerType !== 'unknown'
    ? customerTypeLabel(activeConv.customerType) : null;
  const recommendedAction = activeConv?.recommendedAction || analysis?.latestAnalysis?.recommendedAction || null;
  const brandDeal = analysis?.brandDeal || null;
  const autoReplyEnabled = activeConv?.autoReplyEnabled;
  const summaryText = analysis?.summary?.summary || null;
  const aiExplanation = activeConv?.aiExplanation || analysis?.latestAnalysis?.aiExplanation || null;

  // Instagram rejects a send outside 24h of the last inbound message, so the
  // composer is disabled rather than letting the user hit an API error.
  //
  // Computed inline rather than memoised: it is a reverse scan of one
  // conversation's messages, and memoising it meant depending on `activeConv`,
  // which the React Compiler refuses to treat as stable.
  const messagingWindow = computeMessagingWindow(messages, activeConv, nowTs);

  const canSend = messagingWindow.status !== 'closed';
  const sendsAutomatically = replyModeSendsAutomatically(user?.businessProfile?.autoReplyMode);

  const autoReplyText = autoReplyEnabled === true
    ? t.autoReplyOn
    : autoReplyEnabled === false
      ? t.autoReplyOff
      : settingsCopy.perConversation.title;

  const folderLabel = INBOX_FILTERS.find((f) => f.id === selectedFilter)?.label
    || (selectedFilter && selectedFilter !== 'all' ? getCategoryMeta(selectedFilter).label : null)
    || INBOX_FILTERS[0].label;

  const hasDetails = Boolean(
    summaryText || categoryMeta || customerType || brandDeal || recommendedAction
    || typeof activeConv?.leadQuality === 'number'
    || typeof activeConv?.purchaseIntent === 'number',
  );

  return (
    <AppShell
      user={user}
      title={t.title}
      activeRoute="/inbox"
      variant="full"
      notificationCount={notifUnreadCount}
      navCounts={{ '/inbox': folderCounts.unread ?? 0, '/notifications': notifUnreadCount }}
    >
      <div className={`${styles.layout} ${mobileChatOpen ? styles.mobileChatOpen : ''}`}>
        {/* ---------- Folders ---------- */}
        <aside className={styles.folders} aria-label={t.folders}>
          <InboxFilterList
            accounts={accounts}
            selectedAccountId={selectedAccountId}
            onAccountChange={handleAccountChange}
            allAccountsCount={conversations.length}
            folderCounts={folderCounts}
            selectedFilter={selectedFilter}
            onFilterChange={setSelectedFilter}
          />
        </aside>

        {/* ---------- Conversation list ---------- */}
        <section className={styles.list} aria-label={t.conversations}>
          <div className={styles.listHeader}>
            <h2 className={styles.listTitle}>{folderLabel}</h2>
            <span className={styles.listCount}>{filteredConversations.length}</span>
          </div>

          {/* Below 1280px the folders column is hidden, so the same two
              choices move here. Without them a tablet or phone cannot change
              folder or account at all. */}
          <div className={styles.listSelects}>
            {accounts.length > 1 && (
              <Select
                aria-label={t.accounts}
                value={selectedAccountId}
                onChange={(e) => handleAccountChange(e.target.value)}
              >
                <option value="">{t.allAccounts}</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>@{a.igUsername}</option>)}
              </Select>
            )}
            <Select
              aria-label={t.folders}
              value={selectedFilter}
              onChange={(e) => setSelectedFilter(e.target.value)}
            >
              {INBOX_FILTERS.map((f) => (
                <option key={f.id} value={f.id}>{f.label} ({folderCounts[f.id] ?? 0})</option>
              ))}
            </Select>
          </div>

          {/* Recent DMs the assistant never read, and why — sorting must not
              stop silently. */}
          {user?.features?.billing && <UnsortedMessagesBanner className={styles.unsortedBanner} />}

          <div className={styles.rows}>
            {loading ? (
              <div className={styles.rowsLoading}><Skeleton lines={5} height={44} /></div>
            ) : filteredConversations.length === 0 ? (
              <EmptyState
                icon="inbox"
                title={conversations.length === 0 ? empty.conversationsAll.title : empty.conversations.title}
                body={conversations.length === 0 ? empty.conversationsAll.body : empty.conversations.body}
              />
            ) : (
              filteredConversations.map((conv) => {
                const name = conv.contact?.name || conv.contact?.username || '';
                const meta = conv.category ? getCategoryMeta(conv.category) : null;
                const type = conv.customerType && conv.customerType !== 'unknown'
                  ? customerTypeLabel(conv.customerType) : null;
                return (
                  <button
                    key={conv.id}
                    type="button"
                    className={`${styles.row} ${selectedConv === conv.id ? styles.rowActive : ''}`}
                    onClick={() => selectConversation(conv.id)}
                    aria-current={selectedConv === conv.id ? 'true' : undefined}
                  >
                    <Avatar
                      src={conv.contact?.profilePicUrl}
                      name={name}
                      contactId={conv.contact?.id}
                      size={36}
                      decorative
                    />
                    <span className={styles.rowBody}>
                      <span className={styles.rowTop}>
                        <span className={styles.rowNameWrap}>
                          {conv.unread && <span className={styles.unreadDot} />}
                          <span className={styles.rowName}>{name}</span>
                        </span>
                        {conv.lastMessageAt && (
                          <span className={styles.rowTime}>{formatTimeAgo(conv.lastMessageAt)}</span>
                        )}
                      </span>
                      <span className={styles.rowPreview}>{conv.lastMessage || empty.messages.title}</span>
                      <span className={styles.rowTags}>
                        {meta
                          ? <Badge size="sm" tone={categoryTone(meta.id, meta.tone)}>{meta.label}</Badge>
                          : <Badge size="sm" tone="neutral">{customerTypeLabel('unknown').label}</Badge>}
                        {type && (
                          <Badge size="sm" tone={type.tone === 'positive' ? 'accent' : 'neutral'}>{type.label}</Badge>
                        )}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </section>

        {/* ---------- Chat ---------- */}
        <main className={styles.chat}>
          {!selectedConv ? (
            <div className={styles.empty}>
              <EmptyState icon="inbox" title={t.selectPrompt.title} body={t.selectPrompt.body} />
            </div>
          ) : (
            <>
              <div className={styles.chatHeader}>
                <Button
                  variant="ghost"
                  size="sm"
                  iconOnly
                  className={styles.backBtn}
                  onClick={() => setMobileChatOpen(false)}
                  aria-label={t.conversations}
                >
                  <Icon name="chevronLeft" size={18} />
                </Button>

                <div className={styles.chatHeaderMain}>
                  <Avatar
                    src={contactInfo?.profilePicUrl}
                    name={contactName}
                    contactId={contactInfo?.id}
                    size={34}
                    decorative
                  />
                  <div className={styles.chatIdentity}>
                    <h2 className={styles.chatName}>{contactName}</h2>
                    {/* Auto-reply state is readable WITHOUT opening the drawer:
                        "is this chat answering on its own?" is not something to
                        make someone dig for. Clicking opens the drawer. */}
                    <button
                      type="button"
                      className={styles.chatStatus}
                      onClick={openDrawer}
                      aria-label={t.insights.show}
                      aria-expanded={drawerOpen}
                    >
                      <span>{autoReplyText}</span>
                      {brandDeal && (
                        <>
                          <span className={styles.chatStatusSep}>·</span>
                          <span>{t.brandDeal.title}</span>
                        </>
                      )}
                      <Icon name="chevronRight" size={12} />
                    </button>
                  </div>
                </div>

                <div className={styles.chatActions}>
                  <Button
                    size="sm"
                    onClick={(e) => (drawerOpen ? closeDrawer() : openDrawer(e))}
                    aria-expanded={drawerOpen}
                  >
                    {drawerOpen ? t.insights.hide : t.insights.show}
                  </Button>
                  {contactInfo?.username && (
                    <Button
                      variant="ghost"
                      size="sm"
                      iconOnly
                      onClick={() => window.open(`https://instagram.com/${contactInfo.username}`, '_blank', 'noopener,noreferrer')}
                      aria-label={t.openInInstagram}
                      title={t.openInInstagram}
                    >
                      <Icon name="instagram" size={16} />
                    </Button>
                  )}
                  <Popover
                    open={menuOpen}
                    onClose={() => setMenuOpen(false)}
                    trigger={(
                      <Button
                        variant="ghost"
                        size="sm"
                        iconOnly
                        onClick={() => setMenuOpen((v) => !v)}
                        aria-label={t.moreActions}
                        title={t.moreActions}
                      >
                        <Icon name="moreHorizontal" size={16} />
                      </Button>
                    )}
                  >
                    <PopoverItem onClick={() => { setMenuOpen(false); setShowClearModal(true); }}>
                      <Icon name="eraser" size={14} /> {t.clearChat}
                    </PopoverItem>
                    <PopoverItem danger onClick={() => { setMenuOpen(false); setShowDeleteModal(true); }}>
                      <Icon name="trash" size={14} /> {t.deleteConversation}
                    </PopoverItem>
                  </Popover>
                </div>
              </div>

              <div className={styles.chatBody}>
              <div className={styles.messages}>
                {messages.length === 0 ? (
                  <div className={styles.empty}>
                    <EmptyState title={empty.messages.title} body={empty.messages.body} />
                  </div>
                ) : messages.map((msg) => {
                  const out = msg.direction === 'outbound';
                  return (
                    <div key={msg.id} className={`${styles.msgRow} ${out ? styles.msgOut : styles.msgIn}`}>
                      {!out && (
                        <Avatar
                          src={contactInfo?.profilePicUrl}
                          name={contactName}
                          contactId={contactInfo?.id}
                          size={26}
                          decorative
                        />
                      )}
                      <div className={styles.msgCol}>
                        <div className={`${styles.bubble} ${out ? styles.bubbleOut : styles.bubbleIn}`}>
                          {msg.content || messageTypePreviewLabel(msg.messageType || 'text')}
                          {msg.attachmentUrl && (
                            <a
                              className={styles.attachment}
                              href={msg.attachmentUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <Icon name="externalLink" size={12} />
                              {messageTypePreviewLabel(msg.messageType || 'text')}
                            </a>
                          )}
                        </div>
                        {/* No delivery tick. The backend stores no delivery or
                            read state, so there is nothing truthful to show. */}
                        <span className={`${styles.msgMeta} ${out ? styles.msgMetaOut : ''}`}>
                          {formatTime(msg.igTimestamp || msg.createdAt)}
                        </span>
                      </div>
                    </div>
                  );
                })}

                {generating && (
                  <div className={styles.typing} aria-live="polite" aria-label={t.compose.generating}>
                    <span className={styles.typingDot} />
                    <span className={styles.typingDot} />
                    <span className={styles.typingDot} />
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

            {/* ---------- Details drawer ----------
                A drawer rather than a permanent fourth column: at 1280px four
                columns leave the chat about 380px wide, and for most
                conversations this panel is empty. */}
            {drawerOpen && (
              <aside className={styles.drawer} aria-label={t.insights.title}>
                <div className={styles.drawerHeader}>
                  <h2 className={styles.drawerTitle}>{t.insights.title}</h2>
                  <Button variant="ghost" size="sm" iconOnly onClick={closeDrawer} aria-label={t.insights.hide}>
                    <Icon name="x" size={16} />
                  </Button>
                </div>

                <div className={styles.drawerBody}>
                  {!hasDetails && <p className={styles.drawerText}>{t.insights.scoreHint}</p>}

                  {(categoryMeta || customerType) && (
                    <div className={styles.drawerSection}>
                      <span className={styles.drawerSectionHead}>
                        <IconTile name="target" tone="accent" />
                        <span className={styles.drawerSectionTitle}>{t.insights.intent}</span>
                      </span>
                      <p className={styles.drawerText}>
                        {(intentMeta || categoryMeta)?.description || (intentMeta || categoryMeta)?.label}
                      </p>
                      <div className={styles.rowTags}>
                        {categoryMeta && (
                          <Badge tone={categoryTone(categoryMeta.id, categoryMeta.tone)}>{categoryMeta.label}</Badge>
                        )}
                        {customerType && (
                          <Badge tone={customerType.tone === 'positive' ? 'accent' : 'neutral'}>{customerType.label}</Badge>
                        )}
                      </div>
                    </div>
                  )}

                  {(typeof activeConv?.leadQuality === 'number' || typeof activeConv?.purchaseIntent === 'number') && (
                    <div className={styles.drawerSection}>
                      <span className={styles.drawerSectionHead}>
                        <IconTile name="barChart" tone="accent" />
                        <span className={styles.drawerSectionTitle}>{t.insights.scores}</span>
                      </span>
                      {/* Meter renders nothing when the value is not a number. */}
                      <Meter label={t.insights.leadQuality} value={activeConv?.leadQuality} />
                      <Meter label={t.insights.purchaseIntent} value={activeConv?.purchaseIntent} />
                    </div>
                  )}

                  {recommendedAction && (
                    <div className={styles.drawerSection}>
                      <span className={styles.drawerSectionHead}>
                        <IconTile name="zap" tone="accent" />
                        <span className={styles.drawerSectionTitle}>{t.insights.suggestedAction}</span>
                      </span>
                      <p className={styles.drawerText}>{recommendedActionLabel(recommendedAction).label}</p>
                    </div>
                  )}

                  {summaryText && (
                    <div className={styles.drawerSection}>
                      <span className={styles.drawerSectionHead}>
                        <IconTile name="messageSquare" tone="neutral" />
                        <span className={styles.drawerSectionTitle}>{t.insights.summary}</span>
                      </span>
                      <p className={styles.drawerText}>{summaryText}</p>
                    </div>
                  )}

                  {aiExplanation && (
                    <div className={styles.drawerSection}>
                      <span className={styles.drawerSectionHead}>
                        <IconTile name="alertTriangle" tone="warning" />
                        <span className={styles.drawerSectionTitle}>{t.needsReplyBanner.title}</span>
                      </span>
                      <p className={styles.drawerText}>{aiExplanation}</p>
                    </div>
                  )}

                  {brandDeal && (
                    <div className={styles.drawerSection}>
                      <span className={styles.drawerSectionHead}>
                        <IconTile name="handshake" tone="accent" />
                        <span className={styles.drawerSectionTitle}>{t.brandDeal.title}</span>
                      </span>
                      <dl className={styles.drawerFacts}>
                        {brandDeal.brandName && (
                          <div className={styles.drawerFact}>
                            <dt>{t.brandDeal.brand}</dt><dd>{brandDeal.brandName}</dd>
                          </div>
                        )}
                        {typeof brandDeal.budgetAmount === 'number' && (
                          <div className={styles.drawerFact}>
                            <dt>{t.brandDeal.budget}</dt>
                            <dd>{formatCurrency(brandDeal.budgetAmount, brandDeal.budgetCurrency)}</dd>
                          </div>
                        )}
                        {brandDeal.deliverables && (
                          <div className={styles.drawerFact}>
                            <dt>{t.brandDeal.deliverables}</dt><dd>{brandDeal.deliverables}</dd>
                          </div>
                        )}
                      </dl>
                      <Select
                        label={t.brandDeal.statusLabel}
                        value={brandDeal.status || 'new'}
                        onChange={(e) => handleBrandDealStatusChange(e.target.value)}
                      >
                        {BRAND_DEAL_STATUSES.map((s) => (
                          <option key={s} value={s}>{brandDealStatusLabel(s).label}</option>
                        ))}
                      </Select>
                    </div>
                  )}

                  <div className={styles.drawerSection}>
                    <span className={styles.drawerSectionHead}>
                        <IconTile name="settings" tone="neutral" />
                        <span className={styles.drawerSectionTitle}>{settingsCopy.perConversation.title}</span>
                      </span>
                    <p className={styles.drawerText}>{settingsCopy.perConversation.description}</p>
                    <div className={styles.autoReplyChoices}>
                      {[
                        { value: null, label: t.autoReplyInherit },
                        { value: true, label: settingsCopy.perConversation.toggleOn },
                        { value: false, label: settingsCopy.perConversation.toggleOff },
                      ].map((opt) => (
                        <Button
                          key={String(opt.value)}
                          size="sm"
                          variant={autoReplyEnabled === opt.value ? 'primary' : 'secondary'}
                          onClick={() => handleToggleAutoReply(opt.value)}
                        >
                          {opt.label}
                        </Button>
                      ))}
                    </div>
                    <Textarea
                      label={settingsCopy.perConversation.promptLabel}
                      placeholder={settingsCopy.perConversation.promptPlaceholder}
                      value={customPromptText}
                      maxLength={500}
                      onChange={(e) => setCustomPromptText(e.target.value)}
                      onBlur={() => handleToggleAutoReply(autoReplyEnabled ?? null, customPromptText)}
                    />
                  </div>
                </div>
              </aside>
            )}
              </div>

              {messagingWindow.status === 'closed' && (
                <div className={styles.windowClosed} role="status">
                  <Icon name="clock" size={14} />
                  <span>{t.windowClosed}</span>
                </div>
              )}

              <div className={styles.composer}>
                {messagingWindow.status === 'open' && (
                  <div className={styles.windowOpen}>
                    {/* Counts down from the real last INBOUND message, re-read
                        every minute by the `nowTs` tick. */}
                    <span
                      className={`${styles.windowDot} ${messagingWindow.hoursRemaining < 1 ? styles.windowDotClosing : ''}`}
                    />
                    {t.windowOpen(messagingWindow.hoursRemaining)}
                  </div>
                )}

                <div className={styles.composerBox}>
                  <textarea
                    ref={composerRef}
                    className={styles.composerInput}
                    placeholder={canSend ? t.compose.placeholder : t.windowClosed}
                    value={draftText}
                    disabled={!canSend}
                    aria-label={t.compose.placeholder}
                    onChange={(e) => setDraftText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
                    }}
                  />
                  <div className={styles.composerActions}>
                    <div className={styles.composerLeft}>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={handleGenerateReply}
                        disabled={generating || !canSend || draftsBlocked}
                      >
                        {generating ? t.compose.generating : t.compose.draft}
                      </Button>
                      {draftCredits && (
                        draftsBlocked ? (
                          <span className={styles.draftCounter} role="status">
                            {draftCredits.reason === 'not_entitled' ? t.compose.draftsNeedPlan : t.compose.noDrafts}{' '}
                            <a className={styles.draftBuyLink} href={draftCredits.reason === 'not_entitled' ? '/billing#plans' : '/billing#draft-packs'}>
                              {draftCredits.reason === 'not_entitled' ? t.compose.seePlans : t.compose.buyDrafts}
                            </a>
                          </span>
                        ) : (
                          <span className={styles.draftCounter} aria-live="polite">
                            {draftCredits.unlimited ? t.compose.draftsUnlimited : t.compose.draftsLeft(draftCredits.remaining)}
                          </span>
                        )
                      )}
                    </div>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={handleSend}
                      disabled={!draftText.trim() || sending || !canSend}
                    >
                      {sending ? t.compose.generating : t.compose.send}
                      <Icon name="send" size={13} />
                    </Button>
                  </div>
                </div>

                <p className={styles.composerNote}>
                  {sendsAutomatically ? t.compose.footerAutomatic : t.compose.footerManual}
                </p>
                {sendError && <p className={styles.composerError} role="alert">{sendError}</p>}
              </div>
            </>
          )}

        </main>
      </div>

      {showClearModal && (
        <Modal
          title={confirmCopy.clearChat.title}
          onClose={() => setShowClearModal(false)}
          actions={(
            <>
              <Button onClick={() => setShowClearModal(false)} disabled={actionLoading}>
                {common.cancel}
              </Button>
              <Button variant="primary" onClick={handleClearChat} loading={actionLoading}>
                {t.clearChat}
              </Button>
            </>
          )}
        >
          {confirmCopy.clearChat.body}
        </Modal>
      )}

      {showDeleteModal && (
        <Modal
          title={confirmCopy.deleteConversation.title}
          onClose={() => setShowDeleteModal(false)}
          actions={(
            <>
              <Button onClick={() => setShowDeleteModal(false)} disabled={actionLoading}>
                {common.cancel}
              </Button>
              <Button variant="danger" onClick={handleDeleteConversation} loading={actionLoading}>
                {t.deleteConversation}
              </Button>
            </>
          )}
        >
          {confirmCopy.deleteConversation.body}
        </Modal>
      )}
    </AppShell>
  );
}

/**
 * The Instagram 24-hour reply window, from the last INBOUND message.
 *
 * `now` is passed in rather than read from Date.now() so this stays pure and
 * the caller controls the tick.
 */
function computeMessagingWindow(messages, activeConv, now) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].direction !== 'inbound') continue;
    const elapsed = now - new Date(messages[i].igTimestamp || messages[i].createdAt).getTime();
    const DAY = 24 * 60 * 60 * 1000;
    if (elapsed < DAY) {
      return { status: 'open', canReply: true, hoursRemaining: Math.round((DAY - elapsed) / 3600000 * 10) / 10 };
    }
    return { status: 'closed', canReply: false };
  }
  return activeConv?.messagingWindow || { status: 'unknown', canReply: true };
}

/**
 * Which folder a conversation belongs to — master's matcher, all ten cases.
 * A previous rewrite kept only six, so `important`, `leads`, `customers` and
 * `questions` fell through to `category === folderId`, matched nothing, and
 * four of the ten sidebar folders permanently read 0.
 */
function matchesFolder(conv, folderId) {
  if (!conv) return false;
  switch (folderId) {
    case 'all':
      return true;
    case 'unread':
      return Boolean(conv.unread);
    case 'important':
      return Boolean(
        conv.needsAttention || conv.needsHuman
        || conv.priority === 'critical' || conv.priority === 'high'
        || (typeof conv.priorityScore === 'number' && conv.priorityScore >= 70),
      );
    case 'hot_leads':
      return conv.category === 'hot_lead' || conv.customerType === 'hot_lead'
        || (typeof conv.purchaseIntent === 'number' && conv.purchaseIntent >= 80);
    case 'leads':
      return ['lead', 'service_inquiry', 'product_inquiry', 'pricing_inquiry',
        'availability_inquiry', 'delivery_inquiry', 'hot_lead'].includes(conv.category)
        || conv.customerType === 'lead' || conv.customerType === 'hot_lead';
    case 'customers':
      return conv.category === 'customer' || conv.customerType === 'customer';
    case 'questions':
      return conv.category === 'general_question';
    case 'support':
      return conv.category === 'support_request';
    case 'brand_deal':
      return conv.category === 'brand_deal' || conv.category === 'collaboration';
    case 'needs_human':
      return Boolean(conv.needsHuman || conv.needsAttention);
    case 'spam':
      return ['spam', 'scam', 'abusive'].includes(conv.category);
    default:
      return conv.category === folderId;
  }
}

export default function InboxPage() {
  return (
    <Suspense fallback={null}>
      <InboxPageContent />
    </Suspense>
  );
}
