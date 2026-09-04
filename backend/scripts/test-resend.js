/**
 * Resend diagnostic — two-sender comparison.
 *
 * WHY TWO SENDS. `onboarding@resend.dev` works without any domain
 * verification, but only delivers to the account owner's own address. That
 * makes the pair a clean binary test:
 *
 *   A works, B fails  -> key and account are fine; the DOMAIN is not verified
 *   both fail         -> key or account problem
 *   both work         -> sending is fine; the bug is in how the APP calls it
 *
 * Both sends are awaited AND their errors captured. The Resend SDK reports
 * failures in the RESPONSE BODY rather than by throwing, so an unchecked call
 * looks successful while sending nothing — which is exactly how a password
 * reset can "succeed" with no mail ever leaving.
 *
 * onboarding@resend.dev is DIAGNOSTIC ONLY. It must never appear as a
 * FROM_EMAIL default or fallback anywhere in the application.
 *
 * The API key is read from the environment and is never printed.
 *
 * Usage:
 *   node scripts/test-resend.js you@example.com
 */

require('dotenv').config();

const RECIPIENT = process.argv[2];
const DIAGNOSTIC_SENDER = 'onboarding@resend.dev';

const line = (s = '') => console.log(s);
const hr = () => line('='.repeat(72));

if (!RECIPIENT) {
  console.error('Usage: node scripts/test-resend.js <recipient-email>');
  process.exit(1);
}

/** Describe a value's presence and shape without revealing it. */
function describeSecret(value) {
  if (!value) return 'NOT SET';
  const v = String(value);
  return `set (${v.length} chars, prefix "${v.slice(0, 3)}…")`;
}

/** Print everything Resend gives back, in full. */
function dump(label, { data, error, thrown }) {
  line(`--- ${label} ---`);
  if (thrown) {
    line(`  THREW: ${thrown.name}: ${thrown.message}`);
    if (thrown.response) {
      line(`  http status : ${thrown.response.status}`);
      line(`  http body   : ${JSON.stringify(thrown.response.data)}`);
    }
    if (thrown.stack) line(`  stack       : ${thrown.stack.split('\n')[1]?.trim() || 'n/a'}`);
    return false;
  }
  if (error) {
    line('  RESULT: FAILED (SDK returned an error object, did NOT throw)');
    line(`  name        : ${error.name || '(none)'}`);
    line(`  message     : ${error.message || '(none)'}`);
    line(`  statusCode  : ${error.statusCode ?? '(none)'}`);
    // Anything else the SDK attached.
    const extra = Object.keys(error).filter((k) => !['name', 'message', 'statusCode'].includes(k));
    if (extra.length) line(`  other keys  : ${JSON.stringify(Object.fromEntries(extra.map((k) => [k, error[k]])))}`);
    line(`  RAW         : ${JSON.stringify(error)}`);
    return false;
  }
  line('  RESULT: ACCEPTED by the API');
  line(`  message id  : ${data?.id || '(none returned)'}`);
  line(`  RAW         : ${JSON.stringify(data)}`);
  return true;
}

(async () => {
  hr();
  line('RESEND DIAGNOSTIC — two-sender comparison');
  hr();

  const apiKey = (process.env.RESEND_API_KEY || '').trim();
  const fromEmail = (process.env.FROM_EMAIL || '').trim();
  const fromDomain = fromEmail.includes('@') ? fromEmail.split('@')[1] : '(unparseable)';

  line(`RESEND_API_KEY : ${describeSecret(apiKey)}`);
  line(`FROM_EMAIL     : ${fromEmail || 'NOT SET'}`);
  line(`  -> domain    : ${fromDomain}`);
  line(`REPLY_TO_EMAIL : ${process.env.REPLY_TO_EMAIL || '(not set)'}`);
  line(`recipient      : ${RECIPIENT}`);
  line();

  if (!apiKey) {
    line('RESEND_API_KEY is not set in this process. Nothing to test.');
    hr();
    process.exit(1);
  }

  const { Resend } = require('resend');
  const client = new Resend(apiKey);

  // ---------------------------------------------------------------- Send A
  hr();
  line(`SEND A — from ${DIAGNOSTIC_SENDER} (works WITHOUT domain verification,`);
  line('         but only delivers to the account owner\'s own address)');
  hr();

  let aOk = false;
  try {
    const res = await client.emails.send({
      from: DIAGNOSTIC_SENDER,
      to: [RECIPIENT],
      subject: 'Codeback diagnostic A — resend.dev sender',
      text:
        'This is send A of the Codeback Resend diagnostic.\n\n' +
        'It was sent from onboarding@resend.dev, which requires no domain\n' +
        'verification. If you received this but not send B, the API key and\n' +
        'account are fine and the sending DOMAIN is not verified.\n',
    });
    aOk = dump('SEND A response', res);
  } catch (thrown) {
    aOk = dump('SEND A response', { thrown });
  }

  // ---------------------------------------------------------------- Send B
  line();
  hr();
  line(`SEND B — from ${fromEmail || '(FROM_EMAIL not set)'} (requires a VERIFIED domain)`);
  hr();

  let bOk = false;
  if (!fromEmail) {
    line('  SKIPPED: FROM_EMAIL is not set.');
  } else {
    try {
      const res = await client.emails.send({
        from: fromEmail,
        to: [RECIPIENT],
        subject: 'Codeback diagnostic B — configured sender',
        text:
          'This is send B of the Codeback Resend diagnostic.\n\n' +
          `Sent from ${fromEmail}. If this arrived, the domain is verified and\n` +
          'application email is working.\n',
      });
      bOk = dump('SEND B response', res);
    } catch (thrown) {
      bOk = dump('SEND B response', { thrown });
    }
  }

  // ------------------------------------------------------------- Domains
  line();
  hr();
  line('DOMAINS ON THIS ACCOUNT');
  hr();
  try {
    const domains = await client.domains.list();
    if (domains.error) {
      line(`  Could not list domains: ${JSON.stringify(domains.error)}`);
      line('  (a key without full permission can still send but not read domains)');
    } else {
      const list = domains.data?.data || domains.data || [];
      if (!list.length) {
        line('  NO DOMAINS on this account at all.');
        line(`  -> ${fromDomain} cannot possibly be verified; it has never been added.`);
      } else {
        for (const d of list) {
          line(`  ${d.name}`);
          line(`    status  : ${d.status}`);
          line(`    region  : ${d.region || 'n/a'}`);
          line(`    created : ${d.created_at || 'n/a'}`);
          line(`    id      : ${d.id}`);

          // Per-domain DNS detail, which the list endpoint omits.
          try {
            const detail = await client.domains.get(d.id);
            const records = detail.data?.records || [];
            if (records.length) {
              line('    DNS records:');
              for (const r of records) {
                line(
                  `      [${r.status}] ${r.type.padEnd(5)} ${r.name || '@'}` +
                    `${r.priority ? ' prio=' + r.priority : ''}`
                );
                line(`               value: ${r.value}`);
              }
            }
          } catch (e) {
            line(`    (could not fetch DNS detail: ${e.message})`);
          }
          line();
        }

        const match = list.find((d) => d.name === fromDomain);
        line(`  FROM_EMAIL domain "${fromDomain}":`);
        if (!match) {
          line(`    NOT PRESENT on the account. Domains present: ${list.map((d) => d.name).join(', ')}`);
          line('    NOTE: a subdomain mismatch counts as absent —');
          line('          verifying siffty.com does NOT verify mail.siffty.com.');
        } else {
          line(`    present, status = ${match.status}`);
        }
      }
    }
  } catch (e) {
    line(`  Domains API call threw: ${e.message}`);
  }

  // ------------------------------------------------------------- Verdict
  line();
  hr();
  line('INTERPRETATION');
  hr();
  if (aOk && !bOk) {
    line('  A worked, B failed.');
    line('  -> The API KEY and ACCOUNT are fine. The sending DOMAIN is not verified.');
    line('  -> Action is in the Resend dashboard / DNS, not in code.');
  } else if (!aOk && !bOk) {
    line('  BOTH failed.');
    line('  -> Key or account problem. See the verbatim errors above.');
  } else if (aOk && bOk) {
    line('  BOTH worked.');
    line('  -> Sending is fine. Any failure is in how the APP calls the provider.');
    line('  -> Next: trace the actual password-reset path, not the transport.');
  } else {
    line('  A failed but B worked — unusual. Check the errors above.');
  }
  hr();
})().catch((e) => {
  console.error('DIAGNOSTIC CRASHED:', e.message);
  console.error(e.stack);
  process.exit(1);
});
