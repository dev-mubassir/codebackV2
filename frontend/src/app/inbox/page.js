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
import styles from './inbox.module.css';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:5000';
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
              lastMessage: data.message.content || `[${data.message.messageType || 'text'}]`,
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
      alert('Failed to update auto-reply status');
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
      setSendError(err.response?.data?.error || 'AI reply generation is unavailable right now. You can still write your own reply below.');
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
      setSendError(err.response?.data?.error || 'Failed to send message.');
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
      alert(err.response?.data?.error || 'Failed to clear chat messages');
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
      alert(err.response?.data?.error || 'Failed to delete conversation');
    } finally {
      setActionLoading(false);
    }
  }

  if (loading) {
    return (
      <div className={styles.loadingScreen}>
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
              <img src="/logo.png" alt="Codeback Logo" className={styles.navBrandImg} />
            </div>
            <span className={styles.navBrandText}>Codeback</span>
          </button>
          <span className={styles.navBreadcrumb}>/</span>
          <span className={styles.navCurrentPage}>Inbox</span>
        </div>

        <div className={styles.globalNavActions}>
          <button className="btn btn-ghost btn-sm" onClick={() => router.push('/dashboard')}>
            📊 Dashboard
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => router.push('/notifications')} style={{ position: 'relative' }}>
            🔔 Notifications
            {notifUnreadCount > 0 && <span className={styles.bellBadge}>{notifUnreadCount > 9 ? '9+' : notifUnreadCount}</span>}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => router.push('/settings')}>
            ⚙️ Settings
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => router.push('/profile')} id="inbox-profile-header-btn">
            👤 Profile
          </button>
          <button className="btn btn-ghost btn-sm" onClick={handleLogout} title="Log out">
            🚪 Logout
          </button>
        </div>
      </header>

      <div className={styles.inboxBody}>
        {/* ========================================================= */}
        {/* Column 1: Dedicated Vertical Filter Sidebar               */}
        {/* ========================================================= */}
        <aside className={styles.filterSidebar}>
          {/* Account Filter Section */}
          <div className={styles.filterSection}>
            <span className={styles.filterSectionTitle}>Accounts</span>
            <div className={styles.filterItemList}>
              <button
                className={`${styles.filterItemBtn} ${selectedAccountId === '' ? styles.filterItemBtnActive : ''}`}
                onClick={() => handleAccountChange('')}
                id="filter-account-all"
              >
                <div className={styles.filterItemLeft}>
                  <span className={styles.filterItemIcon}>🌐</span>
                  <span className={styles.filterItemLabel}>All Accounts</span>
                </div>
                <span className={styles.filterItemCount}>{conversations.length}</span>
              </button>
              {accounts.map(acc => (
                <button
                  key={acc.id}
                  className={`${styles.filterItemBtn} ${selectedAccountId === acc.id ? styles.filterItemBtnActive : ''}`}
                  onClick={() => handleAccountChange(acc.id)}
                  id={`filter-account-${acc.id}`}
                >
                  <div className={styles.filterItemLeft}>
                    <span className={styles.filterItemIcon}>📸</span>
                    <span className={styles.filterItemLabel}>@{acc.igUsername || 'account'}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Smart Filter Folders / Categories */}
          <div className={styles.filterSection}>
            <span className={styles.filterSectionTitle}>Inbox Folders</span>
            <div className={styles.filterItemList}>
              {INBOX_FILTERS.map(f => {
                const isActive = selectedFilter === f.id;
                const count = folderCounts[f.id] ?? 0;
                return (
                  <button
                    key={f.id}
                    className={`${styles.filterItemBtn} ${isActive ? styles.filterItemBtnActive : ''}`}
                    onClick={() => handleFilterChange(f.id)}
                    id={`filter-tab-${f.id}`}
                  >
                    <div className={styles.filterItemLeft}>
                      <span className={styles.filterItemIcon}>{f.icon}</span>
                      <span className={styles.filterItemLabel}>{f.label}</span>
                    </div>
                    {count > 0 && <span className={styles.filterItemCount}>{count}</span>}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Bottom Left Corner: Profile Card Link */}
          <div className={styles.filterSidebarFooter}>
            <button
              className={styles.sidebarProfileBtn}
              onClick={() => router.push('/profile')}
              title="Manage Profile & Account"
              id="inbox-sidebar-profile-btn"
            >
              <div className={styles.sidebarProfileAvatar}>
                {(user?.name || user?.email || 'U')[0].toUpperCase()}
              </div>
              <div className={styles.sidebarProfileMeta}>
                <span className={styles.sidebarProfileName}>{user?.name || 'My Profile'}</span>
                <span className={styles.sidebarProfileSub}>Profile & Account</span>
              </div>
              <span className={styles.sidebarProfileArrow}>⚙️</span>
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
                🌐 All ({conversations.length})
              </button>
              {accounts.map(acc => (
                <button
                  key={acc.id}
                  className={`${styles.mobileFilterChip} ${selectedAccountId === acc.id ? styles.mobileFilterChipActive : ''}`}
                  onClick={() => handleAccountChange(acc.id)}
                >
                  📸 @{acc.igUsername || 'account'}
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
                    <span>{f.icon}</span> {f.label} {count > 0 ? `(${count})` : ''}
                  </button>
                );
              })}
            </div>
          </div>

          <div className={styles.convPanelHeader}>
            <h3 className={styles.convPanelTitle}>
              Conversations
            </h3>
            <span className={styles.convPanelBadge}>
              {filteredConversations.length}
            </span>
          </div>

          <div className={styles.convList}>
            {filteredConversations.length === 0 ? (
              <div className={styles.emptyConvs}>
                <div className={styles.emptyConvsIcon}>📥</div>
                <h4>No conversations found</h4>
                <p>No messages matching this folder.</p>
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
                        <span className={styles.windowDot} title="24h window open" />
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
                            title="Delete conversation"
                          >
                            🗑️
                          </button>
                        </div>
                      </div>

                      {/* Single-Line Message Preview Row */}
                      <div className={styles.convPreviewRow}>
                        <span
                          className={`${styles.priorityIndicator} ${styles[prio.dotClass]}`}
                          title={`Priority: ${prio.label} (${conv.priorityScore || 0}/100)`}
                        />
                        <p className={styles.convPreview}>
                          {conv.lastMessage || 'No messages'}
                        </p>
                      </div>

                      {/* Wrapped Badges / Tags Row */}
                      <div className={styles.convBadgesRow}>
                        {conv.customerType && conv.customerType !== 'unknown' && (
                          <span className={`badge ${styles.customerBadge}`}>
                            {conv.customerType.replace('_', ' ')}
                          </span>
                        )}
                        {conv.autoReplyEnabled && (
                          <span className={`badge ${styles.autoReplyListBadge}`} title="AI Auto-Reply active for this conversation">
                            ⚡ Auto
                          </span>
                        )}
                        {conv.category && (
                          <span className={`badge ${styles.categoryBadge}`}>
                            {meta.icon} {meta.label}
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
                    aria-label="Back to conversations"
                  >
                    ←
                  </button>
                  {contactInfo?.profilePicUrl ? (
                    <img src={contactInfo.profilePicUrl} alt={contactInfo.username} className="avatar avatar-md" />
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
                        {activeCategoryMeta.icon} {activeCategoryMeta.label}
                      </span>
                      <span className={`badge ${styles.priorityBadge}`}>
                        {activePriorityMeta.label} ({activeConvData?.priorityScore || 0})
                      </span>
                      {activeConvData?.customerType && (
                        <span className="badge" style={{ background: 'rgba(124, 58, 237, 0.1)', color: 'var(--color-primary)' }}>
                          {activeConvData.customerType.replace('_', ' ')}
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
                      title="Clear all messages in this chat"
                      id="clear-chat-btn"
                    >
                      🧹 Clear Chat
                    </button>
                    <button
                      className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
                      onClick={() => {
                        setConvToDelete(activeConvData);
                        setShowDeleteModal(true);
                      }}
                      title="Delete this entire conversation"
                      id="delete-chat-btn"
                    >
                      🗑️ Delete
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
                      ↗ Instagram
                    </a>
                  )}
                </div>
              </div>

              {/* Needs Human Attention Alert */}
              {activeConvData?.needsHuman && (
                <div className={styles.humanAttentionBanner}>
                  <span>⚠️</span>
                  <div>
                    <strong>Needs Human Attention:</strong> {activeConvData?.aiExplanation || 'Customer inquiry requiring direct human follow-up.'}
                  </div>
                </div>
              )}

              {/* AI Customer Intelligence & Summary Box */}
              {(analysis?.latestAnalysis || activeConvData?.aiExplanation || activeConvData?.summary || analysis?.summary?.summary) && (
                aiSummaryHidden ? (
                  <div className={styles.intelligenceCardCollapsed}>
                    <div className={styles.collapsedLeft}>
                      <span className={styles.intelligenceBadge}>⚡ AI Summary</span>
                      {activeConvData?.intent && (
                        <span className={styles.collapsedIntent}>
                          Intent: <strong>{activeConvData.intent}</strong>
                        </span>
                      )}
                    </div>
                    <button
                      className={styles.toggleSummaryBtn}
                      onClick={() => setAiSummaryHidden(false)}
                      title="Expand AI Summary and Lead Metrics"
                    >
                      👁️ Show AI Summary
                    </button>
                  </div>
                ) : (
                  <div className={styles.intelligenceCard}>
                    <div className={styles.intelligenceHeader}>
                      <div className={styles.intelligenceTitleRow}>
                        <span className={styles.intelligenceBadge}>⚡ AI DM Intelligence</span>
                        {activeConvData?.intent && (
                          <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                            Intent: <strong>{activeConvData.intent}</strong>
                          </span>
                        )}
                        {activeConvData?.customerType && activeConvData.customerType !== 'unknown' && (
                          <span className="badge" style={{ fontSize: '10px', padding: '1px 6px', background: 'rgba(124, 58, 237, 0.08)', color: 'var(--color-primary)' }}>
                            {activeConvData.customerType.replace('_', ' ')}
                          </span>
                        )}
                      </div>
                      <div className={styles.intelligenceHeaderRight}>
                        <button
                          className={styles.toggleSummaryBtn}
                          onClick={() => setAiSummaryHidden(true)}
                          title="Hide AI Summary for full chat view"
                        >
                          👁️ Hide
                        </button>
                      </div>
                    </div>

                    <div className={styles.intelligenceMetrics}>
                      <div className={styles.metricItem}>
                        <span className={styles.metricLabel}>Lead Quality</span>
                        <span className={styles.metricValue}>{activeConvData?.leadQuality ?? analysis?.latestAnalysis?.leadQuality ?? 0}/100</span>
                      </div>
                      <div className={styles.metricItem}>
                        <span className={styles.metricLabel}>Purchase Intent</span>
                        <span className={styles.metricValue}>{activeConvData?.purchaseIntent ?? analysis?.latestAnalysis?.purchaseIntent ?? 0}/100</span>
                      </div>
                      <div className={styles.metricItem}>
                        <span className={styles.metricLabel}>Match Confidence</span>
                        <span className={styles.metricValue}>{Math.round((analysis?.confidence ?? 0.95) * 100)}%</span>
                      </div>
                      <div className={styles.metricItem}>
                        <span className={styles.metricLabel}>Recommended Action</span>
                        <span className={styles.metricValue} style={{ color: 'var(--color-primary)' }}>
                          {activeConvData?.recommendedAction ?? analysis?.latestAnalysis?.recommendedAction ?? 'REVIEW'}
                        </span>
                      </div>
                    </div>

                    {(analysis?.summary?.summary || activeConvData?.summary || activeConvData?.aiExplanation || analysis?.latestAnalysis?.reason) && (
                      <div className={styles.recommendationBanner}>
                        <span>✨</span>
                        <span><strong>AI Summary:</strong> {analysis?.summary?.summary || activeConvData?.summary || activeConvData?.aiExplanation || analysis?.latestAnalysis?.reason}</span>
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
                      <span className={styles.brandDealIcon}>🔥</span>
                      <strong>Brand Deal Extraction</strong>
                    </div>
                    <select
                      className="select btn-sm"
                      value={analysis.brandDeal.status}
                      onChange={(e) => handleBrandDealStatusChange(e.target.value)}
                      style={{ width: 'auto', padding: '4px 28px 4px 10px', fontSize: '12px' }}
                    >
                      {BRAND_DEAL_STATUSES.map(s => <option key={s} value={s}>{s.toUpperCase()}</option>)}
                    </select>
                  </div>
                  <div className={styles.brandDealGrid}>
                    <div className={styles.brandDealField}>
                      <span className={styles.brandDealLabel}>Brand</span>
                      <span className={styles.brandDealValue}>{analysis.brandDeal.brandName || 'Unknown'}</span>
                    </div>
                    <div className={styles.brandDealField}>
                      <span className={styles.brandDealLabel}>Budget</span>
                      <span className={styles.brandDealValue}>
                        {analysis.brandDeal.budgetAmount ? `${analysis.brandDeal.budgetAmount} ${analysis.brandDeal.budgetCurrency || ''}`.trim() : 'Unknown'}
                      </span>
                    </div>
                    <div className={styles.brandDealField}>
                      <span className={styles.brandDealLabel}>Deliverables</span>
                      <span className={styles.brandDealValue}>{analysis.brandDeal.deliverables || 'Unknown'}</span>
                    </div>
                    <div className={styles.brandDealField}>
                      <span className={styles.brandDealLabel}>Deadline</span>
                      <span className={styles.brandDealValue}>{analysis.brandDeal.deadline || 'Unknown'}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Messages */}
              <div className={styles.messagesContainer}>
                {messages.length === 0 ? (
                  <div className={styles.noMessages}>
                    <p>No messages in this conversation</p>
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
                            <img src={msg.attachmentUrl} alt="Attachment" />
                          ) : (
                            <a href={msg.attachmentUrl} target="_blank" rel="noopener noreferrer">
                              📎 {msg.messageType} attachment
                            </a>
                          )}
                        </div>
                      )}
                      <span className={styles.messageTime}>
                        {formatMessageTime(msg.igTimestamp || msg.createdAt)}
                      </span>
                    </div>
                  ))
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Compose Bar */}
              <div className={styles.composeBar}>
                {messagingWindow?.status === 'closed' && (
                  <div className={styles.windowClosedWarning}>
                    ⚠️ Outside the 24-hour messaging window. This contact must message you again before you can reply.
                  </div>
                )}

                <div className={styles.composeToolbar}>
                  <span className={styles.composeHint}>
                    {copied ? '✓ Copied to clipboard' : 'Draft your response or let AI write one for you.'}
                  </span>
                  <div className={styles.composeToolbarActions}>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleGenerateReply(Boolean(draftText))}
                      disabled={generating}
                    >
                      {generating ? 'Generating…' : draftText ? '🔁 Regenerate' : '✨ Draft Reply with AI'}
                    </button>
                    {draftText && (
                      <button className="btn btn-ghost btn-sm" onClick={() => handleCopyReply(draftText)}>
                        📋 Copy
                      </button>
                    )}
                  </div>
                </div>

                <textarea
                  className={styles.composeTextarea}
                  placeholder="Type a message to reply..."
                  value={draftText}
                  onChange={(e) => setDraftText(e.target.value)}
                />

                <div className={styles.composeFooter}>
                  <span className={styles.composeHint}>
                    AI drafts are never sent automatically. You review before sending.
                  </span>
                  <button
                    className="btn btn-primary"
                    onClick={handleSend}
                    disabled={!draftText.trim() || sending || !canSend}
                    id="send-reply-btn"
                  >
                    {sending ? 'Sending…' : 'Send Message ➤'}
                  </button>
                </div>
                {sendError && <div className={styles.sendError}>{sendError}</div>}
              </div>
            </>
          ) : (
            /* No conversation selected */
            <div className={styles.emptyChat}>
              <div className={styles.emptyChatIcon}>
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <h2>Select a conversation</h2>
              <p>Choose a contact from the inbox list on the left to view message history and send replies.</p>
            </div>
          )}
        </main>
      </div>

      {/* Modal: Clear Chat Messages */}
      {showClearModal && (
        <div className={styles.modalOverlay} onClick={() => !actionLoading && setShowClearModal(false)}>
          <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <span className={styles.modalIcon}>🧹</span>
              <h3 className={styles.modalTitle}>Clear Chat Messages?</h3>
            </div>
            <p className={styles.modalBody}>
              Are you sure you want to clear all message history with <strong>@{contactInfo?.username || contactInfo?.name || 'this contact'}</strong>?
              <br /><br />
              All previous messages will be removed from Codeback. The contact, lead profile, and auto-reply rules will be kept.
            </p>
            <div className={styles.modalActions}>
              <button
                className="btn btn-secondary btn-md"
                onClick={() => setShowClearModal(false)}
                disabled={actionLoading}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary btn-md"
                onClick={handleClearChatSubmit}
                disabled={actionLoading}
                id="confirm-clear-chat-btn"
              >
                {actionLoading ? 'Clearing…' : 'Clear Messages'}
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
              <span className={styles.modalIcon}>🗑️</span>
              <h3 className={styles.modalTitle}>Delete Full Conversation?</h3>
            </div>
            <p className={styles.modalBody}>
              Are you sure you want to permanently delete the conversation with <strong>@{convToDelete?.contact?.username || convToDelete?.contact?.name || contactInfo?.username || 'this contact'}</strong>?
              <br /><br />
              This will permanently remove the conversation thread, message history, AI analysis, and extracted deal details from your inbox.
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
                Cancel
              </button>
              <button
                className={`btn btn-md ${styles.btnDanger}`}
                onClick={handleDeleteChatSubmit}
                disabled={actionLoading}
                id="confirm-delete-conv-btn"
              >
                {actionLoading ? 'Deleting…' : 'Delete Entire Chat'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Helper: Format time ago ----
function formatTimeAgo(dateStr) {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'now';
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ---- Helper: Format message timestamp ----
function formatMessageTime(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export default function InboxPage() {
  return (
    <Suspense fallback={
      <div className={styles.loadingScreen}>
        <div className="spinner spinner-lg" />
      </div>
    }>
      <InboxPageContent />
    </Suspense>
  );
}
