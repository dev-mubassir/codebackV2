'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  getMe,
  getAISettings,
  updateAISettings,
  getBusinessProfile,
  updateBusinessProfile,
  getAutoReplyChats,
  toggleAutoReply,
} from '@/lib/api';
import AppShell from '@/app/components/AppShell';
import styles from './settings.module.css';

const LEVELS = ['critical', 'high', 'normal', 'low', 'off'];
const TONES = ['friendly', 'professional', 'casual', 'concise', 'warm', 'custom'];
const AUTO_REPLY_MODES = [
  { id: 'smart', label: '⚡ Smart Auto-Reply (Safe, qualified questions only)' },
  { id: 'suggest_only', label: '💡 Suggest Only (Draft AI replies for you to review and click Send)' },
  { id: 'human_only', label: '👤 Human Only (Never automatically send any messages)' },
];

const PRIORITY_ROWS = [
  { key: 'customersPriority', label: '💰 Hot Leads & Customers' },
  { key: 'brandDealsPriority', label: '🔥 Brand Deals & Sponsorships' },
  { key: 'collaborationsPriority', label: '🤝 Collaborations & Partnerships' },
  { key: 'questionsPriority', label: '❓ General Questions & FAQs' },
  { key: 'fanPriority', label: '❤️ Fan & Social Messages' },
  { key: 'spamPriority', label: '🚫 Spam & Low Relevance' },
];

export default function SettingsPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('profile'); // 'profile' | 'ai' | 'chats'
  const [prefs, setPrefs] = useState(null);
  const [businessProfile, setBusinessProfile] = useState(null);
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
        const [settingsData, profileData, chatsData] = await Promise.all([
          getAISettings().catch(() => ({})),
          getBusinessProfile().catch(() => ({})),
          getAutoReplyChats().catch(() => []),
        ]);
        setPrefs(settingsData);
        setBusinessProfile(profileData);
        setAutoReplyChats(chatsData || []);

        const initialPrompts = {};
        (chatsData || []).forEach((c) => {
          if (c.autoReplyPrompt) initialPrompts[c.id] = c.autoReplyPrompt;
        });
        setCustomPrompts(initialPrompts);
      } catch (err) {
        router.push('/login');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [router]);

  function updatePrefField(key, value) {
    setPrefs((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  function updateProfileField(key, value) {
    setBusinessProfile((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  async function handleToggleChatAutoReply(chatId, currentStatus) {
    const newStatus = !currentStatus;
    const prompt = customPrompts[chatId] || null;
    try {
      await toggleAutoReply(chatId, newStatus, prompt);
      setAutoReplyChats((prev) =>
        prev.map((c) => (c.id === chatId ? { ...c, autoReplyEnabled: newStatus, autoReplyPrompt: prompt } : c))
      );
    } catch (err) {
      alert('Failed to update chat auto-reply status');
    }
  }

  async function handleSaveChatPrompt(chatId) {
    const prompt = customPrompts[chatId] || null;
    try {
      await toggleAutoReply(chatId, true, prompt);
      setAutoReplyChats((prev) =>
        prev.map((c) => (c.id === chatId ? { ...c, autoReplyEnabled: true, autoReplyPrompt: prompt } : c))
      );
      setExpandedChatId(null);
    } catch (err) {
      alert('Failed to save custom instructions for chat');
    }
  }

  async function handleSaveAll() {
    setSaving(true);
    try {
      if (prefs) {
        await updateAISettings({
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
      }

      if (businessProfile) {
        const updatedProfile = await updateBusinessProfile(businessProfile);
        setBusinessProfile(updatedProfile);
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      alert('Failed to save settings. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  const filteredChats = autoReplyChats.filter((c) => {
    if (!chatSearch.trim()) return true;
    const query = chatSearch.toLowerCase();
    const username = (c.contact?.username || '').toLowerCase();
    const name = (c.contact?.name || '').toLowerCase();
    const lastMsg = (c.lastMessage || '').toLowerCase();
    return username.includes(query) || name.includes(query) || lastMsg.includes(query);
  });

  const activeAutoReplyCount = autoReplyChats.filter((c) => c.autoReplyEnabled).length;

  return (
    <AppShell activeRoute="/settings">
      {/* Page Header */}
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>⚙️ Settings & Knowledge Base</h1>
          <p className={styles.pageSubtitle}>
            Train your AI assistant on your business facts, configure response tone, and manage per-chat automation.
          </p>
        </div>

        {/* Tab Navigation */}
        <div className={styles.tabNav}>
          <button
            className={`${styles.tabBtn} ${activeTab === 'profile' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('profile')}
          >
            🏢 Business Profile & FAQs
          </button>
          <button
            className={`${styles.tabBtn} ${activeTab === 'ai' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('ai')}
          >
            🤖 AI Reply Tone & Automation
          </button>
          <button
            className={`${styles.tabBtn} ${activeTab === 'chats' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('chats')}
          >
            ⚡ Per-Chat Auto-Reply ({activeAutoReplyCount})
          </button>
        </div>
      </div>

      {loading || !businessProfile || !prefs ? (
        <div className={styles.loadingContainer}>
          <div className="spinner spinner-lg" />
        </div>
      ) : (
        <div className={styles.settingsGrid}>
          {/* TAB 1: Business Profile & Knowledge Base */}
          {activeTab === 'profile' && (
            <>
              <div className={styles.card}>
                <div className={styles.cardHeader}>
                  <h2 className={styles.cardTitle}>🏢 Core Business Profile</h2>
                  <p className={styles.cardDesc}>
                    AI uses this context to accurately identify your leads and answer customer questions without hallucination.
                  </p>
                </div>

                <div className={styles.prefList}>
                  <div className={styles.prefRowVertical}>
                    <label className={styles.prefLabel}>Business / Brand Name</label>
                    <input
                      type="text"
                      className="input"
                      value={businessProfile.businessName || ''}
                      onChange={(e) => updateProfileField('businessName', e.target.value)}
                      placeholder="e.g. Apex Visuals Studio or TechGear Store"
                      style={{ marginTop: '6px' }}
                    />
                  </div>

                  <div className={styles.prefRowVertical}>
                    <label className={styles.prefLabel}>What You Do / Business Description</label>
                    <textarea
                      className="textarea"
                      rows={2}
                      value={businessProfile.description || ''}
                      onChange={(e) => updateProfileField('description', e.target.value)}
                      placeholder="e.g. Premium short-form video editing for creators and businesses."
                      style={{ marginTop: '6px' }}
                    />
                  </div>

                  <div className={styles.prefRowVertical}>
                    <label className={styles.prefLabel}>Products or Services Offered</label>
                    <textarea
                      className="textarea"
                      rows={3}
                      value={businessProfile.productsServices || ''}
                      onChange={(e) => updateProfileField('productsServices', e.target.value)}
                      placeholder="List products or services with details (e.g. Reels editing, long-form YouTube editing, thumbnail design)."
                      style={{ marginTop: '6px' }}
                    />
                  </div>

                  <div className={styles.prefRowVertical}>
                    <label className={styles.prefLabel}>Pricing & Package Rates</label>
                    <textarea
                      className="textarea"
                      rows={3}
                      value={businessProfile.pricingInfo || ''}
                      onChange={(e) => updateProfileField('pricingInfo', e.target.value)}
                      placeholder="e.g. Reel editing: ₹750/reel. 10-Reel Pack: ₹6,500. Custom projects: quote on review."
                      style={{ marginTop: '6px' }}
                    />
                    <span className={styles.prefSublabel}>AI will quote these exact rates when customers ask about pricing.</span>
                  </div>

                  <div className={styles.prefRowVertical}>
                    <label className={styles.prefLabel}>Turnaround Time, Location & Shipping / Delivery</label>
                    <textarea
                      className="textarea"
                      rows={2}
                      value={businessProfile.policies || ''}
                      onChange={(e) => updateProfileField('policies', e.target.value)}
                      placeholder="e.g. 48-hour delivery. 2 rounds of free revisions included. Pan-India shipping in 3-5 days."
                      style={{ marginTop: '6px' }}
                    />
                  </div>

                  <div className={styles.prefRowVertical}>
                    <label className={styles.prefLabel}>Payment Methods Accepted</label>
                    <input
                      type="text"
                      className="input"
                      value={businessProfile.paymentMethods || ''}
                      onChange={(e) => updateProfileField('paymentMethods', e.target.value)}
                      placeholder="e.g. UPI, Bank Transfer, PayPal, Stripe invoice"
                      style={{ marginTop: '6px' }}
                    />
                  </div>

                  <div className={styles.prefRowVertical}>
                    <label className={styles.prefLabel}>Frequently Asked Questions (FAQs)</label>
                    <textarea
                      className="textarea"
                      rows={4}
                      value={businessProfile.faqData || ''}
                      onChange={(e) => updateProfileField('faqData', e.target.value)}
                      placeholder="Q: How do I send footage? A: Send via Google Drive link.&#10;Q: Do you offer discounts? A: 10% off for 5+ videos."
                      style={{ marginTop: '6px' }}
                    />
                  </div>

                  <div className={styles.prefRowVertical}>
                    <label className={styles.prefLabel}>Strictly Prohibited Topics & Facts</label>
                    <textarea
                      className="textarea"
                      rows={2}
                      value={businessProfile.prohibitedTopics || ''}
                      onChange={(e) => updateProfileField('prohibitedTopics', e.target.value)}
                      placeholder="e.g. Never promise same-day delivery without prior confirmation. Never offer unapproved discounts."
                      style={{ marginTop: '6px' }}
                    />
                    <span className={styles.prefSublabel}>AI will strictly refuse to make up promises on these topics.</span>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* TAB 2: AI Reply Tone & Automation */}
          {activeTab === 'ai' && (
            <>
              <div className={styles.card}>
                <div className={styles.cardHeader}>
                  <h2 className={styles.cardTitle}>🤖 AI Reply Tone & Automation Mode</h2>
                  <p className={styles.cardDesc}>
                    Configure how and when AI responds to customer messages.
                  </p>
                </div>

                <div className={styles.prefList}>
                  <div className={styles.prefRow}>
                    <div className={styles.prefLabelGroup}>
                      <span className={styles.prefLabel}>Automation Mode</span>
                      <span className={styles.prefSublabel}>Control whether AI can auto-send or only suggest replies</span>
                    </div>
                    <select
                      className="select"
                      value={businessProfile.autoReplyMode || 'smart'}
                      onChange={(e) => updateProfileField('autoReplyMode', e.target.value)}
                      style={{ maxWidth: '280px' }}
                    >
                      {AUTO_REPLY_MODES.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className={styles.prefRow}>
                    <div className={styles.prefLabelGroup}>
                      <span className={styles.prefLabel}>Reply Tone</span>
                      <span className={styles.prefSublabel}>Select the voice AI uses when drafting responses</span>
                    </div>
                    <select
                      className="select"
                      value={businessProfile.tone || 'friendly'}
                      onChange={(e) => {
                        updateProfileField('tone', e.target.value);
                        updatePrefField('tone', e.target.value);
                      }}
                      style={{ width: '180px' }}
                    >
                      {TONES.map((t) => (
                        <option key={t} value={t}>
                          {t.charAt(0).toUpperCase() + t.slice(1)}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className={styles.prefRowVertical}>
                    <span className={styles.prefLabel}>Custom AI Behavior Instructions</span>
                    <span className={styles.prefSublabel}>Specific rules (e.g. &quot;Always be concise, max 2 sentences, ask for customer location before shipping&quot;)</span>
                    <textarea
                      className="textarea"
                      rows={3}
                      value={businessProfile.aiInstructions || ''}
                      onChange={(e) => updateProfileField('aiInstructions', e.target.value)}
                      placeholder="e.g. Always greet warmly. Ask for project details before finalizing quotes."
                      style={{ marginTop: '8px' }}
                    />
                  </div>

                  <div className={styles.prefRow}>
                    <div className={styles.prefLabelGroup}>
                      <span className={styles.prefLabel}>Auto-Generate Summaries</span>
                      <span className={styles.prefSublabel}>Generate AI summary notes for active conversation threads</span>
                    </div>
                    <select
                      className="select"
                      value={prefs.autoGenerateSummary ? 'on' : 'off'}
                      onChange={(e) => updatePrefField('autoGenerateSummary', e.target.value === 'on')}
                      style={{ width: '120px' }}
                    >
                      <option value="on">ENABLED</option>
                      <option value="off">DISABLED</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Priority Weights */}
              <div className={styles.card}>
                <div className={styles.cardHeader}>
                  <h2 className={styles.cardTitle}>🎯 Category Priority Weights</h2>
                  <p className={styles.cardDesc}>Customize how Codeback ranks different types of conversations in your inbox.</p>
                </div>
                <div className={styles.prefList}>
                  {PRIORITY_ROWS.map((row) => (
                    <div className={styles.prefRow} key={row.key}>
                      <span className={styles.prefLabel}>{row.label}</span>
                      <select
                        className="select btn-sm"
                        value={prefs[row.key] || 'normal'}
                        onChange={(e) => updatePrefField(row.key, e.target.value)}
                        style={{ width: '130px' }}
                      >
                        {LEVELS.map((l) => (
                          <option key={l} value={l}>
                            {l.toUpperCase()}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* TAB 3: Per-Chat Auto-Reply Manager */}
          {activeTab === 'chats' && (
            <div className={styles.card}>
              <div className={styles.cardHeader}>
                <div className={styles.chatHeaderRow}>
                  <div>
                    <h2 className={styles.cardTitle}>⚡ Specific Chat AI Auto-Reply</h2>
                    <p className={styles.cardDesc}>
                      Enable 24/7 automated AI messaging for specific Instagram DM conversations only. Global auto-reply is disabled by default so you stay in total control.
                    </p>
                  </div>
                  <span className={styles.chatCountBadge}>
                    {activeAutoReplyCount} {activeAutoReplyCount === 1 ? 'Chat Active' : 'Chats Active'}
                  </span>
                </div>
              </div>

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
                  <div className={styles.emptyChats}>No matching chats found for &quot;{chatSearch}&quot;.</div>
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
                              <span className={styles.chatPreview}>{chat.lastMessage || '(No messages yet)'}</span>
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
                              placeholder="e.g. Always offer 10% coupon code SAVE10 for this customer."
                              value={promptVal}
                              onChange={(e) => setCustomPrompts((prev) => ({ ...prev, [chat.id]: e.target.value }))}
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
          )}

          {/* Save Bar */}
          <div className={styles.saveBar}>
            {saved && <span className={styles.savedMessage}>✓ Settings saved successfully</span>}
            <button className="btn btn-primary btn-lg" onClick={handleSaveAll} disabled={saving}>
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>
      )}
    </AppShell>
  );
}
