'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
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
import {
  BUSINESS_CATEGORIES,
  DEFAULT_KNOWLEDGE_TEMPLATES,
  getCategoryMetadata,
  parseBusinessTypes,
  combineKnowledgeTemplates,
  DEFAULT_BUSINESS_TYPE,
  toggleBusinessType,
} from '@/lib/businessTemplates';
import AppShell from '@/app/components/AppShell';
import PlanSummaryPanel from '@/app/components/billing/PlanSummaryPanel';
import Icon from '@/app/components/Icon';
import { settings as t, common, errors, empty, confirm as confirmCopy, toast } from '@/content/copy';
import {
  PRIORITY_WEIGHT_ORDER,
  TONE_ORDER,
  priorityWeightLabel,
  toneLabel,
  replyModeLabel,
  replyModeSendsAutomatically,
  DEFAULT_REPLY_MODE,
} from '@/content/labels';
import { plural } from '@/content/format';
import styles from './settings.module.css';

// Stored values, unchanged — only their display wording lives in labels.js.
const REPLY_MODES = ['smart', 'suggest_only', 'human_only'];

const PRIORITY_ROW_KEYS = [
  'customersPriority',
  'brandDealsPriority',
  'collaborationsPriority',
  'questionsPriority',
  'fanPriority',
  'spamPriority',
];

function SettingsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Legacy links used ?tab=ai and ?tab=chats. Map them so old bookmarks and
  // any link still in the wild land on the right tab.
  const LEGACY_TABS = { ai: 'replies', chats: 'conversations' };
  const rawTab = searchParams.get('tab') || 'profile';
  const initialTab = LEGACY_TABS[rawTab] || rawTab;

  const [activeTab, setActiveTab] = useState(initialTab); // 'profile' | 'replies' | 'conversations'
  const [prefs, setPrefs] = useState(null);
  const [businessProfile, setBusinessProfile] = useState(null);
  const [autoReplyChats, setAutoReplyChats] = useState([]);
  const [chatSearch, setChatSearch] = useState('');
  const [expandedChatId, setExpandedChatId] = useState(null);
  const [customPrompts, setCustomPrompts] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // From /auth/me. Gates the plan panel so that, pre-launch, settings makes no
  // billing request at all rather than one that 404s.
  const [billingEnabled, setBillingEnabled] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const me = await getMe();
        setBillingEnabled(Boolean(me?.features?.billing));
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

  function handleToggleCategory(catId) {
    const current = parseBusinessTypes(businessProfile?.businessTypes, businessProfile?.primaryCategory);
    // Shared with onboarding: picking a type replaces the "Something else"
    // placeholder, and turning off the last type falls back to it.
    const next = toggleBusinessType(current, catId);
    setBusinessProfile((prev) => ({
      ...prev,
      businessTypes: JSON.stringify(next),
      primaryCategory: next[0] || DEFAULT_BUSINESS_TYPE,
    }));
    setSaved(false);
  }

  function handleApplyCombinedTemplates() {
    const current = parseBusinessTypes(businessProfile?.businessTypes, businessProfile?.primaryCategory);
    const combined = combineKnowledgeTemplates(current);
    if (!combined) return;
    if (confirm(`${confirmCopy.loadTemplate.title}\n\n${confirmCopy.loadTemplate.body}`)) {
      setBusinessProfile((prev) => ({
        ...prev,
        description: combined.description || '',
        productsServices: combined.productsServices || '',
        pricingInfo: combined.pricingInfo || '',
        locationDelivery: combined.locationDelivery || '',
        policies: combined.policies || '',
        paymentMethods: combined.paymentMethods || '',
        faqData: combined.faqData || '',
        aiInstructions: combined.aiInstructions || '',
        tone: combined.tone || 'friendly',
      }));
      setSaved(false);
    }
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
      alert(errors.toggleAutomation);
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
      alert(errors.saveSettings);
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
      alert(errors.saveSettings);
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
        <div className={styles.pageHeaderTop}>
          <div className={styles.headerLeft}>
            <div className={styles.headerIconBadge}>
              <Icon name="settings" size={24} />
            </div>
            <div>
              <h1 className={styles.pageTitle}>{t.title}</h1>
              <p className={styles.pageSubtitle}>{t.subtitle}</p>
            </div>
          </div>
        </div>

        <div className={styles.tabNav}>
          <button
            className={`${styles.tabBtn} ${activeTab === 'profile' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('profile')}
          >
            <Icon name="briefcase" size={15} /> {t.tabs.profile}
          </button>
          <button
            className={`${styles.tabBtn} ${activeTab === 'replies' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('replies')}
          >
            <Icon name="sparkle" size={15} /> {t.tabs.replies}
          </button>
          <button
            className={`${styles.tabBtn} ${activeTab === 'conversations' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('conversations')}
          >
            <Icon name="zap" size={15} /> {t.tabs.conversations}
            <span className={styles.tabBadge}>{activeAutoReplyCount}</span>
          </button>
        </div>
      </div>

      {loading || !businessProfile || !prefs ? (
        <div className={styles.loadingContainer} aria-busy="true" aria-label={common.loading}>
          <div className="spinner spinner-lg" />
        </div>
      ) : (
        <div className={styles.settingsGrid}>
          {/* TAB 1: business profile */}
          {activeTab === 'profile' && (
            <>
              {billingEnabled && <PlanSummaryPanel />}

              <div className={styles.card}>
                <div className={styles.cardHeader}>
                  <h2 className={styles.cardTitle}>{t.businessProfile.title}</h2>
                  <p className={styles.cardDesc}>{t.businessProfile.description}</p>
                </div>

                <div className={styles.prefList}>
                  {/* Interactive Business Category Cards Grid (Multi-select) */}
                  <div className={styles.prefRowVertical}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                      <label className={styles.prefLabel} style={{ margin: 0 }}>{t.businessProfile.typesLabel}</label>
                      <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-primary)', background: 'rgba(124, 58, 237, 0.1)', padding: '2px 8px', borderRadius: 'var(--radius-full)' }}>
                        {parseBusinessTypes(businessProfile.businessTypes, businessProfile.primaryCategory).length} {t.businessProfile.selectedCount}
                      </span>
                    </div>
                    <span className={styles.prefSublabel}>{t.businessProfile.typesHint}</span>
                    <div className={styles.categoryGrid}>
                      {BUSINESS_CATEGORIES.map((cat) => {
                        const currentSelected = parseBusinessTypes(businessProfile.businessTypes, businessProfile.primaryCategory);
                        const isSelected = currentSelected.includes(cat.id);
                        return (
                          <button
                            key={cat.id}
                            type="button"
                            className={`${styles.categoryCard} ${isSelected ? styles.categoryCardActive : ''}`}
                            onClick={() => handleToggleCategory(cat.id)}
                          >
                            {isSelected && (
                              <span className={styles.categorySelectedBadge}>
                                <Icon name="check" size={10} /> On
                              </span>
                            )}
                            <span className={styles.categoryIcon}><Icon name={cat.icon} size={18} /></span>
                            <span className={styles.categoryTitle}>{cat.label}</span>
                            <span className={styles.categoryDesc}>{cat.summary}</span>
                          </button>
                        );
                      })}
                    </div>

                    {/* Quick Template Loader Banner */}
                    <div className={styles.templateActionBanner}>
                      <span className={styles.templateActionText}>
                        {t.businessProfile.templateBannerPrefix}{' '}
                        <strong>
                          {parseBusinessTypes(businessProfile.businessTypes, businessProfile.primaryCategory)
                            .map((id) => getCategoryMetadata(id).label)
                            .join(', ')}
                        </strong>
                      </span>
                      <button
                        type="button"
                        className={styles.templateActionBtn}
                        onClick={handleApplyCombinedTemplates}
                      >
                        <Icon name="sparkle" size={13} /> {t.businessProfile.applyTemplate}
                      </button>
                    </div>
                  </div>

                  <div className={styles.prefRowVertical}>
                    <label className={styles.prefLabel}>{t.businessProfile.nameLabel}</label>
                    <input
                      type="text"
                      className="input"
                      value={businessProfile.businessName || ''}
                      onChange={(e) => updateProfileField('businessName', e.target.value)}
                      placeholder={t.businessProfile.namePlaceholder}
                      style={{ marginTop: '6px' }}
                    />
                  </div>

                  <div className={styles.prefRowVertical}>
                    <label className={styles.prefLabel}>{t.businessProfile.descriptionLabel}</label>
                    <textarea
                      className="textarea"
                      rows={2}
                      value={businessProfile.description || ''}
                      onChange={(e) => updateProfileField('description', e.target.value)}
                      placeholder={t.businessProfile.descriptionPlaceholder}
                      style={{ marginTop: '6px' }}
                    />
                  </div>

                  <div className={styles.prefRowVertical}>
                    <label className={styles.prefLabel}>{t.businessProfile.servicesLabel}</label>
                    <textarea
                      className="textarea"
                      rows={3}
                      value={businessProfile.productsServices || ''}
                      onChange={(e) => updateProfileField('productsServices', e.target.value)}
                      placeholder={t.businessProfile.servicesPlaceholder}
                      style={{ marginTop: '6px' }}
                    />
                  </div>

                  <div className={styles.prefRowVertical}>
                    <label className={styles.prefLabel}>{t.businessProfile.pricingLabel}</label>
                    <textarea
                      className="textarea"
                      rows={3}
                      value={businessProfile.pricingInfo || ''}
                      onChange={(e) => updateProfileField('pricingInfo', e.target.value)}
                      placeholder={t.businessProfile.pricingPlaceholder}
                      style={{ marginTop: '6px' }}
                    />
                    <span className={styles.prefSublabel}>{t.businessProfile.pricingHint}</span>
                  </div>

                  <div className={styles.prefRowVertical}>
                    <label className={styles.prefLabel}>{t.businessProfile.policiesLabel}</label>
                    <textarea
                      className="textarea"
                      rows={2}
                      value={businessProfile.policies || ''}
                      onChange={(e) => updateProfileField('policies', e.target.value)}
                      placeholder={t.businessProfile.policiesPlaceholder}
                      style={{ marginTop: '6px' }}
                    />
                  </div>

                  <div className={styles.prefRowVertical}>
                    <label className={styles.prefLabel}>{t.businessProfile.paymentLabel}</label>
                    <input
                      type="text"
                      className="input"
                      value={businessProfile.paymentMethods || ''}
                      onChange={(e) => updateProfileField('paymentMethods', e.target.value)}
                      placeholder={t.businessProfile.paymentPlaceholder}
                      style={{ marginTop: '6px' }}
                    />
                  </div>

                  <div className={styles.prefRowVertical}>
                    <label className={styles.prefLabel}>{t.businessProfile.faqLabel}</label>
                    <textarea
                      className="textarea"
                      rows={4}
                      value={businessProfile.faqData || ''}
                      onChange={(e) => updateProfileField('faqData', e.target.value)}
                      placeholder={t.businessProfile.faqPlaceholder}
                      style={{ marginTop: '6px' }}
                    />
                  </div>

                  <div className={styles.prefRowVertical}>
                    <div className={styles.forbiddenBox}>
                      <div className={styles.forbiddenBoxHeader}>
                        <Icon name="shieldAlert" size={16} />
                        <span>{t.businessProfile.prohibitedLabel}</span>
                      </div>
                      <span className={styles.prefSublabel}>{t.businessProfile.prohibitedHint}</span>
                      <textarea
                        className="textarea"
                        rows={3}
                        value={businessProfile.prohibitedTopics || ''}
                        onChange={(e) => updateProfileField('prohibitedTopics', e.target.value)}
                        placeholder={t.businessProfile.prohibitedPlaceholder}
                        style={{ marginTop: '8px', background: '#ffffff' }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* TAB 2: replies and tone */}
          {activeTab === 'replies' && (
            <>
              <div className={styles.card}>
                <div className={styles.cardHeader}>
                  <h2 className={styles.cardTitle}>{t.replies.title}</h2>
                  <p className={styles.cardDesc}>{t.replies.description}</p>
                </div>

                <div className={styles.prefList}>
                  {/* REMOVED-BY-COPY-AUDIT: duplicated control. A two-button
                      "Master AI Auto-Reply ON/OFF" pair sat directly above a
                      three-option select bound to the SAME field, so choosing
                      "suggest_only" in the select left neither button
                      highlighted and the user could not tell which control was
                      in charge. The single three-option control below is the
                      only one now, and it names each mode plainly. Restore by
                      re-adding the button pair here — but reconcile it with the
                      select first, because they cannot both own one field.
                  */}
                  <div className={styles.prefRowVertical} style={{ background: 'var(--bg-surface-secondary)', padding: '16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-default)' }}>
                    <span className={styles.prefLabel} style={{ fontSize: '15px', fontWeight: 700 }}>
                      {t.replies.modeLabel}
                    </span>
                    <span className={styles.prefSublabel}>{t.replies.modeHint}</span>
                    <div className={styles.modeOptions}>
                      {REPLY_MODES.map((mode) => {
                        const meta = replyModeLabel(mode);
                        const isActive = (businessProfile.autoReplyMode || DEFAULT_REPLY_MODE) === mode;
                        return (
                          <button
                            key={mode}
                            type="button"
                            className={`${styles.modeOption} ${isActive ? styles.modeOptionActive : ''}`}
                            onClick={() => updateProfileField('autoReplyMode', mode)}
                            aria-pressed={isActive}
                          >
                            <span className={styles.modeOptionTop}>
                              <Icon name={replyModeSendsAutomatically(mode) ? 'zap' : 'user'} size={14} />
                              <span className={styles.modeOptionLabel}>{meta.label}</span>
                              {isActive && <Icon name="check" size={13} />}
                            </span>
                            <span className={styles.modeOptionDesc}>{meta.description}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className={styles.prefRow}>
                    <div className={styles.prefLabelGroup}>
                      <span className={styles.prefLabel}>{t.replies.toneLabel}</span>
                      <span className={styles.prefSublabel}>{t.replies.toneHint}</span>
                    </div>
                    <select
                      className="select"
                      value={businessProfile.tone || 'friendly'}
                      onChange={(e) => {
                        updateProfileField('tone', e.target.value);
                        updatePrefField('tone', e.target.value);
                      }}
                      aria-label={t.replies.toneLabel}
                      style={{ width: '220px' }}
                    >
                      {TONE_ORDER.map((value) => (
                        <option key={value} value={value}>
                          {toneLabel(value).label} — {toneLabel(value).description}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className={styles.prefRowVertical}>
                    <span className={styles.prefLabel}>{t.replies.instructionsLabel}</span>
                    <span className={styles.prefSublabel}>{t.replies.instructionsHint}</span>
                    <textarea
                      className="textarea"
                      rows={3}
                      value={businessProfile.aiInstructions || ''}
                      onChange={(e) => updateProfileField('aiInstructions', e.target.value)}
                      placeholder={t.replies.instructionsPlaceholder}
                      style={{ marginTop: '8px' }}
                    />
                  </div>

                  <div className={styles.prefRow}>
                    <div className={styles.prefLabelGroup}>
                      <span className={styles.prefLabel}>{t.replies.summariesLabel}</span>
                      <span className={styles.prefSublabel}>{t.replies.summariesHint}</span>
                    </div>
                    <select
                      className="select"
                      value={prefs.autoGenerateSummary ? 'on' : 'off'}
                      onChange={(e) => updatePrefField('autoGenerateSummary', e.target.value === 'on')}
                      aria-label={t.replies.summariesLabel}
                      style={{ width: '120px' }}
                    >
                      <option value="on">{t.replies.summariesOn}</option>
                      <option value="off">{t.replies.summariesOff}</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className={styles.card}>
                <div className={styles.cardHeader}>
                  <h2 className={styles.cardTitle}>{t.priorities.title}</h2>
                  <p className={styles.cardDesc}>{t.priorities.description}</p>
                </div>
                <div className={styles.prefList}>
                  {PRIORITY_ROW_KEYS.map((key) => (
                    <div className={styles.prefRow} key={key}>
                      <span className={styles.prefLabel}>{t.priorities.rows[key]}</span>
                      <select
                        className="select btn-sm"
                        value={prefs[key] || 'normal'}
                        onChange={(e) => updatePrefField(key, e.target.value)}
                        aria-label={t.priorities.rows[key]}
                        style={{ width: '150px' }}
                      >
                        {PRIORITY_WEIGHT_ORDER.map((level) => (
                          <option key={level} value={level}>
                            {priorityWeightLabel(level).label}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* TAB 3: per-conversation automation */}
          {activeTab === 'conversations' && (
            <div className={styles.card}>
              <div className={styles.cardHeader}>
                <div className={styles.chatHeaderRow}>
                  <div>
                    <h2 className={styles.cardTitle}>{t.perConversation.title}</h2>
                    <p className={styles.cardDesc}>{t.perConversation.description}</p>
                  </div>
                  <span className={styles.chatCountBadge}>
                    {plural(activeAutoReplyCount, 'conversation')} {t.perConversation.activeCount}
                  </span>
                </div>
              </div>

              {!replyModeSendsAutomatically(businessProfile.autoReplyMode) && (
                <div className={styles.inlineNotice} role="note">
                  <Icon name="info" size={14} />
                  <span>{t.perConversation.requiresAutomaticMode}</span>
                </div>
              )}

              {autoReplyChats.length > 0 && (
                <input
                  type="text"
                  className={styles.chatSearchInput}
                  placeholder={t.perConversation.searchPlaceholder}
                  aria-label={t.perConversation.searchPlaceholder}
                  value={chatSearch}
                  onChange={(e) => setChatSearch(e.target.value)}
                />
              )}

              <div className={styles.chatList}>
                {autoReplyChats.length === 0 ? (
                  <div className={styles.emptyChats}>{empty.perConversation.body}</div>
                ) : filteredChats.length === 0 ? (
                  <div className={styles.emptyChats}>{empty.search.body}</div>
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
                                alt=""
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
                              <span className={styles.chatPreview}>{chat.lastMessage || t.perConversation.noMessagesYet}</span>
                            </div>
                          </div>

                          <div className={styles.chatActions}>
                            <button
                              className={`${styles.autoReplyToggleBtn} ${chat.autoReplyEnabled ? styles.autoReplyToggleBtnActive : ''}`}
                              onClick={() => handleToggleChatAutoReply(chat.id, chat.autoReplyEnabled)}
                              aria-pressed={Boolean(chat.autoReplyEnabled)}
                            >
                              <Icon name={chat.autoReplyEnabled ? 'zap' : 'user'} size={12} />{' '}
                              {chat.autoReplyEnabled ? t.perConversation.toggleOn : t.perConversation.toggleOff}
                            </button>

                            <button
                              className="btn btn-secondary btn-sm"
                              style={{ fontSize: '11px', padding: '4px 8px' }}
                              onClick={() => setExpandedChatId(isExpanded ? null : chat.id)}
                            >
                              {isExpanded ? common.close : t.perConversation.editPrompt}
                            </button>

                            <Link
                              href={`/inbox?conversationId=${chat.id}`}
                              className="btn btn-secondary btn-sm"
                              style={{ fontSize: '11px', padding: '4px 8px' }}
                            >
                              <Icon name="externalLink" size={12} /> {t.perConversation.openConversation}
                            </Link>
                          </div>
                        </div>

                        {/* Custom Prompt Accordion */}
                        {isExpanded && (
                          <div className={styles.chatPromptEditor}>
                            <label className={styles.chatPromptLabel}>
                              {t.perConversation.promptLabel} — @{chat.contact?.username || 'this contact'}
                            </label>
                            <textarea
                              className="textarea"
                              placeholder={t.perConversation.promptPlaceholder}
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
                                {t.perConversation.savePrompt}
                              </button>
                              <button
                                className="btn btn-secondary btn-sm"
                                style={{ fontSize: '11px' }}
                                onClick={() => setExpandedChatId(null)}
                              >
                                {common.cancel}
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
            {saved && (
              <span className={styles.savedMessage} role="status">
                <Icon name="check" size={14} /> {toast.settingsSaved}
              </span>
            )}
            <button className="btn btn-primary btn-lg" onClick={handleSaveAll} disabled={saving}>
              {saving ? common.saving : common.save}
            </button>
          </div>
        </div>
      )}
    </AppShell>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className={styles.loadingContainer} aria-busy="true"><div className="spinner spinner-lg" /></div>}>
      <SettingsPageContent />
    </Suspense>
  );
}
