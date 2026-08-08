'use client';

import { useEffect, useState, useRef, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { io } from 'socket.io-client';
import { getMe, getConversations, getMessages, getAccounts, logout } from '@/lib/api';
import styles from './inbox.module.css';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:5000';

const CATEGORIES = ['All', 'Brand/Collab', 'Business', 'Question', 'Fan', 'Spam', 'Other'];

function InboxPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialAccountId = searchParams.get('accountId') || '';

  const [user, setUser] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [selectedAccountId, setSelectedAccountId] = useState(initialAccountId);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [conversations, setConversations] = useState([]);
  const [selectedConv, setSelectedConv] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [contactInfo, setContactInfo] = useState(null);
  const [copied, setCopied] = useState(false);
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

        await loadConversations(initialAccountId, '');
      } catch (err) {
        router.push('/');
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [router, initialAccountId]);

  // ---- Socket.io connection ----
  useEffect(() => {
    if (!user) return;

    const socket = io(BACKEND_URL, { withCredentials: true });
    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('[Socket] Connected:', socket.id);
      socket.emit('join', { userId: user.id });
    });

    socket.on('new_message', handleNewMessage);

    socket.on('disconnect', () => {
      console.log('[Socket] Disconnected');
    });

    return () => {
      socket.disconnect();
    };
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
    console.log('[Socket] New message received:', data);

    setConversations(prev => {
      const existing = prev.find(c => c.id === data.conversationId);
      if (existing) {
        return prev.map(c =>
          c.id === data.conversationId
            ? {
              ...c,
              lastMessage: data.message.content || `[${data.message.messageType}]`,
              lastMessageAt: data.message.igTimestamp,
              category: data.category || c.category,
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
  }, []);

  // ---- Load conversations ----
  async function loadConversations(accId = selectedAccountId, categoryFilter = selectedCategory) {
    try {
      const categoryParam = categoryFilter === 'All' ? '' : categoryFilter;
      const data = await getConversations(accId, categoryParam);
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
    await loadConversations(accId, selectedCategory);
  }

  // ---- Switch category filter ----
  async function handleCategoryChange(cat) {
    const catVal = cat === 'All' ? '' : cat;
    setSelectedCategory(catVal);
    setSelectedConv(null);
    setMessages([]);
    await loadConversations(selectedAccountId, catVal);
  }

  // ---- Select a conversation ----
  async function selectConversation(convId) {
    setSelectedConv(convId);
    setMessages([]);
    messageIdsRef.current.clear();
    setCopied(false);

    try {
      const data = await getMessages(convId);
      const uniqueMessages = data.messages.filter(msg => {
        if (messageIdsRef.current.has(msg.id)) return false;
        messageIdsRef.current.add(msg.id);
        return true;
      });
      setMessages(uniqueMessages);
      setContactInfo(data.conversation.contact);
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

  // ---- Extract AI suggestion for active chat ----
  const activeConvData = conversations.find(c => c.id === selectedConv);
  const latestInboundWithReply = [...messages].reverse().find(m => m.direction === 'inbound' && m.suggestedReply);
  const activeSuggestedReply = latestInboundWithReply?.suggestedReply || null;
  const activeCategory = activeConvData?.category || latestInboundWithReply?.category || 'General';

  function handleCopyReply(text) {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  function handleUseReply(text) {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopied(true);
    // Focus Instagram link button
    const linkBtn = document.getElementById('open-instagram-chat-btn');
    if (linkBtn) linkBtn.focus();
  }

  if (loading) {
    return (
      <div className={styles.loadingScreen}>
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div className={styles.inbox}>
      {/* ---- Left Panel: Conversation List ---- */}
      <aside className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <div className={styles.sidebarBrand}>
            <div className={styles.brandIcon}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <span className={styles.brandText}>Inbox</span>
          </div>
          <div className={styles.sidebarActions}>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => router.push('/dashboard')}
              title="Dashboard"
            >
              ⚙️
            </button>
            <button className="btn btn-secondary btn-sm" onClick={handleLogout} title="Log out">
              ↗️
            </button>
          </div>
        </div>

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

        {/* Smart Category Filter Tabs */}
        <div className={styles.categoryFilterBar}>
          {CATEGORIES.map(cat => {
            const isCatActive = (cat === 'All' && !selectedCategory) || selectedCategory === cat;
            return (
              <button
                key={cat}
                className={`${styles.categoryFilterBtn} ${isCatActive ? styles.categoryFilterBtnActive : ''}`}
                onClick={() => handleCategoryChange(cat)}
              >
                {cat}
              </button>
            );
          })}
        </div>

        <div className={styles.convList}>
          {conversations.length === 0 ? (
            <div className={styles.emptyConvs}>
              <p>No conversations found</p>
              <span>DMs will appear here when someone messages your Instagram account</span>
            </div>
          ) : (
            conversations.map((conv) => (
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
                    <span className={styles.convUsername}>
                      {conv.contact.username || conv.contact.name || 'Unknown'}
                    </span>
                    <span className={styles.convTime}>
                      {conv.lastMessageAt ? formatTimeAgo(conv.lastMessageAt) : ''}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '2px' }}>
                    <p className={styles.convPreview} style={{ margin: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {conv.lastMessage || 'No messages'}
                    </p>
                    {conv.category && (
                      <span className={`${styles.categoryBadge} ${
                        conv.category === 'Brand/Collab' ? styles.badgeBrandCollab :
                        conv.category === 'Business' ? styles.badgeBusiness :
                        conv.category === 'Question' ? styles.badgeQuestion :
                        conv.category === 'Fan' ? styles.badgeFan :
                        conv.category === 'Spam' ? styles.badgeSpam : styles.badgeOther
                      }`} style={{ marginLeft: '6px', flexShrink: 0 }}>
                        {conv.category}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            ))
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
                {contactInfo?.profilePicUrl ? (
                  <img src={contactInfo.profilePicUrl} alt={contactInfo.username} className="avatar" />
                ) : (
                  <div className="avatar">
                    {(contactInfo?.username || '?')[0].toUpperCase()}
                  </div>
                )}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <h2 className={styles.chatUsername}>
                      {contactInfo?.username || contactInfo?.name || 'Unknown'}
                    </h2>
                    {activeCategory && activeCategory !== 'Other' && (
                      <span className={`${styles.categoryBadge} ${
                        activeCategory === 'Brand/Collab' ? styles.badgeBrandCollab :
                        activeCategory === 'Business' ? styles.badgeBusiness :
                        activeCategory === 'Question' ? styles.badgeQuestion :
                        activeCategory === 'Fan' ? styles.badgeFan :
                        activeCategory === 'Spam' ? styles.badgeSpam : styles.badgeOther
                      }`}>
                        {activeCategory}
                      </span>
                    )}
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
                  >
                    ↗ Instagram Profile
                  </a>
                )}
              </div>
            </div>

            {/* Messages */}
            <div className={styles.messagesContainer}>
              {messages.length === 0 ? (
                <div className={styles.noMessages}>
                  <p>No messages in this conversation</p>
                </div>
              ) : (
                messages.map((msg, index) => (
                  <div
                    key={msg.id}
                    className={`${styles.messageBubble} ${msg.direction === 'outbound' ? styles.messageOutbound : styles.messageInbound
                      }`}
                    style={{ animationDelay: `${Math.min(index * 0.03, 0.5)}s` }}
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

            {/* AI Suggestion Box (Shown for Brand/Collab, Business, Question) */}
            {activeSuggestedReply && ['Brand/Collab', 'Business', 'Question'].includes(activeCategory) && (
              <div className={styles.aiSuggestionBox}>
                <div className={styles.aiSuggestionHeader}>
                  <span>✨ AI SUGGESTED REPLY ({activeCategory})</span>
                  <div className={styles.aiSuggestionActions}>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleCopyReply(activeSuggestedReply)}
                    >
                      {copied ? '✓ Copied' : '📋 Copy'}
                    </button>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => handleUseReply(activeSuggestedReply)}
                    >
                      ↗ Use this reply
                    </button>
                  </div>
                </div>
                <p className={styles.aiSuggestionText}>"{activeSuggestedReply}"</p>
              </div>
            )}

            {/* Read-Only Banner / Instagram Redirect */}
            <div className={styles.redirectBanner}>
              <div className={styles.redirectInfo}>
                <span className={styles.redirectTitle}>Read-Only Mode</span>
                <span className={styles.redirectSub}>To send a reply, open this conversation directly on Instagram:</span>
              </div>
              <a
                href={
                  contactInfo?.username
                    ? `https://instagram.com/${contactInfo.username}`
                    : 'https://www.instagram.com/direct/inbox/'
                }
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-primary btn-sm"
                id="open-instagram-chat-btn"
              >
                ↗ Reply on Instagram ({contactInfo?.username ? `@${contactInfo.username}` : 'Direct'})
              </a>
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
            <p>Choose a conversation from the sidebar to view messages</p>
          </div>
        )}
      </main>
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
        <div className="spinner" />
      </div>
    }>
      <InboxPageContent />
    </Suspense>
  );
}
