// Webhook burst: N signed synthetic DMs as a spike against the local LB, with
// Meta-like retries (any non-200 is retried with backoff). Prints a summary.
//   node deploy/local/burst.js 2000 [prefix]
const crypto = require('crypto');
const N = Number(process.argv[2] || 2000);
const PREFIX = process.argv[3] || `burst-${Date.now()}`;
const SECRET = 'local-burst-signing-secret-not-real';
const URL = 'http://localhost:5000/webhooks/instagram';
const CONCURRENCY = 40;
let ok = 0, retries = 0, gaveUp = 0, i = 0;
const statuses = {};
async function send(n) {
  const raw = JSON.stringify({ object: 'instagram', entry: [{ id: 'burst-ig-1', time: Date.now(), messaging: [{
    sender: { id: `burst-sender-${n % 20}` }, recipient: { id: 'burst-ig-1' }, timestamp: Date.now(), message: { mid: `${PREFIX}-${n}`, text: `burst message ${n}` } }] }] });
  const sig = 'sha256=' + crypto.createHmac('sha256', SECRET).update(raw).digest('hex');
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      const r = await fetch(URL, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig }, body: raw });
      statuses[r.status] = (statuses[r.status] || 0) + 1;
      if (r.status === 200) { ok++; return; }
    } catch { statuses.neterr = (statuses.neterr || 0) + 1; }
    retries++;
    await new Promise((res) => setTimeout(res, 250 * 2 ** Math.min(attempt, 5)));
  }
  gaveUp++;
}
(async () => {
  const t0 = Date.now();
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => { while (i < N) await send(i++); }));
  console.log(JSON.stringify({ prefix: PREFIX, sent: N, acknowledged: ok, retries, gaveUp, statuses, seconds: (Date.now() - t0) / 1000 }));
})();
