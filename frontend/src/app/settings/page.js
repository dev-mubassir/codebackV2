'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getMe, getAISettings, updateAISettings } from '@/lib/api';
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

  if (loading || !prefs) {
    return (
      <div className={styles.loadingScreen}>
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <nav className={styles.nav}>
        <a href="/dashboard" className={styles.navBrand}>Codeback</a>
        <button className="btn btn-secondary btn-sm" onClick={() => router.push('/dashboard')}>← Dashboard</button>
      </nav>

      <main className={styles.content}>
        <div className={styles.header}>
          <h1>⚙️ AI Settings</h1>
          <p className={styles.subtitle}>Tell Codeback what matters most to you. AI uses this to prioritize your inbox and match your voice in drafted replies.</p>
        </div>

        <div className={styles.section}>
          <div className={styles.sectionTitle}>Conversation Priorities</div>
          {PRIORITY_ROWS.map(row => (
            <div className={styles.prefRow} key={row.key}>
              <span className={styles.prefLabel}>{row.label}</span>
              <select
                className={styles.prefSelect}
                value={prefs[row.key]}
                onChange={(e) => updateField(row.key, e.target.value)}
              >
                {LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
          ))}
        </div>

        <div className={styles.section}>
          <div className={styles.sectionTitle}>Reply Style</div>
          <div className={styles.prefRow}>
            <span className={styles.prefLabel}>Tone</span>
            <select
              className={styles.prefSelect}
              value={prefs.tone}
              onChange={(e) => updateField('tone', e.target.value)}
            >
              {TONES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className={styles.prefRow} style={{ flexDirection: 'column', alignItems: 'stretch', gap: '8px' }}>
            <span className={styles.prefLabel}>Personal style notes (optional)</span>
            <textarea
              className={styles.textarea}
              placeholder="e.g. Always mention my manager's email for brand deals over $1000. Keep replies under 3 sentences."
              value={prefs.customInstructions || ''}
              onChange={(e) => updateField('customInstructions', e.target.value)}
            />
          </div>
          <div className={styles.prefRow}>
            <span className={styles.prefLabel}>Auto-generate conversation summaries</span>
            <select
              className={styles.prefSelect}
              value={prefs.autoGenerateSummary ? 'on' : 'off'}
              onChange={(e) => updateField('autoGenerateSummary', e.target.value === 'on')}
            >
              <option value="on">on</option>
              <option value="off">off</option>
            </select>
          </div>
        </div>

        <div className={styles.saveBar}>
          {saved && <span className={styles.savedMessage}>✓ Saved</span>}
          <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save Settings'}
          </button>
        </div>
      </main>
    </div>
  );
}
