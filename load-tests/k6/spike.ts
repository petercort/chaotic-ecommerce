import http from 'k6/http';
import { check, sleep } from 'k6';
import type { Options } from 'k6/options';
import { BASE_URL, buildOrderPayload, JSON_HEADERS } from './config';

export const options: Options = {
  stages: [
    { duration: '30s', target: 10  },  // baseline
    { duration: '10s', target: 100 },  // spike!
    { duration: '30s', target: 100 },  // sustained spike
    { duration: '10s', target: 10  },  // recovery
    { duration: '30s', target: 10  },  // post-spike baseline
  ],
  thresholds: {
    http_req_failed: ['rate<0.10'],
  },
};

export default function (): void {
  const r = http.get(`${BASE_URL}/api/products`);
  check(r, { 'products ok': (res) => res.status === 200 });
  sleep(1);
}
