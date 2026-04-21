export const BASE_URL: string = __ENV.BASE_URL || 'http://localhost:8080';

export const CUSTOMERS: number[] = [1, 2, 3];
export const PRODUCTS: number[]  = [1, 2, 3, 4, 5, 6];

export function randomCustomerId(): number {
  return CUSTOMERS[Math.floor(Math.random() * CUSTOMERS.length)];
}

export function randomProductId(): number {
  return PRODUCTS[Math.floor(Math.random() * PRODUCTS.length)];
}

export interface OrderPayloadItem {
  productId: number;
  quantity: number;
}

export interface OrderPayload {
  customerId: number;
  items: OrderPayloadItem[];
  shippingAddress: string;
  shippingCity: string;
  shippingState: string;
  shippingZip: string;
  shippingCountry: string;
}

export function buildOrderPayload(customerId: number, productId: number, qty = 1): string {
  const payload: OrderPayload = {
    customerId,
    items: [{ productId, quantity: qty }],
    shippingAddress: '123 Main St',
    shippingCity: 'New York',
    shippingState: 'NY',
    shippingZip: '10001',
    shippingCountry: 'USA',
  };
  return JSON.stringify(payload);
}

export const JSON_HEADERS: Record<string, string> = { 'Content-Type': 'application/json' };

export const DEFAULT_THRESHOLDS = {
  http_req_failed:   ['rate<0.01'],
  http_req_duration: ['p(95)<500'],
};
