import http from 'k6/http';
import { check, sleep } from 'k6';
import type { Options } from 'k6/options';
import { BASE_URL, JSON_HEADERS } from './config';

interface Product {
  id: number;
  [key: string]: unknown;
}

export const options: Options = {
  vus: 20,
  duration: '5m',
  thresholds: {
    http_req_failed:                        ['rate<0.01'],
    'http_req_duration{name:list_products}': ['p(95)<200'],
    'http_req_duration{name:create_order}':  ['p(95)<500'],
  },
};

export default function (): void {
  // Step 1: Browse products
  let r = http.get(`${BASE_URL}/api/products`, { tags: { name: 'list_products' } });
  check(r, { 'products ok': (res) => res.status === 200 });
  const products = r.json() as Product[] | null;
  if (!Array.isArray(products) || products.length === 0) return;

  // Step 2: Get a specific product
  const product = products[Math.floor(Math.random() * products.length)];
  r = http.get(`${BASE_URL}/api/products/${product.id}`, { tags: { name: 'get_product' } });
  check(r, { 'product ok': (res) => res.status === 200 });

  sleep(0.5);

  // Step 3: Create order
  r = http.post(
    `${BASE_URL}/api/orders`,
    JSON.stringify({
      customerId: Math.ceil(Math.random() * 3),
      items: [{ productId: product.id, quantity: 1 }],
      shippingAddress: '123 Load Test Ave',
      shippingCity: 'Test City',
      shippingState: 'TC',
      shippingZip: '00000',
      shippingCountry: 'USA',
    }),
    { headers: JSON_HEADERS, tags: { name: 'create_order' } }
  );
  check(r, { 'order created': (res) => res.status === 201 });

  sleep(1);
}
