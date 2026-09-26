// k6 spike: ramp to 20, spike to 150, back to 0 — /livez plus one cheap public
// read. Never touches Gemini, Cashfree, Resend or Meta.
//   docker run --rm -v "$PWD:/s" grafana/k6 run -e BASE=http://host.docker.internal:5000 /s/spike.js
import http from 'k6/http';
import { check, sleep } from 'k6';
export const options = {
  stages: [
    { duration: '30s', target: 20 },
    { duration: '20s', target: 20 },
    { duration: '15s', target: 150 },
    { duration: '45s', target: 150 },
    { duration: '20s', target: 0 },
  ],
  thresholds: { http_req_failed: ['rate<0.01'], http_req_duration: ['p(95)<500'] },
};
const BASE = __ENV.BASE || 'http://localhost:5000';
export default function () {
  const a = http.get(`${BASE}/livez`);
  const b = http.get(`${BASE}/api/announcements/active`);
  check(a, { 'livez 200': (r) => r.status === 200 });
  check(b, { 'announcements 2xx': (r) => r.status >= 200 && r.status < 300 });
  sleep(Number(__ENV.SLEEP ?? 0.5)); // SLEEP=0: no think time, to push CPU and trigger autoscaling
}
