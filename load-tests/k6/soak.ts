import http from 'k6/http';
import { check, sleep } from 'k6';
import type { Options } from 'k6/options';
import { BASE_URL, randomCustomerId, randomProductId, buildOrderPayload, JSON_HEADERS } from './config';
import { Trend, Counter } from 'k6/metrics';

const orderLatency = new Trend('order_latency');
const orderErrors  = new Counter('order_errors');

export const options: Options = {
  stages: [
    { duration: '5m',  target: 30 },
    { duration: '50m', target: 30 },
    { duration: '5m',  target: 0  },
  ],
  thresholds: {
    http_req_failed:  ['rate<0.01'],
    order_errors:     ['count<10'],
    order_latency:    ['p(95)<1000'],
  },
};

export default function (): void {
  const start = Date.now();
  const r = http.post(
    `${BASE_URL}/api/orders`,
    buildOrderPayload(randomCustomerId(), randomProductId()),
    { headers: JSON_HEADERS }
  );
  orderLatency.add(Date.now() - start);
  if (r.status !== 201) orderErrors.add(1);
  check(r, { 'order created': (res) => res.status === 201 });
  sleep(2);
}
