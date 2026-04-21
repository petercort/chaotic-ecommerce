import http from 'k6/http';
import { check } from 'k6';
import type { Options } from 'k6/options';

const BASE_URL: string = __ENV.BASE_URL || 'http://localhost:8080';
const HEADERS: Record<string, string> = { 'Content-Type': 'application/json' };

export const options: Options = {
  vus: 1,
  iterations: 1,
};

interface Customer {
  name: string;
  email: string;
  phone: string;
  address: string;
}

interface Product {
  name: string;
  description: string;
  price: number;
  stockQuantity: number;
  category: string;
}

const CUSTOMERS: Customer[] = [
  { name: 'Load Test User 1', email: 'loadtest1@example.com', phone: '555-0001', address: '1 Test St' },
  { name: 'Load Test User 2', email: 'loadtest2@example.com', phone: '555-0002', address: '2 Test St' },
];

const PRODUCTS: Product[] = [
  { name: 'Load Test Widget',  description: 'Test product', price: 9.99,  stockQuantity: 9999, category: 'Electronics' },
  { name: 'Load Test Gadget',  description: 'Test product', price: 19.99, stockQuantity: 9999, category: 'Electronics' },
];

export default function (): void {
  for (const c of CUSTOMERS) {
    const r = http.post(`${BASE_URL}/api/customers`, JSON.stringify(c), { headers: HEADERS });
    check(r, { 'customer seeded': (res) => res.status === 201 || res.status === 200 });
  }
  for (const p of PRODUCTS) {
    const r = http.post(`${BASE_URL}/api/products`, JSON.stringify(p), { headers: HEADERS });
    check(r, { 'product seeded': (res) => res.status === 201 || res.status === 200 });
  }
  console.log('Seed data setup complete');
}
