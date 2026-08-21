'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getMe, getAISettings, updateAISettings, getAutoReplyChats, toggleAutoReply } from '@/lib/api';
import AppShell from '@/app/components/AppShell';
import styles from './settings.module.css';

const LEVELS = ['critical', 'high', 'normal', 'low', 'off'];
const TONES = ['friendly', 'professional', 'casual', 'custom'];

const PRIORITY_ROWS = [
  { key: 'brandDealsPriority', label: '🔥 Brand Deals' },
  { key: 'collaborationsPriority', label: '🤝 Collaborations' },
  { key: 'customersPriority', label: '💰 Customers' },
  { key: 'fanPriority', label: '❤️ Fan Messages' },
  { key: 'questionsPriority', label: '❓ General Questions' },
  { key: 'spamPriority', label: '🚫 Spam' },
];

/**
 * Creator Preferences — personalizes how AI prioritizes conversations and
 * the tone it uses when drafting replies, plus specific-chat auto-reply controls.
 */
export default function SettingsPage() {
  const router = useRouter();
  const [prefs, setPrefs] = useState(null);
  const [autoReplyChats, setAutoReplyChats] = useState([]);
  const [chatSearch, setChatSearch] = useState('');
  const [expandedChatId, setExpandedChatId] = useState(null);
  const [customPrompts, setCustomPrompts] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        await getMe();
        const [settingsData, chatsData] = await Promise.all([
          getAISettings(),
          getAutoReplyChats().catch(() => []),
        ]);
        setPrefs(settingsData);
        setAutoReplyChats(chatsData || []);
        const initialPrompts = {};
        (chatsData || []).forEach(c => {
          if (c.autoReplyPrompt) initialPrompts[c.id] = c.autoReplyPrompt;
        });
        setCustomPrompts(initialPrompts);
      } catch (err) {
        router.push('/');
      } finally {
        setLoading(false);
      }
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateField(key, value) {
    setPrefs(prev => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  async function handleToggleChatAutoReply(chatId, currentStatus) {
    const newStatus = !currentStatus;
    const prompt = customPrompts[chatId] || null;
    try {
      await toggleAutoReply(chatId, newStatus, prompt);
      setAutoReplyChats(prev => prev.map(c => c.id === chatId ? { ...c, autoReplyEnabled: newStatus, autoReplyPrompt: prompt } : c));
    } catch (err) {
      alert('Failed to update chat auto-reply status');
    }
  }

  async function handleSaveChatPrompt(chatId) {
    const prompt = customPrompts[chatId] || null;
    try {
      await toggleAutoReply(chatId, true, prompt);
      setAutoReplyChats(prev => prev.map(c => c.id === chatId ? { ...c, autoReplyEnabled: true, autoReplyPrompt: prompt } : c));
      setExpandedChatId(null);
    } catch (err) {
      alert('Failed to save custom instructions for chat');
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const updated = await updateAISettings({
        brandDealsPriority: prefs.brandDealsPriority,
        collaborationsPriority: prefs.collaborationsPriority,
        customersPriority: prefs.customersPriority,
        fanPriority: prefs.fanPriority,
        questionsPriority: prefs.questionsPriority,
        spamPriority: prefs.spamPriority,
        tone: prefs.tone,
        customInstructions: prefs.customInstructions,
        autoGenerateSummary: prefs.autoGenerateSummary,
      });
      setPrefs(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      alert('Failed to save settings');
    } finally {
      setSaving(false);
    }
  }

  const filteredChats = autoReplyChats.filter(c => {
    if (!chatSearch.trim()) return true;
    const query = chatSearch.toLowerCase();
    const username = (c.contact?.username || '').toLowerCase();
    const name = (c.contact?.name || '').toLowerCase();
    const lastMsg = (c.lastMessage || '').toLowerCase();
    return username.includes(query) || name.includes(query) || lastMsg.includes(query);
  });

  const activeAutoReplyCount = autoReplyChats.filter(c => c.autoReplyEnabled).length;

  return (
    <AppShell activeRoute="/settings">
      {/* Page Header */}
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>⚙️ AI Preferences & Settings</h1>
          <p className={styles.pageSubtitle}>
            Customize how Codeback prioritizes your inbox and matches your voice when drafting AI replies.
          </p>
        </div>
      </div>

      {loading || !prefs ? (
        <div className={styles.loadingContainer}>
          <div className="spinner spinner-lg" />
        </div>
      ) : (
        <div className={styles.settingsGrid}>
          {/* Section: Priority Config */}
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <h2 className={styles.cardTitle}>Conversation Priorities</h2>
              <p className={styles.cardDesc}>Set default priority levels for different message categories.</p>
            </div>
            <div className={styles.prefList}>
              {PRIORITY_ROWS.map(row => (
                <div className={styles.prefRow} key={row.key}>
                  <span className={styles.prefLabel}>{row.label}</span>
                  <select
                    className="select btn-sm"
                    value={prefs[row.key]}
                    onChange={(e) => updateField(row.key, e.target.value)}
                    style={{ width: '130px' }}
                  >
                    {LEVELS.map(l => (
                      <option key={l} value={l}>
                        {l.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>

          {/* Section: Reply Style */}
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <h2 className={styles.cardTitle}>AI Reply Tone & Guidelines</h2>
              <p className={styles.cardDesc}>Configure how AI writes draft responses to your Instagram DMs.</p>
            </div>
            <div className={styles.prefList}>
              <div className={styles.prefRow}>
                <div className={styles.prefLabelGroup}>
                  <span className={styles.prefLabel}>Reply Tone</span>
                  <span className={styles.prefSublabel}>Select the primary voice for AI suggestions</span>
                </div>
                <select
                  className="select btn-sm"
                  value={prefs.tone}
                  onChange={(e) => updateField('tone', e.target.value)}
                  style={{ width: '150px' }}
                >
                  {TONES.map(t => (
                    <option key={t} value={t}>
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </option>
                  ))}
                </select>
              </div>

              <div className={styles.prefRowVertical}>
                <span className={styles.prefLabel}>Custom Instructions</span>
                <span className={styles.prefSublabel}>Add specific rules (e.g., &quot;Include my booking link for collabs over $500&quot;)</span>
                <textarea
                  className="textarea"
                  placeholder="e.g., Always mention my manager's email for brand deals. Keep replies under 3 sentences."
                  value={prefs.customInstructions || ''}
                  onChange={(e) => updateField('customInstructions', e.target.value)}
                  style={{ marginTop: '8px' }}
                />
              </div>

              <div className={styles.prefRow}>
                <div className={styles.prefLabelGroup}>
                  <span className={styles.prefLabel}>Auto-Generate Summaries</span>
                  <span className={styles.prefSublabel}>Create AI summary notes for active conversations</span>
                </div>
                <select
                  className="select btn-sm"
                  value={prefs.autoGenerateSummary ? 'on' : 'off'}
                  onChange={(e) => updateField('autoGenerateSummary', e.target.value === 'on')}
                  style={{ width: '100px' }}
                >
                  <option value="on">ENABLED</option>
                  <option value="off">DISABLED</option>
                </select>
              </div>
            </div>
          </div>

          {/* Section: Specific Chat Auto-Replies */}
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <div className={styles.chatHeaderRow}>
                <div>
                  <h2 className={styles.cardTitle}>⚡ Specific Chat AI Auto-Reply</h2>
                  <p className={styles.cardDesc}>
                    Turn on automated AI replies for specific chats only. Global auto-reply is disabled by default so you stay in total control.
                  </p>
                </div>
                <span className={styles.chatCountBadge}>
                  {activeAutoReplyCount} {activeAutoReplyCount === 1 ? 'Chat Active' : 'Chats Active'}
                </span>
              </div>
            </div>

            {/* Search filter for chats */}
            {autoReplyChats.length > 0 && (
              <input
                type="text"
                className={styles.chatSearchInput}
                placeholder="Search conversations by username, contact name, or message..."
                value={chatSearch}
                onChange={(e) => setChatSearch(e.target.value)}
              />
            )}

            <div className={styles.chatList}>
              {autoReplyChats.length === 0 ? (
                <div className={styles.emptyChats}>
                  No conversations found yet. When users message your Instagram account, they will appear here.
                </div>
              ) : filteredChats.length === 0 ? (
                <div className={styles.emptyChats}>
                  No matching chats found for &quot;{chatSearch}&quot;.
                </div>
              ) : (
                filteredChats.map((chat) => {
                  const isExpanded = expandedChatId === chat.id;
                  const promptVal = customPrompts[chat.id] ?? (chat.autoReplyPrompt || '');

                  return (
                    <div
                      key={chat.id}
                      className={`${styles.chatItem} ${chat.autoReplyEnabled ? styles.chatItemActive : ''}`}
                    >
                      <div className={styles.chatItemMain}>
                        <div className={styles.chatItemLeft}>
                          {chat.contact?.profilePicUrl ? (
                            <img
                              src={chat.contact.profilePicUrl}
                              alt={chat.contact.username}
                              className={styles.chatAvatar}
                            />
                          ) : (
                            <div className={styles.chatAvatarFallback}>
                              {(chat.contact?.username || '?')[0].toUpperCase()}
                            </div>
                          )}
                          <div className={styles.chatMeta}>
                            <div className={styles.chatNameRow}>
                              <span className={styles.chatUsername}>
                                @{chat.contact?.username || chat.contact?.name || 'Unknown'}
                              </span>
                              {chat.instagramAccount?.igUsername && (
                                <span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>
                                  on @{chat.instagramAccount.igUsername}
                                </span>
                              )}
                            </div>
                            <span className={styles.chatPreview}>
                              {chat.lastMessage || '(No messages yet)'}
                            </span>
                          </div>
                        </div>

                        <div className={styles.chatActions}>
                          <button
                            className={`${styles.autoReplyToggleBtn} ${chat.autoReplyEnabled ? styles.autoReplyToggleBtnActive : ''}`}
                            onClick={() => handleToggleChatAutoReply(chat.id, chat.autoReplyEnabled)}
                            title={chat.autoReplyEnabled ? 'Auto-Reply is ON (click to turn OFF)' : 'Auto-Reply is OFF (click to turn ON)'}
                          >
                            {chat.autoReplyEnabled ? '⚡ Auto-Reply ON' : '🤖 Auto-Reply OFF'}
                          </button>

                          <button
                            className="btn btn-secondary btn-sm"
                            style={{ fontSize: '11px', padding: '4px 8px' }}
                            onClick={() => setExpandedChatId(isExpanded ? null : chat.id)}
                            title="Edit custom prompt for this contact"
                          >
                            {isExpanded ? 'Close' : '✏️ Prompt'}
                          </button>

                          <Link
                            href={`/inbox?conversationId=${chat.id}`}
                            className="btn btn-secondary btn-sm"
                            style={{ fontSize: '11px', padding: '4px 8px' }}
                            title="Open in Inbox"
                          >
                            ↗ Chat
                          </Link>
                        </div>
                      </div>

                      {/* Custom Prompt Accordion */}
                      {isExpanded && (
                        <div className={styles.chatPromptEditor}>
                          <label className={styles.chatPromptLabel}>
                            Custom Auto-Reply Instructions for @{chat.contact?.username || 'this user'}:
                          </label>
                          <textarea
                            className="textarea"
                            placeholder="e.g. For this customer, offer 15% discount code SAVE15 and ask for their email address."
                            value={promptVal}
                            onChange={(e) => setCustomPrompts(prev => ({ ...prev, [chat.id]: e.target.value }))}
                            rows={2}
                            style={{ fontSize: '12px' }}
                          />
                          <div className={styles.chatPromptActions}>
                            <button
                              className="btn btn-primary btn-sm"
                              style={{ fontSize: '11px' }}
                              onClick={() => handleSaveChatPrompt(chat.id)}
                            >
                              Save & Enable Auto-Reply
                            </button>
                            <button
                              className="btn btn-secondary btn-sm"
                              style={{ fontSize: '11px' }}
                              onClick={() => setExpandedChatId(null)}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Save Bar */}
          <div className={styles.saveBar}>
            {saved && <span className={styles.savedMessage}>✓ Settings saved successfully</span>}
            <button className="btn btn-primary btn-lg" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save Settings'}
            </button>
          </div>
        </div>
      )}
    </AppShell>
  );
}
