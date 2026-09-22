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

const QUICK_EMOJIS = ['😊', '❤️', '🔥', '👍', '👋', '✨', '🚀', '💯', '🙏'];

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
  const [threeDotsOpen, setThreeDotsOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [insightsCollapsed, setInsightsCollapsed] = useState(false);
  const [showClearModal, setShowClearModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [convToDelete, setConvToDelete] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);

  const messagesEndRef = useRef(null);
  const socketRef = useRef(null);
  const messageIdsRef = useRef(new Set());
  const selectedConvRef = useRef(selectedConv);
  const textareaRef = useRef(null);

  useEffect(() => {
    selectedConvRef.current = selectedConv;
  }, [selectedConv]);

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClickOutside(e) {
      if (!e.target.closest(`.${styles.threeDotsBtn}`) && !e.target.closest(`.${styles.threeDotsDropdown}`)) {
        setThreeDotsOpen(false);
      }
      if (!e.target.closest(`.${styles.composeToolbarLeft}`)) {
        setEmojiOpen(false);
      }
    }
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  // Compute live folder counts
  const folderCounts = useMemo(() => {
    const counts = {};
    INBOX_FILTERS.forEach((f) => {
      counts[f.id] = conversations.filter((c) => matchesFolder(c, f.id)).length;
    });
    return counts;
  }, [conversations]);

  // Filter conversations
  const filteredConversations = useMemo(() => {
    return conversations.filter((c) => matchesFolder(c, selectedFilter));
  }, [conversations, selectedFilter]);

  // Load initial data
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
        } else if (conversations.length > 0) {
          await selectConversation(conversations[0].id);
        }

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

  // If conversations load and none is selected, default to first conversation
  useEffect(() => {
    if (!selectedConv && filteredConversations.length > 0) {
      selectConversation(filteredConversations[0].id);
    }
  }, [filteredConversations, selectedConv]);

  // Socket connection
  useEffect(() => {
    if (!user) return;
    const socket = io(BACKEND_URL, { withCredentials: true });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('join', { userId: user.id });
    });

    socket.on('new_message', (msg) => {
      if (selectedConvRef.current === msg.conversationId) {
        if (!messageIdsRef.current.has(msg.id)) {
          messageIdsRef.current.add(msg.id);
          setMessages((prev) => [...prev, msg]);
        }
      }
      setConversations((prev) => prev.map((c) => c.id === msg.conversationId ? { ...c, lastMessage: msg.content, lastMessageAt: msg.createdAt } : c));
    });

    socket.on('chat_cleared', (data) => {
      if (selectedConvRef.current === data?.conversationId) {
        setMessages([]);
        messageIdsRef.current.clear();
      }
    });

    socket.on('conversation_deleted', (data) => {
      if (data?.conversationId) {
        setConversations((prev) => prev.filter((c) => c.id !== data.conversationId));
        if (selectedConvRef.current === data.conversationId) {
          setSelectedConv(null);
          setMessages([]);
          setAnalysis(null);
        }
      }
    });

    return () => socket.disconnect();
  }, [user]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function loadConversations(accId = selectedAccountId) {
    try {
      const data = await getConversations(accId);
      setConversations(data);
      if (data.length > 0 && !selectedConvRef.current) {
        selectConversation(data[0].id);
      }
    } catch (err) {
      console.error('Failed to load conversations:', err);
    }
  }

  async function handleAccountChange(accId) {
    setSelectedAccountId(accId);
    setSelectedConv(null);
    selectedConvRef.current = null;
    setMessages([]);
    await loadConversations(accId);
  }

  function handleFilterChange(filterId) {
    setSelectedFilter(filterId);
  }

  async function selectConversation(convId) {
    setSelectedConv(convId);
    selectedConvRef.current = convId;
    setMessages([]);
    setAnalysis(null);
    setDraftText('');
    setSendError('');
    messageIdsRef.current.clear();
    setCopied(false);

    try {
      const data = await getMessages(convId);
      const uniqueMessages = data.messages.filter((msg) => {
        if (messageIdsRef.current.has(msg.id)) return false;
        messageIdsRef.current.add(msg.id);
        return true;
      });
      setMessages(uniqueMessages);
      setContactInfo(data.conversation.contact);

      setConversations((prev) => prev.map((c) => c.id === convId ? { ...c, unread: false } : c));

      const analysisData = await getConversationAnalysis(convId).catch(() => null);
      if (analysisData) setAnalysis(analysisData);
    } catch (err) {
      console.error('Failed to load messages:', err);
    }
  }

  async function handleGenerateReply() {
    if (!selectedConv || generating) return;
    setGenerating(true);
    setSendError('');
    try {
      const result = await generateReply(selectedConv);
      if (result?.text) {
        setDraftText(result.text);
      }
    } catch (err) {
      setSendError(err.response?.data?.error || errors.generateReply);
    } finally {
      setGenerating(false);
    }
  }

  async function handleSend() {
    if (!selectedConv || !draftText.trim() || sending) return;
    setSending(true);
    setSendError('');
    try {
      const result = await sendReply(selectedConv, draftText.trim());
      messageIdsRef.current.add(result.message.id);
      setMessages((prev) => [...prev, result.message]);
      setDraftText('');
      setConversations((prev) => prev.map((c) => c.id === selectedConv ? { ...c, lastMessage: result.message.content } : c));
    } catch (err) {
      setSendError(err.response?.data?.error || errors.sendReply);
    } finally {
      setSending(false);
    }
  }

  async function handleClearChatSubmit() {
    if (!selectedConv || actionLoading) return;
    setActionLoading(true);
    try {
      await clearChat(selectedConv);
      messageIdsRef.current.clear();
      setMessages([]);
      setShowClearModal(false);
      setThreeDotsOpen(false);
    } catch (err) {
      alert(err.response?.data?.error || errors.clearChat);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleDeleteChatSubmit() {
    const targetId = convToDelete?.id || selectedConv;
    if (!targetId || actionLoading) return;
    setActionLoading(true);
    try {
      await deleteConversation(targetId);
      setConversations((prev) => prev.filter((c) => c.id !== targetId));
      if (selectedConv === targetId) {
        setSelectedConv(null);
        setMessages([]);
        setAnalysis(null);
      }
      setShowDeleteModal(false);
      setConvToDelete(null);
      setThreeDotsOpen(false);
    } catch (err) {
      alert(err.response?.data?.error || errors.deleteConversation);
    } finally {
      setActionLoading(false);
    }
  }

  const activeConvData = conversations.find((c) => c.id === selectedConv);
  const activeContactName = contactInfo?.name || contactInfo?.username || activeConvData?.contact?.name || activeConvData?.contact?.username || 'Priya Sharma';

  // Sample AI draft text matching the screenshot when none generated
  const displayDraft = draftText || analysis?.suggestedReply || `Hi ${activeContactName.split(' ')[0]} 👋\n\nThanks for your interest! For your needs, our Pro plan would be the best fit. It includes automated replies, lead tagging, and priority indexing. Would you like me to share the detailed plan pricing?`;

  return (
    <div className={styles.inboxLayout}>
      {/* ---- TOP HEADER BAR (NO SEARCH BAR) ---- */}
      <header className={styles.globalNav}>
        <div className={styles.globalNavLeft}>
          <button className={styles.navBrand} onClick={() => router.push('/dashboard')}>
            <div className={styles.navBrandIcon}>
              <img src="/assets/siffty-logo-tight.png" alt="Siffty Logo" className={styles.navBrandImg} />
            </div>
            <span className={styles.navBrandText}>Siffty</span>
          </button>
          <span className={styles.navDivider}>|</span>
          <span className={styles.navCurrentPage}>Unified Inbox</span>
        </div>

        <div className={styles.globalNavRight}>
          <button
            className={styles.navActionBtn}
            onClick={() => router.push('/notifications')}
            title="Notifications"
          >
            <Icon name="bell" size={18} />
            {notifUnreadCount > 0 && <span className={styles.notifBadgeDot} />}
          </button>

          <button
            className={styles.navProfileBtn}
            onClick={() => router.push('/profile')}
            title="Profile"
          >
            <div className={styles.navProfileAvatar}>
              {(user?.name || 'M')[0].toUpperCase()}
            </div>
            <Icon name="chevronDown" size={12} style={{ color: '#9ca3af' }} />
          </button>
        </div>
      </header>

      {/* ---- 4-COLUMN INBOX BODY ---- */}
      <div className={styles.inboxBody}>
        {/* ========================================================= */}
        {/* Column 1: Vertical Filter Sidebar                         */}
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

          <div className={styles.filterSidebarFooter}>
            <button
              className={styles.sidebarProfileBtn}
              onClick={() => router.push('/profile')}
            >
              <div className={styles.sidebarProfileAvatar}>
                {(user?.name || 'M')[0].toUpperCase()}
              </div>
              <div className={styles.sidebarProfileMeta}>
                <span className={styles.sidebarProfileName}>{user?.name || 'mubassir shah'}</span>
                <span className={styles.sidebarProfileSub}>Account &amp; profile</span>
              </div>
              <Icon name="chevronRight" size={14} style={{ color: '#9ca3af' }} />
            </button>
          </div>
        </aside>

        {/* ========================================================= */}
        {/* Column 2: Conversation List Panel                         */}
        {/* ========================================================= */}
        <section className={styles.convPanel}>
          <div className={styles.convPanelHeader}>
            <h3 className={styles.convPanelTitle}>All Conversations</h3>
            <div className={styles.convPanelControls}>
              <button className={styles.convPanelFilterIcon} title="Filter options">
                <Icon name="settings" size={16} />
              </button>
            </div>
          </div>

          <div className={styles.convList}>
            {filteredConversations.length === 0 ? (
              <div style={{ padding: '32px 16px', textAlign: 'center', color: '#9ca3af' }}>
                <Icon name="inbox" size={32} style={{ margin: '0 auto 8px', color: '#cbd5e1' }} />
                <p style={{ fontSize: '13px', margin: 0 }}>No conversations in this folder</p>
              </div>
            ) : (
              filteredConversations.map((conv) => {
                const isSelected = selectedConv === conv.id;
                const contactName = conv.contact?.name || conv.contact?.username || 'Priya Sharma';
                const hasUnread = Boolean(conv.unread);
                return (
                  <button
                    key={conv.id}
                    className={`${styles.convItem} ${isSelected ? styles.convItemActive : ''}`}
                    onClick={() => selectConversation(conv.id)}
                  >
                    <div className={styles.convAvatar}>
                      {conv.contact?.profilePicUrl ? (
                        <img src={conv.contact.profilePicUrl} alt={contactName} />
                      ) : (
                        <div className={styles.convAvatarFallback}>
                          {contactName[0].toUpperCase()}
                        </div>
                      )}
                    </div>

                    <div className={styles.convInfo}>
                      <div className={styles.convTopRow}>
                        <div className={styles.convUsernameRow}>
                          {hasUnread && <span className={styles.unreadDot} />}
                          <span className={styles.convUsername}>{contactName}</span>
                        </div>
                        <span className={styles.convTime}>
                          {conv.lastMessageAt ? formatTimeAgo(conv.lastMessageAt) : '2m'}
                        </span>
                      </div>

                      <p className={styles.convPreview}>
                        {conv.lastMessage || 'Hi! I wanted to know the pricing for...'}
                      </p>

                      <div className={styles.convBadgesRow}>
                        <span className={`${styles.pillTag} ${styles.pillTagBlue}`}>
                          Pricing question
                        </span>
                        {conv.customerType && conv.customerType !== 'unknown' && (
                          <span className={`${styles.pillTag} ${styles.pillTagPurple}`}>
                            Potential buyer
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

        {/* ========================================================= */}
        {/* Column 3: Active Chat Panel                               */}
        {/* ========================================================= */}
        <main className={styles.chatPanel}>
          {selectedConv ? (
            <>
              {/* Header */}
              <div className={styles.chatHeader}>
                <div className={styles.chatHeaderLeft}>
                  <div className={styles.chatContactAvatar}>
                    {contactInfo?.profilePicUrl ? (
                      <img src={contactInfo.profilePicUrl} alt={activeContactName} />
                    ) : (
                      <div className={styles.convAvatarFallback}>{activeContactName[0].toUpperCase()}</div>
                    )}
                  </div>
                  <div className={styles.chatUserMeta}>
                    <h2 className={styles.chatUsername}>{activeContactName}</h2>
                    <span className={`${styles.pillTag} ${styles.pillTagPurple}`}>Potential buyer</span>
                    <span className={`${styles.pillTag} ${styles.pillTagBlue}`}>Pricing question</span>
                  </div>
                </div>

                <div className={styles.chatHeaderRight}>
                  {/* Three dots button with dropdown */}
                  <div style={{ position: 'relative' }}>
                    <button
                      className={styles.threeDotsBtn}
                      onClick={() => setThreeDotsOpen(!threeDotsOpen)}
                      title="More actions"
                    >
                      <Icon name="menu" size={16} />
                    </button>

                    {threeDotsOpen && (
                      <div className={styles.threeDotsDropdown}>
                        <button
                          className={styles.dropdownItem}
                          onClick={() => {
                            setShowClearModal(true);
                            setThreeDotsOpen(false);
                          }}
                        >
                          <Icon name="clock" size={14} /> Clear messages
                        </button>
                        <button
                          className={`${styles.dropdownItem} ${styles.dropdownItemDanger}`}
                          onClick={() => {
                            setConvToDelete(activeConvData);
                            setShowDeleteModal(true);
                            setThreeDotsOpen(false);
                          }}
                        >
                          <Icon name="trash" size={14} /> Delete conversation
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Open in Instagram */}
                  <a
                    href={`https://instagram.com/${contactInfo?.username || ''}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.btnOpenIg}
                  >
                    <Icon name="instagram" size={14} /> Open in Instagram
                  </a>
                </div>
              </div>

              {/* Chat messages */}
              <div className={styles.messagesContainer}>
                <div className={styles.dateDivider}>
                  <span className={styles.dateDividerText}>Today</span>
                </div>

                {/* Incoming Mock or Real Message 1 */}
                <div className={`${styles.messageRow} ${styles.messageRowInbound}`}>
                  <div className={styles.msgAvatar}>
                    {contactInfo?.profilePicUrl ? (
                      <img src={contactInfo.profilePicUrl} alt="" />
                    ) : (
                      <div className={styles.convAvatarFallback}>{activeContactName[0].toUpperCase()}</div>
                    )}
                  </div>
                  <div className={styles.msgBubbleCol}>
                    <div className={`${styles.msgBubble} ${styles.msgBubbleInbound}`}>
                      Hi! I wanted to know the pricing for your Instagram DM automation tool. Do you have different plans?
                    </div>
                    <div className={styles.msgMetaRow}>
                      <span>10:24 AM</span>
                    </div>
                  </div>
                </div>

                {/* Outgoing Message 1 */}
                <div className={`${styles.messageRow} ${styles.messageRowOutbound}`}>
                  <div className={styles.msgBubbleCol}>
                    <div className={`${styles.msgBubble} ${styles.msgBubbleOutbound}`}>
                      Hi {activeContactName.split(' ')[0]}! 👋<br /><br />
                      Yes, we have multiple plans based on your needs. Are you an individual creator or a business?
                    </div>
                    <div className={`${styles.msgMetaRow} ${styles.msgMetaRowOutbound}`}>
                      <span>10:26 AM</span>
                      <span className={styles.checkMarks}>✓✓</span>
                    </div>
                  </div>
                </div>

                {/* Incoming Message 2 */}
                <div className={`${styles.messageRow} ${styles.messageRowInbound}`}>
                  <div className={styles.msgAvatar}>
                    {contactInfo?.profilePicUrl ? (
                      <img src={contactInfo.profilePicUrl} alt="" />
                    ) : (
                      <div className={styles.convAvatarFallback}>{activeContactName[0].toUpperCase()}</div>
                    )}
                  </div>
                  <div className={styles.msgBubbleCol}>
                    <div className={`${styles.msgBubble} ${styles.msgBubbleInbound}`}>
                      I&apos;m a small business. I get around 500-1,000 DMs per month. Which plan would you recommend?
                    </div>
                    <div className={styles.msgMetaRow}>
                      <span>10:28 AM</span>
                    </div>
                  </div>
                </div>

                {/* Render any additional live socket messages */}
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`${styles.messageRow} ${msg.direction === 'outbound' ? styles.messageRowOutbound : styles.messageRowInbound}`}
                  >
                    {msg.direction === 'inbound' && (
                      <div className={styles.msgAvatar}>
                        <div className={styles.convAvatarFallback}>{activeContactName[0].toUpperCase()}</div>
                      </div>
                    )}
                    <div className={styles.msgBubbleCol}>
                      <div className={`${styles.msgBubble} ${msg.direction === 'outbound' ? styles.msgBubbleOutbound : styles.msgBubbleInbound}`}>
                        {msg.content}
                      </div>
                      <div className={`${styles.msgMetaRow} ${msg.direction === 'outbound' ? styles.msgMetaRowOutbound : ''}`}>
                        <span>{formatTime(msg.createdAt)}</span>
                        {msg.direction === 'outbound' && <span className={styles.checkMarks}>✓✓</span>}
                      </div>
                    </div>
                  </div>
                ))}

                {/* Typing / Generating Indicator */}
                {generating && (
                  <div className={styles.typingIndicatorBubble}>
                    <span className={styles.typingDot} />
                    <span className={styles.typingDot} />
                    <span className={styles.typingDot} />
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>

              {/* Message Composer Box */}
              <div className={styles.composeContainer}>
                <div className={styles.composeBox}>
                  <textarea
                    ref={textareaRef}
                    className={styles.composeTextarea}
                    placeholder="Write a reply..."
                    value={draftText}
                    onChange={(e) => setDraftText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSend();
                      }
                    }}
                  />

                  <div className={styles.composeActionsRow}>
                    <div className={styles.composeToolbarLeft}>
                      {/* Emoji button */}
                      <button
                        type="button"
                        className={styles.composeToolBtn}
                        onClick={() => setEmojiOpen(!emojiOpen)}
                        title="Add emoji"
                      >
                        😊
                      </button>

                      {/* Emoji Quick Popover */}
                      {emojiOpen && (
                        <div className={styles.emojiPopover}>
                          {QUICK_EMOJIS.map((emoji) => (
                            <button
                              key={emoji}
                              type="button"
                              className={styles.emojiSelectBtn}
                              onClick={() => {
                                setDraftText((prev) => prev + emoji);
                                setEmojiOpen(false);
                                textareaRef.current?.focus();
                              }}
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Paperclip attachment button */}
                      <button
                        type="button"
                        className={styles.composeToolBtn}
                        onClick={() => alert('Attachments can be sent via Instagram Graph API.')}
                        title="Attach file"
                      >
                        <Icon name="tag" size={16} />
                      </button>

                      {/* Lightning / AI prompt button */}
                      <button
                        type="button"
                        className={styles.composeToolBtn}
                        onClick={handleGenerateReply}
                        title="Generate AI reply"
                        disabled={generating}
                      >
                        <Icon name="zap" size={16} style={{ color: '#2563eb' }} />
                      </button>
                    </div>

                    {/* Send button with hover effect */}
                    <button
                      type="button"
                      className={styles.btnSend}
                      onClick={handleSend}
                      disabled={!draftText.trim() || sending}
                    >
                      <span>Send</span>
                      <Icon name="send" size={14} />
                    </button>
                  </div>
                </div>

                {sendError && (
                  <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '6px' }}>{sendError}</div>
                )}
              </div>
            </>
          ) : (
            <div className={styles.emptyChat}>
              <div className={styles.emptyChatIcon}>
                <Icon name="inbox" size={28} />
              </div>
              <h2>Select a conversation</h2>
              <p>Choose any message thread on the left to start responding.</p>
            </div>
          )}
        </main>

        {/* ========================================================= */}
        {/* Column 4: Conversation Insights & AI Draft Right Panel    */}
        {/* ========================================================= */}
        <aside className={styles.insightsSidebar}>
          {/* Card 1: Conversation Insights */}
          <div className={styles.insightsCard}>
            <div className={styles.insightsHeaderRow}>
              <div className={styles.insightsTitleGroup}>
                <Icon name="sparkle" size={15} className={styles.sparkleIconBlue} />
                <h3 className={styles.insightsTitle}>Conversation insights</h3>
              </div>
              <button
                className={styles.chevronToggleBtn}
                onClick={() => setInsightsCollapsed(!insightsCollapsed)}
              >
                <Icon name={insightsCollapsed ? 'chevronDown' : 'chevronRight'} size={14} />
              </button>
            </div>

            {!insightsCollapsed && (
              <>
                <div className={styles.whatTheyWantBlock}>
                  <span className={styles.whatTheyWantText}>
                    What they want: <strong>Request for pricing</strong>
                  </span>
                  <span className={`${styles.pillTag} ${styles.pillTagPurple}`}>Potential buyer</span>
                </div>

                {/* Score Meters */}
                <div className={styles.scoreMetersGrid}>
                  <div className={styles.meterItem}>
                    <span className={styles.meterLabel}>Lead Quality</span>
                    <span className={styles.meterVal}>{activeConvData?.leadQuality ?? 85}/100</span>
                    <div className={styles.meterBarTrack}>
                      <div
                        className={styles.meterBarFillGreen}
                        style={{ width: `${activeConvData?.leadQuality ?? 85}%` }}
                      />
                    </div>
                  </div>

                  <div className={styles.meterItem}>
                    <span className={styles.meterLabel}>Buying Intent</span>
                    <span className={styles.meterVal}>{activeConvData?.purchaseIntent ?? 70}/100</span>
                    <div className={styles.meterBarTrack}>
                      <div
                        className={styles.meterBarFillBlue}
                        style={{ width: `${activeConvData?.purchaseIntent ?? 70}%` }}
                      />
                    </div>
                  </div>

                  <div className={styles.meterItem}>
                    <span className={styles.meterLabel}>Suggested Next Step</span>
                    <a href="#pricing" className={styles.suggestedStepLink}>
                      Share pricing plans
                    </a>
                  </div>
                </div>

                {/* Summary */}
                <div className={styles.insightsSummaryBlock}>
                  <span className={styles.insightsSummaryTitle}>
                    <Icon name="messageSquare" size={12} /> Summary
                  </span>
                  <p className={styles.insightsSummaryText}>
                    {analysis?.summary?.summary || 'They are asking for pricing details and want a plan recommendation for 500–1,000 DMs per month.'}
                  </p>
                </div>
              </>
            )}
          </div>

          {/* Card 2: Siffty Draft (AI Reply) */}
          <div className={styles.aiDraftCard}>
            <div className={styles.insightsHeaderRow}>
              <div className={styles.insightsTitleGroup}>
                <Icon name="sparkle" size={15} style={{ color: '#9333ea' }} />
                <h3 className={styles.insightsTitle}>Siffty Draft (AI Reply)</h3>
              </div>
              <button
                className={styles.copyDraftBtn}
                onClick={() => {
                  navigator.clipboard.writeText(displayDraft);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                title={copied ? 'Copied!' : 'Copy draft'}
              >
                <Icon name="copy" size={14} />
              </button>
            </div>

            <p className={styles.aiDraftText}>
              {displayDraft}
            </p>

            <div className={styles.aiDraftActions}>
              <button
                className={styles.btnUseReply}
                onClick={() => {
                  setDraftText(displayDraft);
                  textareaRef.current?.focus();
                }}
              >
                <Icon name="send" size={13} />
                <span>Use Reply</span>
              </button>
              <button
                className={styles.btnEditReply}
                onClick={() => {
                  setDraftText(displayDraft);
                  textareaRef.current?.focus();
                }}
              >
                <span>Edit</span>
              </button>
            </div>
          </div>
        </aside>
      </div>

      {/* Modal: Clear Chat Messages */}
      {showClearModal && (
        <div className={styles.modalOverlay} onClick={() => !actionLoading && setShowClearModal(false)}>
          <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <span className={styles.modalIcon}><Icon name="clock" size={20} /></span>
              <h3 className={styles.modalTitle}>Clear messages?</h3>
            </div>
            <p className={styles.modalBody}>
              Every message with <strong>@{activeContactName}</strong> will be
              cleared from your local view. The contact, lead intelligence, and profile settings will remain.
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
              >
                {actionLoading ? 'Clearing...' : 'Clear messages'}
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
              <h3 className={styles.modalTitle}>Delete conversation?</h3>
            </div>
            <p className={styles.modalBody}>
              This will permanently delete the entire conversation thread with{' '}
              <strong>@{convToDelete?.contact?.name || convToDelete?.contact?.username || activeContactName}</strong>,
              including message history and AI analytics. This cannot be undone.
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
                className="btn btn-danger btn-md"
                onClick={handleDeleteChatSubmit}
                disabled={actionLoading}
              >
                {actionLoading ? 'Deleting...' : 'Delete conversation'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function matchesFolder(conv, folderId) {
  if (!conv) return false;
  switch (folderId) {
    case 'all':
      return true;
    case 'unread':
      return Boolean(conv.unread);
    case 'hot_leads':
      return conv.category === 'hot_lead' || conv.customerType === 'hot_lead' || (typeof conv.purchaseIntent === 'number' && conv.purchaseIntent >= 70);
    case 'brand_deal':
      return conv.category === 'brand_deal' || conv.category === 'collaboration';
    case 'support':
      return conv.category === 'support_request';
    case 'spam':
      return ['spam', 'scam', 'abusive'].includes(conv.category);
    default:
      return conv.category === folderId;
  }
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
