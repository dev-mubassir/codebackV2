/**
 * Regression suite for the auto-reply activation gate (Phase 3, Batch A).
 *
 * Covers findings #1 and #3:
 *   #1 'suggest_only' must never auto-send, even when a conversation is opted in.
 *   #3 The per-conversation override must be able to SUBTRACT under 'smart'.
 *
 * The gate is pure boolean logic over (autoReplyMode, conversation.autoReplyEnabled),
 * mirrored here exactly as it appears in jobs/messageAnalysisJob.js so the truth
 * table is asserted without needing a live webhook + provider round trip.
 */

let passed = 0;
let failed = 0;

function check(name, actual, expected) {
  if (actual === expected) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name} — expected ${expected}, got ${actual}`);
  }
}

/** Mirrors messageAnalysisJob.js step 8. */
function isAutoReplyActive(autoReplyModeRaw, conversationOverride) {
  const autoReplyMode = autoReplyModeRaw || 'smart';
  const modeAllowsAutoSend = autoReplyMode === 'smart';
  return modeAllowsAutoSend && conversationOverride !== false;
}

/** Mirrors maybeAutoReply() Stage 1 — the defense-in-depth re-assertion. */
function passesStage1(autoReplyModeRaw, conversationOverride) {
  const mode = autoReplyModeRaw || 'smart';
  if (mode !== 'smart') return false;
  if (conversationOverride === false) return false;
  return true;
}

console.log('\n=== Auto-Reply Gate Regression Suite ===\n');

console.log('#1 — suggest_only must NEVER auto-send:');
check("suggest_only + override null  -> blocked", isAutoReplyActive('suggest_only', null), false);
check("suggest_only + override true  -> blocked", isAutoReplyActive('suggest_only', true), false);
check("suggest_only + override false -> blocked", isAutoReplyActive('suggest_only', false), false);
check("suggest_only passes Stage 1?  -> no", passesStage1('suggest_only', true), false);

console.log('\n#1 — human_only must NEVER auto-send:');
check("human_only + override null    -> blocked", isAutoReplyActive('human_only', null), false);
check("human_only + override true    -> blocked", isAutoReplyActive('human_only', true), false);
check("human_only passes Stage 1?    -> no", passesStage1('human_only', true), false);

console.log('\n#3 — per-conversation override must be subtractive under smart:');
check("smart + override false -> BLOCKED (the #3 fix)", isAutoReplyActive('smart', false), false);
check("smart + override false fails Stage 1", passesStage1('smart', false), false);
check("smart + override null  -> active (inherits)", isAutoReplyActive('smart', null), true);
check("smart + override true  -> active", isAutoReplyActive('smart', true), true);

console.log('\nBehaviour preservation — untouched conversations still auto-reply:');
check("smart + null (post-backfill default) -> active", isAutoReplyActive('smart', null), true);
check("undefined mode falls back to smart", isAutoReplyActive(undefined, null), true);
check("null profile falls back to smart", isAutoReplyActive(null, null), true);

console.log('\nRegression — the OLD gate would have failed these:');
const oldGate = (mode, ov) => (ov || mode === 'smart') && mode !== 'human_only';
check("OLD gate wrongly allowed suggest_only+true", oldGate('suggest_only', true), true);
check("NEW gate blocks it", isAutoReplyActive('suggest_only', true), false);
check("OLD gate wrongly ignored smart+false", oldGate('smart', false), true);
check("NEW gate honours it", isAutoReplyActive('smart', false), false);

console.log(`\n=== ${passed}/${passed + failed} passed ===\n`);
process.exit(failed === 0 ? 0 : 1);
