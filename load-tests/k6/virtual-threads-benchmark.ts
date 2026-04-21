import http from 'k6/http';
import { check, sleep } from 'k6';
import type { Options } from 'k6/options';
import { BASE_URL, buildOrderPayload, JSON_HEADERS } from './config';
import { Rate, Trend } from 'k6/metrics';

// To compare virtual threads ON vs OFF:
// Run 1 (baseline):  k6 run virtual-threads-benchmark.ts  (default — VT enabled)
// Run 2 (disabled):  Restart order-service with spring.threads.virtual.enabled=false
//                    k6 run virtual-threads-benchmark.ts

const successRate   = new Rate('success_rate');
const orderDuration = new Trend('order_duration_ms', true);

export const options: Options = {
  stages: [
    { duration: '1m',  target: 50  },
    { duration: '3m',  target: 100 },
    { duration: '1m',  target: 150 },
    { duration: '1m',  target: 0   },
  ],
  thresholds: {
    success_rate: ['rate>0.95'],
  },
};

export default function (): void {
  const start = Date.now();
  const r = http.post(
    `${BASE_URL}/api/orders`,
    buildOrderPayload(
      Math.ceil(Math.random() * 3),
      Math.ceil(Math.random() * 6)
    ),
    { headers: JSON_HEADERS }
  );
  const elapsed = Date.now() - start;
  orderDuration.add(elapsed);
  const ok = r.status === 201;
  successRate.add(ok);
  check(r, { 'order created': () => ok });
  sleep(0.3);
}
