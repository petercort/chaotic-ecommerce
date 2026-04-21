import http from 'k6/http';
import { check, sleep } from 'k6';
import type { Options } from 'k6/options';
import { BASE_URL, randomCustomerId, randomProductId, buildOrderPayload, JSON_HEADERS, DEFAULT_THRESHOLDS } from './config';

export const options: Options = {
  vus: 10,
  duration: '5m',
  thresholds: DEFAULT_THRESHOLDS,
};

export default function (): void {
  const custId = randomCustomerId();
  const prodId = randomProductId();

  http.get(`${BASE_URL}/api/customers`);
  http.get(`${BASE_URL}/api/customers/${custId}`);
  http.get(`${BASE_URL}/api/products`);
  http.get(`${BASE_URL}/api/products/${prodId}`);

  const r = http.post(
    `${BASE_URL}/api/orders`,
    buildOrderPayload(custId, prodId),
    { headers: JSON_HEADERS }
  );
  check(r, { 'order created': (res) => res.status === 201 });

  sleep(1);
}
