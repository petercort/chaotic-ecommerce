import http from 'k6/http';
import { check, sleep } from 'k6';
import type { Options } from 'k6/options';
import { BASE_URL, randomCustomerId, randomProductId, buildOrderPayload, JSON_HEADERS } from './config';

export const options: Options = {
  stages: [
    { duration: '2m', target: 10  },   // warm up
    { duration: '3m', target: 50  },   // ramp up
    { duration: '3m', target: 100 },   // peak
    { duration: '2m', target: 0   },   // ramp down
  ],
  thresholds: {
    http_req_failed:   ['rate<0.05'],
    http_req_duration: ['p(95)<2000'],
  },
};

export default function (): void {
  const r = http.post(
    `${BASE_URL}/api/orders`,
    buildOrderPayload(randomCustomerId(), randomProductId()),
    { headers: JSON_HEADERS }
  );
  check(r, { 'status 201 or 200': (res) => res.status === 201 || res.status === 200 });
  sleep(0.5);
}
