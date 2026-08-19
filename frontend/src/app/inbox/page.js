'use client';

import { useEffect, useState, useRef, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { io } from 'socket.io-client';
import {
  getMe, getConversations, getMessages, getAccounts, logout,
  getConversationAnalysis, generateReply, sendReply, setConversationRead,
  updateBrandDealStatus, getNotifications,
} from '@/lib/api';
import { INBOX_FILTERS, getCategoryMeta, getPriorityMeta } from '@/lib/categories';
import styles from './inbox.module.css';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:5000';
const BRAND_DEAL_STATUSES = ['new', 'contacted', 'negotiating', 'confirmed', 'declined', 'expired'];

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
  const [loading, setLoading] = useState(true);
  const [contactInfo, setContactInfo] = useState(null);
  const [copied, setCopied] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [draftText, setDraftText] = useState('');
  const [generating, setGenerating] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [notifUnreadCount, setNotifUnreadCount] = useState(0);
  const [mobileShowChat, setMobileShowChat] = useState(false);
  const messagesEndRef = useRef(null);
  const socketRef = useRef(null);
  const messageIdsRef = useRef(new Set());

  // ---- Auth check + load accounts & conversations ----
  useEffect(() => {
    async function init() {
      try {
        const userData = await getMe();
        setUser(userData);

        const accountsData = await getAccounts();
        setAccounts(accountsData);

        await loadConversations(initialAccountId, initialFilter);

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

    return () => {
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // ---- Auto-scroll to bottom on new messages ----
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // ---- Handle real-time new message from Socket.io ----
  const handleNewMessage = useCallback((data) => {
    setConversations(prev => {
      const existing = prev.find(c => c.id === data.conversationId);
      if (existing) {
        return prev.map(c =>
          c.id === data.conversationId
            ? {
              ...c,
              lastMessage: data.message.content || `[${data.message.messageType}]`,
              lastMessageAt: data.message.igTimestamp,
              unread: true,
            }
            : c
        ).sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt));
      } else {
        loadConversations();
        return prev;
      }
    });

    setSelectedConv(current => {
      if (current === data.conversationId) {
        setMessages(prev => {
          if (messageIdsRef.current.has(data.message.id)) return prev;
          messageIdsRef.current.add(data.message.id);
          return [...prev, data.message];
        });
      }
      return current;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Handle live AI analysis completion (category/priority/summary) ----
  const handleAnalysisCompleted = useCallback((data) => {
    setConversations(prev => prev.map(c =>
      c.id === data.conversationId
        ? { ...c, category: data.category, priority: data.priority, priorityScore: data.priorityScore, needsAttention: data.needsAttention, summary: data.summary || c.summary }
        : c
    ));

    setSelectedConv(current => {
      if (current === data.conversationId) {
        setAnalysis(prevAnalysis => prevAnalysis ? {
          ...prevAnalysis,
          category: data.category,
          priority: data.priority,
          priorityScore: data.priorityScore,
          needsAttention: data.needsAttention,
          summary: { ...(prevAnalysis.summary || {}), summary: data.summary || prevAnalysis.summary?.summary },
        } : prevAnalysis);
      }
      return current;
    });
  }, []);

  // ---- Handle live brand deal detection ----
  const handleBrandDealDetected = useCallback((data) => {
    setSelectedConv(current => {
      if (current === data.conversationId) {
        setAnalysis(prevAnalysis => prevAnalysis ? { ...prevAnalysis, brandDeal: data.brandDeal } : prevAnalysis);
      }
      return current;
    });
    loadConversations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Build query extras from the active pseudo/real filter ----
  function filterToQuery(filterId) {
    if (filterId === 'all' || !filterId) return {};
    if (filterId === 'unread') return { unread: true };
    if (filterId === 'important') return { important: true };
    return { category: filterId };
  }

  // ---- Load conversations ----
  async function loadConversations(accId = selectedAccountId, filterId = selectedFilter) {
    try {
      const extra = filterToQuery(filterId);
      const data = await getConversations(accId, extra.category, extra);
      setConversations(data);
    } catch (err) {
      console.error('Failed to load conversations:', err);
    }
  }

  // ---- Switch account filter ----
  async function handleAccountChange(accId) {
    setSelectedAccountId(accId);
    setSelectedConv(null);
    setMessages([]);
    await loadConversations(accId, selectedFilter);
  }

  // ---- Switch category/status filter ----
  async function handleFilterChange(filterId) {
    setSelectedFilter(filterId);
    setSelectedConv(null);
    setMessages([]);
    await loadConversations(selectedAccountId, filterId);
  }

  // ---- Select a conversation ----
  async function selectConversation(convId) {
    setSelectedConv(convId);
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

      // The GET above marks it read server-side — reflect that optimistically.
      setConversations(prev => prev.map(c => (c.id === convId ? { ...c, unread: false } : c)));

      const analysisData = await getConversationAnalysis(convId).catch(() => null);
      if (analysisData) setAnalysis(analysisData);
    } catch (err) {
      console.error('Failed to load messages:', err);
    }
  }

  // ---- Logout ----
  async function handleLogout() {
    try {
      await logout();
      router.push('/');
    } catch (err) {
      console.error('Logout failed:', err);
    }
  }

  const activeConvData = conversations.find(c => c.id === selectedConv);
  const activeCategory = analysis?.category || activeConvData?.category || 'other';
  const activeCategoryMeta = getCategoryMeta(activeCategory);
  const activePriorityMeta = getPriorityMeta(analysis?.priority || activeConvData?.priority);
  const messagingWindow = activeConvData?.messagingWindow;
  const canSend = messagingWindow?.canReply !== false; // unknown/open => allow attempt, closed => block

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
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
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
          <button className="btn btn-ghost btn-sm" onClick={() => router.push('/brand-deals')}>
            🔥 Brand Deals
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => router.push('/notifications')} style={{ position: 'relative' }}>
            🔔 Notifications
            {notifUnreadCount > 0 && <span className={styles.bellBadge}>{notifUnreadCount > 9 ? '9+' : notifUnreadCount}</span>}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => router.push('/settings')}>
            ⚙️ Settings
          </button>
          <button className="btn btn-ghost btn-sm" onClick={handleLogout} title="Log out">
            🚪 Logout
          </button>
        </div>
      </header>

      <div className={styles.inboxBody}>
        {/* ---- Left Panel: Conversation List ---- */}
        <aside className={styles.sidebar}>
          {/* Account Selector Tabs */}
          {accounts.length > 1 && (
            <div className={styles.accountTabs}>
              <button
                className={`${styles.accountTab} ${selectedAccountId === '' ? styles.accountTabActive : ''}`}
                onClick={() => handleAccountChange('')}
              >
                All Accounts
              </button>
              {accounts.map(acc => (
                <button
                  key={acc.id}
                  className={`${styles.accountTab} ${selectedAccountId === acc.id ? styles.accountTabActive : ''}`}
                  onClick={() => handleAccountChange(acc.id)}
                >
                  @{acc.igUsername || 'account'}
                </button>
              ))}
            </div>
          )}

          {/* Smart Filter Tabs */}
          <div className={styles.categoryFilterBar}>
            {INBOX_FILTERS.map(f => (
              <button
                key={f.id}
                className={`${styles.categoryFilterBtn} ${selectedFilter === f.id ? styles.categoryFilterBtnActive : ''}`}
                onClick={() => handleFilterChange(f.id)}
              >
                <span className={styles.filterIcon}>{f.icon}</span> {f.label}
              </button>
            ))}
          </div>

          <div className={styles.convList}>
            {conversations.length === 0 ? (
              <div className={styles.emptyConvs}>
                <div className={styles.emptyConvsIcon}>📥</div>
                <h4>No conversations found</h4>
                <p>Incoming DMs will appear here when someone messages your Instagram account.</p>
              </div>
            ) : (
              conversations.map((conv) => {
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
                        <span className={styles.convTime}>
                          {conv.lastMessageAt ? formatTimeAgo(conv.lastMessageAt) : ''}
                        </span>
                      </div>
                      <div className={styles.convBottomRow}>
                        <span
                          className={`${styles.priorityIndicator} ${styles[prio.dotClass]}`}
                          title={`Priority: ${prio.label}`}
                        />
                        <p className={styles.convPreview}>
                          {conv.lastMessage || 'No messages'}
                        </p>
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
        </aside>

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
                        {activePriorityMeta.label}
                      </span>
                    </div>
                    {contactInfo?.name && contactInfo.name !== contactInfo.username && (
                      <span className={styles.chatRealName}>{contactInfo.name}</span>
                    )}
                  </div>
                </div>
                <div className={styles.chatHeaderRight}>
                  {contactInfo?.username && (
                    <a
                      href={`https://instagram.com/${contactInfo.username}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-secondary btn-sm"
                      id="open-instagram-chat-btn"
                    >
                      ↗ Instagram Profile
                    </a>
                  )}
                </div>
              </div>

              {/* Conversation Summary Panel */}
              {analysis?.summary?.summary && (
                <div className={styles.summaryCard}>
                  <div className={styles.summaryHeader}>
                    <span className={styles.summaryTag}>✨ AI Summary</span>
                    {analysis.summary.stage && <span className={styles.summaryStage}>{analysis.summary.stage}</span>}
                  </div>
                  <p className={styles.summaryText}>{analysis.summary.summary}</p>
                </div>
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
