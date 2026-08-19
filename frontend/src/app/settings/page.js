'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getMe, getAISettings, updateAISettings } from '@/lib/api';
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
 * the tone it uses when drafting replies.
 */
export default function SettingsPage() {
  const router = useRouter();
  const [prefs, setPrefs] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        await getMe();
        const data = await getAISettings();
        setPrefs(data);
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
