'use client';

/**
 * Settings — what Siffty knows about the business, how it replies, and which
 * individual conversations are answered automatically.
 *
 * The DATA LAYER is master's: the same four endpoints, the same legacy `?tab=`
 * aliases, the same "save everything at once" button, the same per-conversation
 * toggle and prompt editor, the same billing gate on the plan panel.
 *
 * WHAT CHANGED
 *
 *   1. The business-profile fields come from the shared BusinessProfileFields,
 *      which onboarding also uses. Master had two copies of those fields and
 *      they had already drifted: `locationDelivery` is filled by the starter
 *      templates and POSTED by both screens, but NEITHER rendered a field for
 *      it, so it was stored and round-tripped where nobody could read it. It is
 *      now editable here.
 *   2. `confirm()` and three `alert()`s are gone. Native dialogs cannot be
 *      styled, behave inconsistently under the keyboard, and are blocked
 *      outright in some embedded browsers — so a failed save could say nothing
 *      at all. Errors now render in the page, next to the button that caused
 *      them.
 *   3. Every control carries the server's own maxLength. The sanitiser
 *      silently truncates, so a long answer used to save "successfully" and
 *      come back short.
 */

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  getMe, getAISettings, updateAISettings, getBusinessProfile,
  updateBusinessProfile, getAutoReplyChats, toggleAutoReply,
} from '@/lib/api';
import {
  BUSINESS_CATEGORIES, parseBusinessTypes, combineKnowledgeTemplates,
  DEFAULT_BUSINESS_TYPE, toggleBusinessType,
} from '@/lib/businessTemplates';
import { rememberDestination } from '@/lib/pendingDestination';
import AppShell from '@/app/components/ui/AppShell';
import PlanSummaryPanel from '@/app/components/billing/PlanSummaryPanel';
import Icon from '@/app/components/Icon';
import {
  Avatar, Badge, Button, Card, EmptyState, IconTile, Input, Modal, Select,
  Skeleton, Tabs, Textarea, Toggle,
} from '@/app/components/ui';
import BusinessProfileFields, { SETTINGS_PROFILE_FIELDS } from '@/app/components/ui/BusinessProfileFields';
import { settings as t, common, errors, empty, confirm as confirmCopy, toast } from '@/content/copy';
import {
  PRIORITY_WEIGHT_ORDER, TONE_ORDER, priorityWeightLabel, toneLabel,
  replyModeLabel, replyModeSendsAutomatically, DEFAULT_REPLY_MODE,
} from '@/content/labels';
import { plural } from '@/content/format';
import styles from './settings.module.css';

/** Stored values, unchanged — only the wording lives in labels.js. */
const REPLY_MODES = ['smart', 'suggest_only', 'human_only'];

const PRIORITY_ROW_KEYS = [
  'customersPriority', 'brandDealsPriority', 'collaborationsPriority',
  'questionsPriority', 'fanPriority', 'spamPriority',
];

const TAB_IDS = ['profile', 'replies', 'conversations'];

/** Old links used ?tab=ai and ?tab=chats. Kept so bookmarks still land right. */
const LEGACY_TABS = { ai: 'replies', chats: 'conversations' };

function SettingsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawTab = searchParams.get('tab') || 'profile';
  const mappedTab = LEGACY_TABS[rawTab] || rawTab;

  const [activeTab, setActiveTab] = useState(TAB_IDS.includes(mappedTab) ? mappedTab : 'profile');
  const [user, setUser] = useState(null);
  const [prefs, setPrefs] = useState(null);
  const [profile, setProfile] = useState(null);
  const [chats, setChats] = useState([]);
  const [chatSearch, setChatSearch] = useState('');
  const [expandedChatId, setExpandedChatId] = useState(null);
  const [customPrompts, setCustomPrompts] = useState({});

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [chatError, setChatError] = useState('');
  const [showTemplateModal, setShowTemplateModal] = useState(false);

  // From /auth/me. Gates the plan panel so that pre-launch this page makes no
  // billing request at all, rather than one that 404s.
  const [billingEnabled, setBillingEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const me = await getMe();
        if (cancelled) return;
        if (!me?.onboardingCompleted) {
          rememberDestination();
          router.replace('/onboarding');
          return;
        }
        setUser(me);
        setBillingEnabled(Boolean(me?.features?.billing));

        const [settingsData, profileData, chatsData] = await Promise.all([
          getAISettings().catch(() => ({})),
          getBusinessProfile().catch(() => ({})),
          getAutoReplyChats().catch(() => []),
        ]);
        if (cancelled) return;

        setPrefs(settingsData);
        setProfile(profileData);
        setChats(chatsData || []);

        const initial = {};
        (chatsData || []).forEach((c) => {
          if (c.autoReplyPrompt) initial[c.id] = c.autoReplyPrompt;
        });
        setCustomPrompts(initial);
      } catch {
        if (!cancelled) router.push('/login');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [router]);

  const updatePref = useCallback((key, value) => {
    setPrefs((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }, []);

  const updateProfile = useCallback((key, value) => {
    setProfile((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }, []);

  function handleToggleCategory(catId) {
    const current = parseBusinessTypes(profile?.businessTypes, profile?.primaryCategory);
    // Shared with onboarding, but WITHOUT allowEmpty: a saved profile always
    // holds at least the placeholder, so turning off the last type falls back
    // to "Something else" rather than leaving the account with no type at all.
    const next = toggleBusinessType(current, catId);
    setProfile((prev) => ({
      ...prev,
      businessTypes: JSON.stringify(next),
      primaryCategory: next[0] || DEFAULT_BUSINESS_TYPE,
    }));
    setSaved(false);
  }

  function applyTemplates() {
    const current = parseBusinessTypes(profile?.businessTypes, profile?.primaryCategory);
    const combined = combineKnowledgeTemplates(current);
    setShowTemplateModal(false);
    if (!combined) return;
    setProfile((prev) => ({
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

  async function handleToggleChat(chatId, currentStatus) {
    const next = !currentStatus;
    setChatError('');
    try {
      await toggleAutoReply(chatId, next, customPrompts[chatId] || null);
      setChats((prev) => prev.map((c) => (c.id === chatId
        ? { ...c, autoReplyEnabled: next, autoReplyPrompt: customPrompts[chatId] || null }
        : c)));
    } catch {
      setChatError(errors.toggleAutomation);
    }
  }

  async function handleSaveChatPrompt(chatId) {
    const prompt = customPrompts[chatId] || null;
    setChatError('');
    try {
      await toggleAutoReply(chatId, true, prompt);
      setChats((prev) => prev.map((c) => (c.id === chatId
        ? { ...c, autoReplyEnabled: true, autoReplyPrompt: prompt }
        : c)));
      setExpandedChatId(null);
    } catch {
      setChatError(errors.saveSettings);
    }
  }

  async function handleSaveAll() {
    if (saving) return;
    setSaving(true);
    setSaveError('');
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
      if (profile) setProfile(await updateBusinessProfile(profile));
      setSaved(true);
    } catch {
      setSaveError(errors.saveSettings);
    } finally {
      setSaving(false);
    }
  }

  const activeCount = chats.filter((c) => c.autoReplyEnabled).length;

  const filteredChats = chats.filter((c) => {
    const q = chatSearch.trim().toLowerCase();
    if (!q) return true;
    return [c.contact?.username, c.contact?.name, c.lastMessage]
      .some((v) => (v || '').toLowerCase().includes(q));
  });

  const selectedTypes = profile
    ? parseBusinessTypes(profile.businessTypes, profile.primaryCategory)
    : [];
  const selectedTypeLabels = selectedTypes
    .map((id) => BUSINESS_CATEGORIES.find((c) => c.id === id)?.label)
    .filter(Boolean);

  const sendsAutomatically = replyModeSendsAutomatically(profile?.autoReplyMode);

  return (
    <AppShell user={user} title={t.title} activeRoute="/settings">
      <header className={styles.pageHead}>
        <h1 className={styles.pageTitle}>{t.title}</h1>
        <p className={styles.pageSub}>{t.subtitle}</p>
      </header>

      <Tabs
        ariaLabel={t.title}
        value={activeTab}
        onChange={setActiveTab}
        items={[
          { id: 'profile', label: t.tabs.profile },
          { id: 'replies', label: t.tabs.replies },
          { id: 'conversations', label: t.tabs.conversations, count: activeCount },
        ]}
      />

      {loading || !profile || !prefs ? (
        <div className={styles.loading}><Skeleton lines={6} height={44} /></div>
      ) : (
        <div className={styles.tabBody}>
          {/* ---------------- Business profile ---------------- */}
          {activeTab === 'profile' && (
            <>
              {billingEnabled && <PlanSummaryPanel />}

              <Card title={t.businessProfile.title} description={t.businessProfile.description}>
                <div className={styles.fieldStack}>
                  <div className={styles.typesBlock}>
                    <div className={styles.typesHead}>
                      <span className={styles.fieldLabel}>{t.businessProfile.typesLabel}</span>
                      <span className={styles.count}>
                        {selectedTypes.length} {t.businessProfile.selectedCount}
                      </span>
                    </div>
                    <p className={styles.fieldHint}>{t.businessProfile.typesHint}</p>

                    <div className={styles.categoryGrid}>
                      {BUSINESS_CATEGORIES.map((cat) => {
                        const on = selectedTypes.includes(cat.id);
                        return (
                          <button
                            key={cat.id}
                            type="button"
                            className={`${styles.categoryCard} ${on ? styles.categoryCardOn : ''}`}
                            onClick={() => handleToggleCategory(cat.id)}
                            aria-pressed={on}
                          >
                            {/* Neutral on all twenty. A business type is not a
                                status, and twenty colours would be decoration. */}
                            <IconTile name={cat.icon} tone="neutral" />
                            <span className={styles.categoryText}>
                              <span className={styles.categoryLabel}>{cat.label}</span>
                              <span className={styles.categorySummary}>{cat.summary}</span>
                            </span>
                            {on && (
                              <span className={styles.categoryCheck} aria-hidden="true">
                                <Icon name="check" size={13} />
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>

                    {selectedTypeLabels.length > 0 && (
                      <div className={styles.templateBanner}>
                        <IconTile name="refresh" tone="accent" />
                        <p className={styles.templateText}>
                          {t.businessProfile.templateBannerPrefix}{' '}
                          <strong>{selectedTypeLabels.join(', ')}</strong>
                        </p>
                        <Button size="sm" onClick={() => setShowTemplateModal(true)}>
                          {t.businessProfile.applyTemplate}
                        </Button>
                      </div>
                    )}
                  </div>

                  {/* One definition of these fields, shared with onboarding. */}
                  <BusinessProfileFields
                    values={profile}
                    onChange={updateProfile}
                    disabled={saving}
                    fields={SETTINGS_PROFILE_FIELDS}
                  />
                </div>
              </Card>
            </>
          )}

          {/* ---------------- Replies and tone ---------------- */}
          {activeTab === 'replies' && (
            <>
              <Card title={t.replies.title} description={t.replies.description}>
                <div className={styles.fieldStack}>
                  <div>
                    <span className={styles.fieldLabel}>{t.replies.modeLabel}</span>
                    <p className={styles.fieldHint}>{t.replies.modeHint}</p>
                    <div className={styles.modeGrid}>
                      {REPLY_MODES.map((mode) => {
                        const meta = replyModeLabel(mode);
                        const on = (profile.autoReplyMode || DEFAULT_REPLY_MODE) === mode;
                        return (
                          <button
                            key={mode}
                            type="button"
                            className={`${styles.modeCard} ${on ? styles.modeCardOn : ''}`}
                            onClick={() => updateProfile('autoReplyMode', mode)}
                            aria-pressed={on}
                          >
                            {/* Accent only when the mode SENDS on your behalf —
                                that is the one with consequences. */}
                            <IconTile
                              name={replyModeSendsAutomatically(mode) ? 'zap' : 'user'}
                              tone={replyModeSendsAutomatically(mode) ? 'accent' : 'neutral'}
                            />
                            <span className={styles.modeText}>
                              <span className={styles.modeLabel}>{meta.label}</span>
                              <span className={styles.modeDesc}>{meta.description}</span>
                            </span>
                            {on && (
                              <span className={styles.modeCheck} aria-hidden="true">
                                <Icon name="check" size={13} />
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <Select
                    label={t.replies.toneLabel}
                    hint={t.replies.toneHint}
                    value={profile.tone || 'friendly'}
                    disabled={saving}
                    onChange={(e) => {
                      updateProfile('tone', e.target.value);
                      updatePref('tone', e.target.value);
                    }}
                  >
                    {TONE_ORDER.map((value) => (
                      <option key={value} value={value}>
                        {toneLabel(value).label} — {toneLabel(value).description}
                      </option>
                    ))}
                  </Select>

                  <Textarea
                    label={t.replies.instructionsLabel}
                    hint={t.replies.instructionsHint}
                    placeholder={t.replies.instructionsPlaceholder}
                    rows={3}
                    maxLength={2500}
                    value={profile.aiInstructions || ''}
                    disabled={saving}
                    onChange={(e) => updateProfile('aiInstructions', e.target.value)}
                  />

                  <div className={styles.toggleRow}>
                    <div>
                      <span className={styles.fieldLabel}>{t.replies.summariesLabel}</span>
                      <p className={styles.fieldHint}>{t.replies.summariesHint}</p>
                    </div>
                    <Toggle
                      checked={Boolean(prefs.autoGenerateSummary)}
                      disabled={saving}
                      onChange={(v) => updatePref('autoGenerateSummary', v)}
                      label={prefs.autoGenerateSummary ? t.replies.summariesOn : t.replies.summariesOff}
                    />
                  </div>
                </div>
              </Card>

              <Card title={t.priorities.title} description={t.priorities.description}>
                <div className={styles.priorityList}>
                  {PRIORITY_ROW_KEYS.map((key) => (
                    <div className={styles.priorityRow} key={key}>
                      <span className={styles.priorityLabel}>{t.priorities.rows[key]}</span>
                      <Select
                        value={prefs[key] || 'normal'}
                        disabled={saving}
                        aria-label={t.priorities.rows[key]}
                        onChange={(e) => updatePref(key, e.target.value)}
                        className={styles.prioritySelect}
                      >
                        {PRIORITY_WEIGHT_ORDER.map((level) => (
                          <option key={level} value={level}>{priorityWeightLabel(level).label}</option>
                        ))}
                      </Select>
                    </div>
                  ))}
                </div>
              </Card>
            </>
          )}

          {/* ---------------- Per-conversation automation ---------------- */}
          {activeTab === 'conversations' && (
            <Card
              title={t.perConversation.title}
              description={t.perConversation.description}
              actions={<Badge tone="neutral">{plural(activeCount, 'conversation')} {t.perConversation.activeCount}</Badge>}
            >
              {/* These switches do nothing while the account is set to manual.
                  Saying so is the difference between a control that looks
                  broken and one that explains itself. */}
              {!sendsAutomatically && (
                <div className={styles.notice} role="note">
                  <IconTile name="info" tone="warning" />
                  <p className={styles.noticeText}>{t.perConversation.requiresAutomaticMode}</p>
                </div>
              )}

              {chatError && <p className={styles.inlineError} role="alert">{chatError}</p>}

              {chats.length > 0 && (
                <div className={styles.searchRow}>
                  <Input
                    type="search"
                    placeholder={t.perConversation.searchPlaceholder}
                    aria-label={t.perConversation.searchPlaceholder}
                    value={chatSearch}
                    onChange={(e) => setChatSearch(e.target.value)}
                  />
                </div>
              )}

              {chats.length === 0 ? (
                <EmptyState icon="messageSquare" title={empty.perConversation.title} body={empty.perConversation.body} />
              ) : filteredChats.length === 0 ? (
                <EmptyState icon="search" title={empty.search.title} body={empty.search.body} />
              ) : (
                <div className={styles.chatList}>
                  {filteredChats.map((chat) => {
                    const expanded = expandedChatId === chat.id;
                    const prompt = customPrompts[chat.id] ?? (chat.autoReplyPrompt || '');
                    return (
                      <div key={chat.id} className={styles.chatItem}>
                        <div className={styles.chatRow}>
                          <Avatar
                            src={chat.contact?.profilePicUrl}
                            name={chat.contact?.username || chat.contact?.name}
                            contactId={chat.contact?.id}
                            size={32}
                            decorative
                          />
                          <div className={styles.chatMeta}>
                            <span className={styles.chatName}>
                              @{chat.contact?.username || chat.contact?.name || common.unknown}
                              {chat.instagramAccount?.igUsername && (
                                <span className={styles.chatOn}>
                                  {' '}{t.perConversation.onAccount} @{chat.instagramAccount.igUsername}
                                </span>
                              )}
                            </span>
                            <span className={styles.chatPreview}>
                              {chat.lastMessage || t.perConversation.noMessagesYet}
                            </span>
                          </div>

                          <div className={styles.chatActions}>
                            <Toggle
                              checked={Boolean(chat.autoReplyEnabled)}
                              onChange={() => handleToggleChat(chat.id, chat.autoReplyEnabled)}
                              label={chat.autoReplyEnabled ? t.perConversation.toggleOn : t.perConversation.toggleOff}
                            />
                            <Button size="sm" onClick={() => setExpandedChatId(expanded ? null : chat.id)}>
                              {expanded ? common.close : t.perConversation.editPrompt}
                            </Button>
                            <Link href={`/inbox?conversationId=${chat.id}`} className={styles.chatLink}>
                              <Icon name="externalLink" size={13} />
                              {t.perConversation.openConversation}
                            </Link>
                          </div>
                        </div>

                        {expanded && (
                          <div className={styles.promptEditor}>
                            <Textarea
                              label={`${t.perConversation.promptLabel} — @${chat.contact?.username || common.unknown}`}
                              placeholder={t.perConversation.promptPlaceholder}
                              rows={2}
                              maxLength={500}
                              value={prompt}
                              onChange={(e) => setCustomPrompts((prev) => ({ ...prev, [chat.id]: e.target.value }))}
                            />
                            <div className={styles.promptActions}>
                              <Button variant="primary" size="sm" onClick={() => handleSaveChatPrompt(chat.id)}>
                                {t.perConversation.savePrompt}
                              </Button>
                              <Button size="sm" onClick={() => setExpandedChatId(null)}>
                                {common.cancel}
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          )}

          {/* The conversations tab saves on its own, per switch. */}
          {activeTab !== 'conversations' && (
            <div className={styles.saveBar}>
              {saveError && <p className={styles.inlineError} role="alert">{saveError}</p>}
              {saved && !saveError && (
                <p className={styles.savedNote} role="status">
                  <Icon name="check" size={14} /> {toast.settingsSaved}
                </p>
              )}
              <Button variant="primary" onClick={handleSaveAll} loading={saving}>
                {saving ? common.saving : common.save}
              </Button>
            </div>
          )}
        </div>
      )}

      {showTemplateModal && (
        <Modal
          title={confirmCopy.loadTemplate.title}
          onClose={() => setShowTemplateModal(false)}
          actions={(
            <>
              <Button onClick={() => setShowTemplateModal(false)}>{common.cancel}</Button>
              <Button variant="primary" onClick={applyTemplates}>
                {t.businessProfile.applyTemplate}
              </Button>
            </>
          )}
        >
          {confirmCopy.loadTemplate.body}
        </Modal>
      )}
    </AppShell>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsPageContent />
    </Suspense>
  );
}
