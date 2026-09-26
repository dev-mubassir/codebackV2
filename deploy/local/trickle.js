// Steady webhook traffic + /health polling for DURATION seconds (Redis-down test).
//   node deploy/local/trickle.js 480 [prefix]
const crypto = require('crypto');
const DURATION = Number(process.argv[2] || 480) * 1000;
const PREFIX = process.argv[3] || `trickle-${Date.now()}`;
const SECRET = 'local-burst-signing-secret-not-real';
const stats = { sent: 0, ack: 0, statuses: {}, healthOk: 0, healthBad: 0 };
const end = Date.now() + DURATION;
let n = 0;
async function one() {
  const i = n++;
  const raw = JSON.stringify({ object: 'instagram', entry: [{ id: 'burst-ig-1', time: Date.now(), messaging: [{
    sender: { id: `burst-sender-${i % 20}` }, recipient: { id: 'burst-ig-1' }, timestamp: Date.now(), message: { mid: `${PREFIX}-${i}`, text: `trickle ${i}` } }] }] });
  const sig = 'sha256=' + crypto.createHmac('sha256', SECRET).update(raw).digest('hex');
  for (let a = 0; a < 20; a++) {
    try {
      const r = await fetch('http://localhost:5000/webhooks/instagram', { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig }, body: raw });
      stats.statuses[r.status] = (stats.statuses[r.status] || 0) + 1;
      if (r.status === 200) { stats.ack++; return; }
    } catch { stats.statuses.neterr = (stats.statuses.neterr || 0) + 1; }
    await new Promise((res) => setTimeout(res, 1000));
  }
}
(async () => {
  const health = setInterval(async () => {
    try { (await fetch('http://localhost:5000/health')).status === 200 ? stats.healthOk++ : stats.healthBad++; } catch { stats.healthBad++; }
  }, 5000);
  const inflight = [];
  while (Date.now() < end) { stats.sent++; inflight.push(one()); await new Promise((r) => setTimeout(r, 300)); }
  await Promise.all(inflight);
  clearInterval(health);
  console.log(JSON.stringify({ prefix: PREFIX, ...stats }));
})();
