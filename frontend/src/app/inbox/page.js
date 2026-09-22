'use client';

import { useEffect, useState, useRef, useCallback, useMemo, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { io } from 'socket.io-client';
import {
  getMe, getConversations, getMessages, getAccounts, logout,
  getConversationAnalysis, generateReply, sendReply, setConversationRead,
  updateBrandDealStatus, getNotifications, toggleAutoReply,
  clearChat, deleteConversation,
} from '@/lib/api';
import { INBOX_FILTERS, getCategoryMeta, getPriorityMeta } from '@/lib/categories';
import Icon from '@/app/components/Icon';
import InboxFilterList from './InboxFilterList';
import UnsortedMessagesBanner from '@/app/components/billing/UnsortedMessagesBanner';
import NavSidebar, { NAV_DRAWER_ID } from '@/app/components/NavSidebar';
// Read-only: reused so the mobile header/drawer match AppShell's look.
// This file must never be edited from here.
import appShellStyles from '@/app/components/AppShell.module.css';
import { inbox as t, common, errors, empty, confirm as confirmCopy, nav } from '@/content/copy';
import {
  customerTypeLabel,
  recommendedActionLabel,
  brandDealStatusLabel,
  replyModeSendsAutomatically,
  messageTypePreviewLabel,
  skipReasonLabel,
} from '@/content/labels';
import { formatTime, formatTimeAgo, formatCurrency } from '@/content/format';
import { BACKEND_URL } from '@/lib/backendUrl';
import styles from './inbox.module.css';
// Stored values, unchanged. Display wording comes from content/labels.js.
const BRAND_DEAL_STATUSES = ['new', 'contacted', 'negotiating', 'confirmed', 'declined', 'expired'];

/** Classification filter matching logic for smart folders */
function matchesFolder(conv, folderId) {
  if (!conv) return false;
  switch (folderId) {
    case 'all':
      return true;
    case 'unread':
      return Boolean(conv.unread);
    case 'important':
      return Boolean(
        conv.needsAttention ||
        conv.needsHuman ||
        conv.priority === 'critical' ||
        conv.priority === 'high' ||
        (typeof conv.priorityScore === 'number' && conv.priorityScore >= 70)
      );
    case 'hot_leads':
      return (
        conv.category === 'hot_lead' ||
        conv.customerType === 'hot_lead' ||
        (typeof conv.purchaseIntent === 'number' && conv.purchaseIntent >= 80)
      );
    case 'leads':
      return (
        ['lead', 'service_inquiry', 'product_inquiry', 'pricing_inquiry', 'availability_inquiry', 'delivery_inquiry', 'hot_lead'].includes(conv.category) ||
        conv.customerType === 'lead' ||
        conv.customerType === 'hot_lead'
      );
    case 'customers':
      return (
        conv.category === 'customer' ||
        conv.customerType === 'customer'
      );
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

// TEMP (pre-Meta-review): conv.lastMessage may already be a raw `[messageType]`
// token persisted by the backend for a textless attachment message (webhook.js
// lastMessagePreview) before this fix existed, or fetched from an older row.
// Reformat it for display without touching the stored value or the socket path.
function displayPreview(lastMessage) {
  const match = typeof lastMessage === 'string' && /^\[(.+)\]$/.exec(lastMessage);
  return match ? messageTypePreviewLabel(match[1]) : lastMessage;
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
  const [generating, setGenerating] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notifUnreadCount, setNotifUnreadCount] = useState(0);
  const [mobileShowChat, setMobileShowChat] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [aiSummaryHidden, setAiSummaryHidden] = useState(false);
  const [editingAutoReply, setEditingAutoReply] = useState(false);
  const [customPromptText, setCustomPromptText] = useState('');
  const [showClearModal, setShowClearModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [convToDelete, setConvToDelete] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const messagesEndRef = useRef(null);
  const socketRef = useRef(null);
  const messageIdsRef = useRef(new Set());
  const selectedConvRef = useRef(selectedConv);

  // Keep selectedConvRef synchronized with selectedConv state
  useEffect(() => {
    selectedConvRef.current = selectedConv;
  }, [selectedConv]);

  // Compute live real-time counts for all inbox folders
  const folderCounts = useMemo(() => {
    const counts = {};
    INBOX_FILTERS.forEach(f => {
      counts[f.id] = conversations.filter(c => matchesFolder(c, f.id)).length;
    });
    return counts;
  }, [conversations]);

  // Compute conversations list filtered by active folder
  const filteredConversations = useMemo(() => {
    return conversations.filter(c => matchesFolder(c, selectedFilter));
  }, [conversations, selectedFilter]);

  // ---- Auth check + load accounts & conversations ----
  useEffect(() => {
    async function init() {
      try {
        const userData = await getMe();
        setUser(userData);

        const accountsData = await getAccounts();
        setAccounts(accountsData);

        await loadConversations(initialAccountId);

        if (initialConversationId) {
          await selectConversation(initialConversationId);
          setMobileShowChat(true);
        }

        getNotifications().then((d) => setNotifUnreadCount(d.unreadCount || 0)).catch(() => {});
      } catch (err) {
        router.push('/');
      } finally {
        setLoading(false);
      }
    }
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  // ---- Socket.io connection ----
  useEffect(() => {
    if (!user) return;

    const socket = io(BACKEND_URL, { withCredentials: true });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('join', { userId: user.id });
    });

    socket.on('new_message', handleNewMessage);
    socket.on('conversation_read', handleConversationRead);
    socket.on('analysis_completed', handleAnalysisCompleted);
    socket.on('brand_deal_detected', handleBrandDealDetected);
    socket.on('notification', () => setNotifUnreadCount((c) => c + 1));
    socket.on('chat_cleared', handleChatCleared);
    socket.on('conversation_deleted', handleConversationDeleted);

    return () => {
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // ---- Handle real-time conversation read / attention cleared ----
  const handleConversationRead = useCallback((data) => {
    if (!data?.conversationId) return;
    setConversations(prev => prev.map(c =>
      c.id === data.conversationId
        ? {
            ...c,
            unread: Boolean(data.unread),
            needsAttention: data.needsAttention !== undefined ? Boolean(data.needsAttention) : false,
            needsHuman: data.needsHuman !== undefined ? Boolean(data.needsHuman) : false,
          }
        : c
    ));
  }, []);

  // ---- Handle real-time chat cleared ----
  const handleChatCleared = useCallback((data) => {
    if (!data?.conversationId) return;
    setConversations(prev => prev.map(c =>
      c.id === data.conversationId
        ? { ...c, lastMessage: null, unread: false, needsAttention: false, needsHuman: false }
        : c
    ));
    if (selectedConvRef.current === data.conversationId) {
      setMessages([]);
      messageIdsRef.current.clear();
    }
  }, []);

  // ---- Handle real-time conversation deleted ----
  const handleConversationDeleted = useCallback((data) => {
    if (!data?.conversationId) return;
    setConversations(prev => prev.filter(c => c.id !== data.conversationId));
    if (selectedConvRef.current === data.conversationId) {
      setSelectedConv(null);
      selectedConvRef.current = null;
      setMessages([]);
      setAnalysis(null);
      setContactInfo(null);
      setMobileShowChat(false);
    }
  }, []);

  // ---- Auto-scroll to bottom on new messages ----
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // ---- Handle real-time new message from Socket.io ----
  const handleNewMessage = useCallback((data) => {
    if (!data?.conversationId || !data?.message) return;

    const currentSelectedId = selectedConvRef.current;
    const isCurrentlyOpen = currentSelectedId === data.conversationId;
    const isInbound = data.message?.direction === 'inbound';

    // 1. Update live conversation list & unread state
    setConversations(prev => {
      const existing = prev.find(c => c.id === data.conversationId);
      if (existing) {
        return prev.map(c =>
          c.id === data.conversationId
            ? {
              ...c,
              // TEMP (pre-Meta-review): friendly label instead of a raw type token —
              // see labels.js messageTypePreviewLabel().
              lastMessage: data.message.content || messageTypePreviewLabel(data.message.messageType || 'text'),
              lastMessageAt: data.message.igTimestamp || new Date().toISOString(),
              unread: isCurrentlyOpen ? false : true,
              messagingWindow: isInbound
                ? { status: 'open', canReply: true, hoursRemaining: 24 }
                : (existing.messagingWindow || { status: 'unknown', canReply: true }),
              ...(data.conversation || {}),
            }
            : c
        ).sort((a, b) => new Date(b.lastMessageAt || 0) - new Date(a.lastMessageAt || 0));
      } else {
        // New conversation arriving from new contact
        loadConversations();
        return prev;
      }
    });

    // 2. If user is currently in this open chat, append message to chat live!
    if (isCurrentlyOpen) {
      setMessages(prev => {
        if (messageIdsRef.current.has(data.message.id)) return prev;
        messageIdsRef.current.add(data.message.id);
        return [...prev, data.message];
      });
      // Mark read in background
      setConversationRead(data.conversationId).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Handle live AI analysis completion (category/priority/summary) ----
  const handleAnalysisCompleted = useCallback((data) => {
    if (!data?.conversationId) return;

    setConversations(prev => prev.map(c =>
      c.id === data.conversationId
        ? {
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
        }
        : c
    ));

    if (selectedConvRef.current === data.conversationId) {
      setAnalysis(prevAnalysis => ({
        ...(prevAnalysis || {}),
        category: data.category,
        intent: data.intent,
        customerType: data.customerType,
        leadQuality: data.leadQuality,
        purchaseIntent: data.purchaseIntent,
        riskLevel: data.riskLevel,
        scamProbability: data.scamProbability,
        reason: data.aiExplanation,
        recommendedAction: data.recommendedAction,
        needsCreatorAttention: data.needsHuman,
        priority: data.priority,
        priorityScore: data.priorityScore,
        summary: { ...(prevAnalysis?.summary || {}), summary: data.summary || prevAnalysis?.summary?.summary },
      }));
    }
  }, []);

  // ---- Handle live brand deal detection ----
  const handleBrandDealDetected = useCallback((data) => {
    if (selectedConvRef.current === data.conversationId) {
      setAnalysis(prevAnalysis => (prevAnalysis ? { ...prevAnalysis, brandDeal: data.brandDeal } : prevAnalysis));
    }
    loadConversations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Load all conversations for account ----
  async function loadConversations(accId = selectedAccountId) {
    try {
      const data = await getConversations(accId);
      setConversations(data);
    } catch (err) {
      console.error('Failed to load conversations:', err);
    }
  }

  // ---- Switch account filter ----
  async function handleAccountChange(accId) {
    setSelectedAccountId(accId);
    setSelectedConv(null);
    selectedConvRef.current = null;
    setMessages([]);
    await loadConversations(accId);
  }

  // ---- Switch folder filter (Instant client-side filter) ----
  function handleFilterChange(filterId) {
    setSelectedFilter(filterId);
  }

  // ---- Select a conversation ----
  async function selectConversation(convId) {
    setSelectedConv(convId);
    selectedConvRef.current = convId;
    setMessages([]);
    setAnalysis(null);
    setDraftText('');
    setSendError('');
    messageIdsRef.current.clear();
    setCopied(false);
    setMobileShowChat(true);

    try {
      const data = await getMessages(convId);
      const uniqueMessages = data.messages.filter(msg => {
        if (messageIdsRef.current.has(msg.id)) return false;
        messageIdsRef.current.add(msg.id);
        return true;
      });
      setMessages(uniqueMessages);
      setContactInfo(data.conversation.contact);
      setCustomPromptText(data.conversation.autoReplyPrompt || '');
      setEditingAutoReply(false);

      // The GET above marks it read server-side — reflect that optimistically.
      setConversations(prev => prev.map(c => (c.id === convId ? {
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
  }

  // ---- Toggle Auto-Reply for current conversation ----
  async function handleToggleAutoReply(overrideEnabled, overridePrompt) {
    if (!selectedConv) return;
    const currentConv = conversations.find(c => c.id === selectedConv);
    const targetEnabled = typeof overrideEnabled === 'boolean' ? overrideEnabled : !currentConv?.autoReplyEnabled;
    const targetPrompt = overridePrompt !== undefined ? overridePrompt : customPromptText;

    try {
      const res = await toggleAutoReply(selectedConv, targetEnabled, targetPrompt);
      setConversations(prev => prev.map(c => c.id === selectedConv ? { ...c, autoReplyEnabled: res.autoReplyEnabled, autoReplyPrompt: res.autoReplyPrompt } : c));
    } catch (err) {
      console.error('Failed to toggle auto-reply:', err);
      alert(errors.toggleAutomation);
    }
  }

  // ---- Logout ----
  async function handleLogout() {
    try {
      await logout().catch(() => {});
      router.push('/login');
    } catch (err) {
      console.error('Logout failed:', err);
      router.push('/login');
    }
  }

  // Reply mode is the single source of truth for whether anything is sent
  // without the user. The compose footer, the per-conversation badge, and the
  // banner below all read it, so no two of them can disagree.
  const sendsAutomatically = replyModeSendsAutomatically(user?.businessProfile?.autoReplyMode);

  const activeConvData = conversations.find(c => c.id === selectedConv);
  const activeCategory = analysis?.category || activeConvData?.category || 'other';
  const activeCategoryMeta = getCategoryMeta(activeCategory);
  const activePriorityMeta = getPriorityMeta(analysis?.priority || activeConvData?.priority);

  // Calculate real-time 24-hour messaging window from active messages
  const messagingWindow = useMemo(() => {
    let latestInbound = null;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].direction === 'inbound') {
        latestInbound = messages[i];
        break;
      }
    }
    if (latestInbound) {
      const timestamp = latestInbound.igTimestamp || latestInbound.createdAt;
      const elapsed = Date.now() - new Date(timestamp).getTime();
      const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
      if (elapsed < TWENTY_FOUR_HOURS) {
        return {
          status: 'open',
          canReply: true,
          hoursRemaining: Math.round((TWENTY_FOUR_HOURS - elapsed) / (60 * 60 * 1000) * 10) / 10,
        };
      } else {
        return { status: 'closed', canReply: false };
      }
    }
    return activeConvData?.messagingWindow || { status: 'unknown', canReply: true };
  }, [messages, activeConvData]);

  const canSend = messagingWindow?.status !== 'closed';

  function handleCopyReply(text) {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  // ---- AI: generate a draft reply (never sends) ----
  async function handleGenerateReply(regenerate = false) {
    if (!selectedConv) return;
    setGenerating(true);
    setSendError('');
    try {
      const instructions = regenerate ? 'Write a different variation than before.' : undefined;
      const result = await generateReply(selectedConv, instructions);
      setDraftText(result.text || '');
    } catch (err) {
      setSendError(err.response?.data?.error || errors.generateReply);
    } finally {
      setGenerating(false);
    }
  }

  // ---- Explicit creator action: send the message via Instagram ----
  async function handleSend() {
    if (!selectedConv || !draftText.trim() || sending) return;
    setSending(true);
    setSendError('');
    try {
      const result = await sendReply(selectedConv, draftText.trim());
      messageIdsRef.current.add(result.message.id);
      setMessages(prev => [...prev, result.message]);
      setDraftText('');
      setConversations(prev => prev.map(c => (c.id === selectedConv ? { ...c, lastMessage: result.message.content, unread: false, needsAttention: false } : c)));
    } catch (err) {
      setSendError(err.response?.data?.error || errors.sendReply);
    } finally {
      setSending(false);
    }
  }

  async function handleBrandDealStatusChange(newStatus) {
    if (!analysis?.brandDeal) return;
    try {
      const updated = await updateBrandDealStatus(analysis.brandDeal.id, newStatus);
      setAnalysis(prev => ({ ...prev, brandDeal: updated }));
    } catch (err) {
      console.error('Failed to update brand deal status:', err);
    }
  }

  // ---- Clear all messages in current conversation ----
  async function handleClearChatSubmit() {
    if (!selectedConv || actionLoading) return;
    setActionLoading(true);
    try {
      await clearChat(selectedConv);
      messageIdsRef.current.clear();
      setMessages([]);
      setConversations(prev => prev.map(c => (c.id === selectedConv ? { ...c, lastMessage: null, unread: false, needsAttention: false, needsHuman: false } : c)));
      setShowClearModal(false);
    } catch (err) {
      alert(err.response?.data?.error || errors.clearChat);
    } finally {
      setActionLoading(false);
    }
  }

  // ---- Fully delete conversation ----
  async function handleDeleteChatSubmit() {
    const targetId = convToDelete?.id || selectedConv;
    if (!targetId || actionLoading) return;
    setActionLoading(true);
    try {
      await deleteConversation(targetId);
      setConversations(prev => prev.filter(c => c.id !== targetId));
      if (selectedConv === targetId) {
        setSelectedConv(null);
        setMessages([]);
        setAnalysis(null);
        setContactInfo(null);
        setMobileShowChat(false);
      }
      setShowDeleteModal(false);
      setConvToDelete(null);
    } catch (err) {
      alert(err.response?.data?.error || errors.deleteConversation);
    } finally {
      setActionLoading(false);
    }
  }

  if (loading) {
    return (
      <div className={styles.loadingScreen} aria-busy="true" aria-label={common.loading}>
        <div className="spinner spinner-lg" />
      </div>
    );
  }

  return (
    <div className={`${styles.inboxLayout} ${mobileShowChat ? styles.showChatMobile : ''}`}>
      {/* App Nav Bar Header */}
      <header className={styles.globalNav}>
        <div className={styles.globalNavLeft}>
          <button className={styles.navBrand} onClick={() => router.push('/dashboard')}>
            <div className={styles.navBrandIcon}>
              <img src="/logo.png" alt="" className={styles.navBrandImg} />
            </div>
            <span className={styles.navBrandText}>Siffty</span>
          </button>
          <span className={styles.navBreadcrumb}>/</span>
          <span className={styles.navCurrentPage}>{t.title}</span>
        </div>

        <div className={styles.globalNavActions}>
          <button className="btn btn-ghost btn-sm" onClick={() => router.push('/dashboard')}>
            <Icon name="dashboard" size={14} /> {nav.dashboard}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => router.push('/notifications')} style={{ position: 'relative' }}>
            <Icon name="bell" size={14} /> {nav.notifications}
            {notifUnreadCount > 0 && <span className={styles.bellBadge}>{notifUnreadCount > 9 ? '9+' : notifUnreadCount}</span>}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => router.push('/settings')}>
            <Icon name="settings" size={14} /> {nav.settings}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => router.push('/profile')} id="inbox-profile-header-btn">
            <Icon name="user" size={14} /> {nav.account}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={handleLogout}>
            <Icon name="logOut" size={14} /> {nav.logOut}
          </button>
        </div>

        {/* Mobile-only header row (<=768px) — hidden on desktop/tablet via
            inbox.module.css; the row above stays exactly as it was and is
            hidden on mobile instead, rather than reworking it in place. */}
        <div className={styles.mobileHeaderLeft}>
          <button
            className={appShellStyles.menuBtn}
            onClick={() => setDrawerOpen(true)}
            aria-label={nav.openMenu}
            aria-expanded={drawerOpen}
            aria-controls={NAV_DRAWER_ID}
          >
            <Icon name="menu" size={20} />
          </button>
          <span className={styles.navCurrentPage}>{t.title}</span>
        </div>
        <div className={styles.mobileHeaderRight}>
          <button
            className={appShellStyles.headerAction}
            onClick={() => router.push('/notifications')}
            aria-label={nav.notifications}
            title={nav.notifications}
          >
            <Icon name="bell" size={18} />
            {notifUnreadCount > 0 && (
              <span className={appShellStyles.headerBadge}>{notifUnreadCount > 9 ? '9+' : notifUnreadCount}</span>
            )}
          </button>
          <button
            className={appShellStyles.headerUser}
            onClick={() => router.push('/profile')}
            title={nav.account}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 8px', borderRadius: 'var(--radius-full)' }}
          >
            <div className="avatar avatar-sm">
              {(user?.name || user?.email || 'U')[0].toUpperCase()}
            </div>
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>
              {user?.name?.split(' ')[0] || nav.account}
            </span>
          </button>
        </div>
      </header>

      <NavSidebar
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        activeRoute="/inbox"
        user={user}
        notifCount={notifUnreadCount}
        mobileOnly
        topSection={
          <InboxFilterList
            accounts={accounts}
            selectedAccountId={selectedAccountId}
            onAccountChange={(id) => { handleAccountChange(id); setDrawerOpen(false); }}
            allAccountsCount={conversations.length}
            folderCounts={folderCounts}
            selectedFilter={selectedFilter}
            onFilterChange={(id) => { handleFilterChange(id); setDrawerOpen(false); }}
            idPrefix="drawer-"
          />
        }
      />

      <div className={styles.inboxBody}>
        {/* ========================================================= */}
        {/* Column 1: Dedicated Vertical Filter Sidebar               */}
        {/* ========================================================= */}
        <aside className={styles.filterSidebar}>
          <InboxFilterList
            accounts={accounts}
            selectedAccountId={selectedAccountId}
            onAccountChange={handleAccountChange}
            allAccountsCount={conversations.length}
            folderCounts={folderCounts}
            selectedFilter={selectedFilter}
            onFilterChange={handleFilterChange}
          />

          {/* Bottom Left Corner: Profile Card Link */}
          <div className={styles.filterSidebarFooter}>
            <button
              className={styles.sidebarProfileBtn}
              onClick={() => router.push('/profile')}
              title={nav.account}
              id="inbox-sidebar-profile-btn"
            >
              <div className={styles.sidebarProfileAvatar}>
                {(user?.name || user?.email || 'U')[0].toUpperCase()}
              </div>
              <div className={styles.sidebarProfileMeta}>
                <span className={styles.sidebarProfileName}>{user?.name || nav.account}</span>
                <span className={styles.sidebarProfileSub}>{nav.accountSubtitle}</span>
              </div>
              <span className={styles.sidebarProfileArrow}><Icon name="chevronRight" size={14} /></span>
            </button>
          </div>
        </aside>

        {/* ========================================================= */}
        {/* Column 2: Squeezed Conversation List Panel                */}
        {/* ========================================================= */}
        <section className={styles.convPanel}>
          {/* Mobile Filter Bar (Visible on mobile/tablets where sidebar is hidden) */}
          <div className={styles.mobileFilterBar}>
            <div className={styles.mobileFilterScroll}>
              <button
                className={`${styles.mobileFilterChip} ${selectedAccountId === '' ? styles.mobileFilterChipActive : ''}`}
                onClick={() => handleAccountChange('')}
              >
                <Icon name="globe" size={12} /> {t.allAccounts} ({conversations.length})
              </button>
              {accounts.map(acc => (
                <button
                  key={acc.id}
                  className={`${styles.mobileFilterChip} ${selectedAccountId === acc.id ? styles.mobileFilterChipActive : ''}`}
                  onClick={() => handleAccountChange(acc.id)}
                >
                  <Icon name="instagram" size={12} /> @{acc.igUsername || 'account'}
                </button>
              ))}
              <div className={styles.mobileChipDivider} />
              {INBOX_FILTERS.map(f => {
                const count = folderCounts[f.id] ?? 0;
                return (
                  <button
                    key={f.id}
                    className={`${styles.mobileFilterChip} ${selectedFilter === f.id ? styles.mobileFilterChipActive : ''}`}
                    onClick={() => handleFilterChange(f.id)}
                  >
                    <Icon name={f.icon} size={12} /> {f.label} {count > 0 ? `(${count})` : ''}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Recent DMs the AI never read, and why — sorting must not stop silently. */}
          {user?.features?.billing && <UnsortedMessagesBanner className={styles.unsortedBanner} />}

          <div className={styles.convPanelHeader}>
            <h3 className={styles.convPanelTitle}>{t.conversations}</h3>
            <span className={styles.convPanelBadge}>
              {filteredConversations.length}
            </span>
          </div>

          <div className={styles.convList}>
            {filteredConversations.length === 0 ? (
              <div className={styles.emptyConvs}>
                <div className={styles.emptyConvsIcon}><Icon name="inbox" size={32} strokeWidth={1.5} /></div>
                <h4>{conversations.length === 0 ? empty.conversationsAll.title : empty.conversations.title}</h4>
                <p>{conversations.length === 0 ? empty.conversationsAll.body : empty.conversations.body}</p>
              </div>
            ) : (
              filteredConversations.map((conv) => {
                const meta = getCategoryMeta(conv.category);
                const prio = getPriorityMeta(conv.priority);
                return (
                  <button
                    key={conv.id}
                    className={`${styles.convItem} ${selectedConv === conv.id ? styles.convItemActive : ''}`}
                    onClick={() => selectConversation(conv.id)}
                    id={`conv-${conv.id}`}
                  >
                    <div className={styles.convAvatar}>
                      {conv.contact.profilePicUrl ? (
                        <img src={conv.contact.profilePicUrl} alt={conv.contact.username} />
                      ) : (
                        <div className={styles.convAvatarFallback}>
                          {(conv.contact.username || '?')[0].toUpperCase()}
                        </div>
                      )}
                      {conv.messagingWindow?.status === 'open' && (
                        <span className={styles.windowDot} title={t.windowOpen} />
                      )}
                    </div>
                    <div className={styles.convInfo}>
                      <div className={styles.convTopRow}>
                        <span
                          className={styles.convUsername}
                          style={conv.unread ? { fontWeight: 700 } : undefined}
                        >
                          {conv.unread && <span className={styles.unreadDot} />}
                          {conv.contact.username || conv.contact.name || 'Unknown'}
                        </span>
                        <div className={styles.convTopRight}>
                          <span className={styles.convTime}>
                            {conv.lastMessageAt ? formatTimeAgo(conv.lastMessageAt) : ''}
                          </span>
                          <button
                            className={styles.quickDeleteBtn}
                            onClick={(e) => {
                              e.stopPropagation();
                              setConvToDelete(conv);
                              setShowDeleteModal(true);
                            }}
                            aria-label={t.deleteConversation}
                            title={t.deleteConversation}
                          >
                            <Icon name="trash" size={13} />
                          </button>
                        </div>
                      </div>

                      {/* Single-Line Message Preview Row */}
                      <div className={styles.convPreviewRow}>
                        <span
                          className={`${styles.priorityIndicator} ${styles[prio.dotClass]}`}
                          title={`${prio.label} priority — scored ${conv.priorityScore || 0} out of 100`}
                        />
                        <p className={styles.convPreview}>
                          {displayPreview(conv.lastMessage) || empty.messages.title}
                        </p>
                      </div>

                      {/* Wrapped Badges / Tags Row */}
                      <div className={styles.convBadgesRow}>
                        {conv.customerType && conv.customerType !== 'unknown' && (
                          <span className={`badge ${styles.customerBadge}`}>
                            {customerTypeLabel(conv.customerType).label}
                          </span>
                        )}
                        {conv.autoReplyEnabled && sendsAutomatically && (
                          <span className={`badge ${styles.autoReplyListBadge}`} title={t.autoReplyOn}>
                            <Icon name="zap" size={11} /> {t.autoReplyOn}
                          </span>
                        )}
                        {conv.category && (
                          <span className={`badge ${styles.categoryBadge}`}>
                            <Icon name={meta.icon} size={11} /> {meta.label}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </section>

        {/* ---- Right Panel: Chat View ---- */}
        <main className={styles.chatPanel}>
          {selectedConv ? (
            <>
              {/* Chat header */}
              <div className={styles.chatHeader}>
                <div className={styles.chatHeaderLeft}>
                  <button
                    className={styles.backBtnMobile}
                    onClick={() => setMobileShowChat(false)}
                    aria-label={common.back}
                  >
                    <Icon name="arrowLeft" size={18} />
                  </button>
                  {contactInfo?.profilePicUrl ? (
                    <img src={contactInfo.profilePicUrl} alt="" className="avatar avatar-md" />
                  ) : (
                    <div className="avatar avatar-md">
                      {(contactInfo?.username || '?')[0].toUpperCase()}
                    </div>
                  )}
                  <div className={styles.chatUserMeta}>
                    <div className={styles.chatUserTitleRow}>
                      <h2 className={styles.chatUsername}>
                        {contactInfo?.username || contactInfo?.name || 'Unknown'}
                      </h2>
                      <span className={`badge ${styles.categoryBadge}`}>
                        <Icon name={activeCategoryMeta.icon} size={11} /> {activeCategoryMeta.label}
                      </span>
                      <span
                        className={`badge ${styles.priorityBadge}`}
                        title={`Scored ${activeConvData?.priorityScore || 0} out of 100`}
                      >
                        {activePriorityMeta.label} priority
                      </span>
                      {activeConvData?.customerType && activeConvData.customerType !== 'unknown' && (
                        <span className="badge" style={{ background: 'rgba(124, 58, 237, 0.1)', color: 'var(--color-primary)' }}>
                          {customerTypeLabel(activeConvData.customerType).label}
                        </span>
                      )}
                    </div>
                    {contactInfo?.name && contactInfo.name !== contactInfo.username && (
                      <span className={styles.chatRealName}>{contactInfo.name}</span>
                    )}
                  </div>
                </div>
                <div className={styles.chatHeaderRight}>
                  {/* Clear & Delete Action Buttons */}
                  <div className={styles.chatHeaderActionGroup}>
                    <button
                      className={styles.actionBtn}
                      onClick={() => setShowClearModal(true)}
                      title={confirmCopy.clearChat.body}
                      id="clear-chat-btn"
                    >
                      <Icon name="eraser" size={13} /> {t.clearChat}
                    </button>
                    <button
                      className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
                      onClick={() => {
                        setConvToDelete(activeConvData);
                        setShowDeleteModal(true);
                      }}
                      title={confirmCopy.deleteConversation.body}
                      id="delete-chat-btn"
                    >
                      <Icon name="trash" size={13} /> {common.delete}
                    </button>
                  </div>

                  {contactInfo?.username && (
                    <a
                      href={`https://instagram.com/${contactInfo.username}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-secondary btn-sm"
                      id="open-instagram-chat-btn"
                    >
                      <Icon name="externalLink" size={13} /> {t.openInInstagram}
                    </a>
                  )}
                </div>
              </div>

              {/* Needs your reply */}
              {activeConvData?.needsHuman && (
                <div className={styles.humanAttentionBanner}>
                  <Icon name="alertTriangle" size={16} />
                  <div>
                    <strong>{t.needsReplyBanner.title}:</strong>{' '}
                    {activeConvData?.aiExplanation || t.needsReplyBanner.fallback}
                  </div>
                </div>
              )}

              {/* AI Customer Intelligence & Summary Box */}
              {(analysis?.latestAnalysis || activeConvData?.aiExplanation || activeConvData?.summary || analysis?.summary?.summary) && (
                aiSummaryHidden ? (
                  <div className={styles.intelligenceCardCollapsed}>
                    <div className={styles.collapsedLeft}>
                      <span className={styles.intelligenceBadge}>
                        <Icon name="sparkle" size={12} /> {t.insights.title}
                      </span>
                      {activeConvData?.intent && (
                        <span className={styles.collapsedIntent}>
                          {t.insights.intent}: <strong>{titleCaseIntent(activeConvData.intent)}</strong>
                        </span>
                      )}
                    </div>
                    <button
                      className={styles.toggleSummaryBtn}
                      onClick={() => setAiSummaryHidden(false)}
                    >
                      <Icon name="eye" size={13} /> {t.insights.show}
                    </button>
                  </div>
                ) : (
                  <div className={styles.intelligenceCard}>
                    <div className={styles.intelligenceHeader}>
                      <div className={styles.intelligenceTitleRow}>
                        <span className={styles.intelligenceBadge}>
                          <Icon name="sparkle" size={12} /> {t.insights.title}
                        </span>
                        {activeConvData?.intent && (
                          <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                            {t.insights.intent}: <strong>{titleCaseIntent(activeConvData.intent)}</strong>
                          </span>
                        )}
                        {activeConvData?.customerType && activeConvData.customerType !== 'unknown' && (
                          <span className="badge" style={{ fontSize: '10px', padding: '1px 6px', background: 'rgba(124, 58, 237, 0.08)', color: 'var(--color-primary)' }}>
                            {customerTypeLabel(activeConvData.customerType).label}
                          </span>
                        )}
                      </div>
                      <div className={styles.intelligenceHeaderRight}>
                        <button
                          className={styles.toggleSummaryBtn}
                          onClick={() => setAiSummaryHidden(true)}
                        >
                          <Icon name="eyeOff" size={13} /> {t.insights.hide}
                        </button>
                      </div>
                    </div>

                    <div className={styles.intelligenceMetrics}>
                      <div className={styles.metricItem} title={t.insights.scoreHint}>
                        <span className={styles.metricLabel}>{t.insights.leadQuality}</span>
                        <span className={styles.metricValue}>{activeConvData?.leadQuality ?? analysis?.latestAnalysis?.leadQuality ?? 0}/100</span>
                      </div>
                      <div className={styles.metricItem} title={t.insights.scoreHint}>
                        <span className={styles.metricLabel}>{t.insights.purchaseIntent}</span>
                        <span className={styles.metricValue}>{activeConvData?.purchaseIntent ?? analysis?.latestAnalysis?.purchaseIntent ?? 0}/100</span>
                      </div>
                      {/* REMOVED-BY-COPY-AUDIT: "Match Confidence" rendered
                          `Math.round((analysis?.confidence ?? 0.95) * 100)`.
                          The API never returns `analysis.confidence` at the top
                          level, so the fallback always won and every
                          conversation displayed a fabricated, constant "95%"
                          that looked like a live measurement. Restore by
                          re-adding this block once the endpoint returns a real
                          confidence value with no hardcoded default.
                      <div className={styles.metricItem}>
                        <span className={styles.metricLabel}>Match confidence</span>
                        <span className={styles.metricValue}>{Math.round((analysis?.confidence ?? 0.95) * 100)}%</span>
                      </div>
                      */}
                      <div className={styles.metricItem}>
                        <span className={styles.metricLabel}>{t.insights.suggestedAction}</span>
                        <span className={styles.metricValue} style={{ color: 'var(--color-primary)' }}>
                          {recommendedActionLabel(
                            activeConvData?.recommendedAction ?? analysis?.latestAnalysis?.recommendedAction
                          ).label}
                        </span>
                      </div>
                    </div>

                    {(analysis?.summary?.summary || activeConvData?.summary || activeConvData?.aiExplanation || analysis?.latestAnalysis?.reason) && (
                      <div className={styles.recommendationBanner}>
                        <Icon name="sparkle" size={14} />
                        <span>
                          <strong>{t.insights.summary}:</strong>{' '}
                          {analysis?.summary?.summary || activeConvData?.summary || activeConvData?.aiExplanation || analysis?.latestAnalysis?.reason}
                        </span>
                      </div>
                    )}
                  </div>
                )
              )}

              {/* Brand Deal Panel */}
              {analysis?.brandDeal && (
                <div className={styles.brandDealCard}>
                  <div className={styles.brandDealHeader}>
                    <div className={styles.brandDealTitleRow}>
                      <span className={styles.brandDealIcon}><Icon name="handshake" size={14} /></span>
                      <strong>{t.brandDeal.title}</strong>
                    </div>
                    <select
                      className="select btn-sm"
                      value={analysis.brandDeal.status}
                      onChange={(e) => handleBrandDealStatusChange(e.target.value)}
                      aria-label={t.brandDeal.statusLabel}
                      style={{ width: 'auto', padding: '4px 28px 4px 10px', fontSize: '12px' }}
                    >
                      {BRAND_DEAL_STATUSES.map(s => (
                        <option key={s} value={s}>{brandDealStatusLabel(s).label}</option>
                      ))}
                    </select>
                  </div>
                  <div className={styles.brandDealGrid}>
                    <div className={styles.brandDealField}>
                      <span className={styles.brandDealLabel}>{t.brandDeal.brand}</span>
                      <span className={styles.brandDealValue}>{analysis.brandDeal.brandName || common.notSet}</span>
                    </div>
                    <div className={styles.brandDealField}>
                      <span className={styles.brandDealLabel}>{t.brandDeal.budget}</span>
                      <span className={styles.brandDealValue}>
                        {analysis.brandDeal.budgetAmount
                          ? formatCurrency(analysis.brandDeal.budgetAmount, analysis.brandDeal.budgetCurrency)
                          : common.notSet}
                      </span>
                    </div>
                    <div className={styles.brandDealField}>
                      <span className={styles.brandDealLabel}>{t.brandDeal.deliverables}</span>
                      <span className={styles.brandDealValue}>{analysis.brandDeal.deliverables || common.notSet}</span>
                    </div>
                    <div className={styles.brandDealField}>
                      <span className={styles.brandDealLabel}>{t.brandDeal.deadline}</span>
                      <span className={styles.brandDealValue}>{analysis.brandDeal.deadline || common.notSet}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Messages */}
              <div className={styles.messagesContainer}>
                {messages.length === 0 ? (
                  <div className={styles.noMessages}>
                    <p>{empty.messages.body}</p>
                  </div>
                ) : (
                  messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`${styles.messageBubble} ${msg.direction === 'outbound' ? styles.messageOutbound : styles.messageInbound
                        }`}
                    >
                      {msg.content && <p className={styles.messageText}>{msg.content}</p>}
                      {msg.attachmentUrl && (
                        <div className={styles.messageAttachment}>
                          {msg.messageType === 'image' ? (
                            <img src={msg.attachmentUrl} alt="Attachment sent in this conversation" />
                          ) : ['ig_reel', 'share', 'ig_post'].includes(msg.messageType) ? (
                            /* TEMP (pre-Meta-review): the original guess ('share'/'story_mention')
                               was wrong and matched almost nothing — confirmed via direct query
                               against the live database that Instagram's real attachment types for
                               a reel/post share are 'ig_reel', 'share', and 'ig_post' ('story_mention'
                               never actually occurs). These carry no usable text — show a muted
                               placeholder instead of a clickable link. 'image' and 'video' are
                               unaffected and keep rendering as before. */
                            <span className={styles.messageAttachmentPlaceholder}>Shared a reel or post</span>
                          ) : (
                            <a href={msg.attachmentUrl} target="_blank" rel="noopener noreferrer">
                              <Icon name="paperclip" size={12} /> Attachment
                            </a>
                          )}
                        </div>
                      )}
                      <span className={styles.messageTime}>
                        {formatTime(msg.igTimestamp || msg.createdAt)}
                      </span>
                      {msg.direction === 'inbound' && msg.aiStatus === 'skipped' && (
                        <span className={styles.messageSkipped}>
                          <Icon name="info" size={11} /> {skipReasonLabel(msg.aiSkipReason).label} ·{' '}
                          {skipReasonLabel(msg.aiSkipReason).description}
                        </span>
                      )}
                    </div>
                  ))
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Compose Bar */}
              <div className={styles.composeBar}>
                {messagingWindow?.status === 'closed' && (
                  <div className={styles.windowClosedWarning}>
                    <Icon name="alertTriangle" size={14} /> {t.windowClosed}
                  </div>
                )}

                <div className={styles.composeToolbar}>
                  <span className={styles.composeHint}>
                    {copied ? common.copied : t.compose.hint}
                  </span>
                  <div className={styles.composeToolbarActions}>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleGenerateReply(Boolean(draftText))}
                      disabled={generating}
                    >
                      {generating ? (
                        t.compose.generating
                      ) : draftText ? (
                        <><Icon name="refresh" size={13} /> {t.compose.regenerate}</>
                      ) : (
                        <><Icon name="sparkle" size={13} /> {t.compose.draft}</>
                      )}
                    </button>
                    {draftText && (
                      <button className="btn btn-ghost btn-sm" onClick={() => handleCopyReply(draftText)}>
                        <Icon name="copy" size={13} /> {common.copy}
                      </button>
                    )}
                  </div>
                </div>

                <textarea
                  className={styles.composeTextarea}
                  placeholder={t.compose.placeholder}
                  aria-label={t.compose.placeholder}
                  value={draftText}
                  onChange={(e) => setDraftText(e.target.value)}
                />

                <div className={styles.composeFooter}>
                  {/* Reads the account's stored reply mode rather than asserting
                      a fixed claim. The old text said drafts are never sent
                      automatically, which was false for an account set to
                      automatic. */}
                  <span className={styles.composeHint}>
                    {sendsAutomatically ? t.compose.footerAutomatic : t.compose.footerManual}
                  </span>
                  <button
                    className="btn btn-primary"
                    onClick={handleSend}
                    disabled={!draftText.trim() || sending || !canSend}
                    id="send-reply-btn"
                  >
                    {sending ? common.sending : t.compose.send}
                    <Icon name="send" size={14} />
                  </button>
                </div>
                {sendError && <div className={styles.sendError}>{sendError}</div>}
              </div>
            </>
          ) : (
            /* No conversation selected */
            <div className={styles.emptyChat}>
              <div className={styles.emptyChatIcon}>
                <Icon name="messageSquare" size={48} strokeWidth={1.5} />
              </div>
              <h2>{t.selectPrompt.title}</h2>
              <p>{t.selectPrompt.body}</p>
            </div>
          )}
        </main>
      </div>

      {/* Modal: Clear Chat Messages */}
      {showClearModal && (
        <div className={styles.modalOverlay} onClick={() => !actionLoading && setShowClearModal(false)}>
          <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <span className={styles.modalIcon}><Icon name="eraser" size={20} /></span>
              <h3 className={styles.modalTitle}>{confirmCopy.clearChat.title}</h3>
            </div>
            <p className={styles.modalBody}>
              Every message with <strong>@{contactInfo?.username || contactInfo?.name || 'this contact'}</strong> is
              removed from Siffty. The contact, lead details, and automation settings stay.
            </p>
            <div className={styles.modalActions}>
              <button
                className="btn btn-secondary btn-md"
                onClick={() => setShowClearModal(false)}
                disabled={actionLoading}
              >
                {common.cancel}
              </button>
              <button
                className="btn btn-primary btn-md"
                onClick={handleClearChatSubmit}
                disabled={actionLoading}
                id="confirm-clear-chat-btn"
              >
                {actionLoading ? common.loading : confirmCopy.clearChat.action}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Delete Full Conversation */}
      {showDeleteModal && (
        <div className={styles.modalOverlay} onClick={() => !actionLoading && setShowDeleteModal(false)}>
          <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <span className={styles.modalIcon}><Icon name="trash" size={20} /></span>
              <h3 className={styles.modalTitle}>{confirmCopy.deleteConversation.title}</h3>
            </div>
            <p className={styles.modalBody}>
              This deletes the whole conversation with{' '}
              <strong>@{convToDelete?.contact?.username || convToDelete?.contact?.name || contactInfo?.username || 'this contact'}</strong> —
              the message history, the insights, and any extracted deal details. It cannot be undone.
            </p>
            <div className={styles.modalActions}>
              <button
                className="btn btn-secondary btn-md"
                onClick={() => {
                  setShowDeleteModal(false);
                  setConvToDelete(null);
                }}
                disabled={actionLoading}
              >
                {common.cancel}
              </button>
              <button
                className={`btn btn-md ${styles.btnDanger}`}
                onClick={handleDeleteChatSubmit}
                disabled={actionLoading}
                id="confirm-delete-conv-btn"
              >
                {actionLoading ? common.deleting : confirmCopy.deleteConversation.action}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * `intent` is free text written by the analysis step, e.g.
 * `price_inquiry_reel_editing`. It is stored as written; this only makes it
 * readable at the point it is rendered.
 */
function titleCaseIntent(value) {
  if (!value) return '';
  return String(value)
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/^\w/, (c) => c.toUpperCase());
}

export default function InboxPage() {
  return (
    <Suspense fallback={
      <div className={styles.loadingScreen} aria-busy="true" aria-label={common.loading}>
        <div className="spinner spinner-lg" />
      </div>
    }>
      <InboxPageContent />
    </Suspense>
  );
}
