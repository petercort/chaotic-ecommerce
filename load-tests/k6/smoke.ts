import http from 'k6/http';
import { check, sleep } from 'k6';
import type { Options } from 'k6/options';
import { BASE_URL, buildOrderPayload, JSON_HEADERS } from './config';

export const options: Options = {
  vus: 1,
  duration: '1m',
  thresholds: {
    http_req_failed:   ['rate<0.01'],
    http_req_duration: ['p(95)<1000'],
  },
};

export default function (): void {
  // Customers
  let r = http.get(`${BASE_URL}/api/customers`);
  check(r, { 'customers 200': (res) => res.status === 200 });

  r = http.get(`${BASE_URL}/api/customers/1`);
  check(r, { 'customer by id 200': (res) => res.status === 200 });

  // Products
  r = http.get(`${BASE_URL}/api/products`);
  check(r, { 'products 200': (res) => res.status === 200 });

  r = http.get(`${BASE_URL}/api/products/1`);
  check(r, { 'product by id 200': (res) => res.status === 200 });

  // Orders
  r = http.get(`${BASE_URL}/api/orders`);
  check(r, { 'orders 200': (res) => res.status === 200 });

  r = http.post(
    `${BASE_URL}/api/orders`,
    buildOrderPayload(1, 2),
    { headers: JSON_HEADERS }
  );
  check(r, { 'create order 201': (res) => res.status === 201 });

  sleep(1);
}
