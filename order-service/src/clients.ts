import axios from 'axios';
import CircuitBreaker from 'opossum';
import type { CustomerDto, ProductDto } from './types.js';
import { createHmac } from 'crypto';

const CUSTOMER_SERVICE_URL =
  process.env.CUSTOMER_SERVICE_URL ?? 'http://customer-service:8081';
const INVENTORY_SERVICE_URL =
  process.env.INVENTORY_SERVICE_URL ?? 'http://inventory-service:8082';
const SERVICE_AUTH_SECRET = process.env.SERVICE_AUTH_SECRET ?? 'dev-service-auth-secret-change-me';
const SERVICE_AUTH_CALLER = process.env.SERVICE_AUTH_CALLER ?? 'order-service';

const breakerOptions = {
  timeout: 5000,
  errorThresholdPercentage: 50,
  resetTimeout: 10000,
  volumeThreshold: 5,
};

function buildServiceHeaders(method: string, rawUrl: string): Record<string, string> {
  const timestamp = Date.now().toString();
  const parsed = new URL(rawUrl);
  const pathAndQuery = `${parsed.pathname}${parsed.search}`;
  const signature = createHmac('sha256', SERVICE_AUTH_SECRET)
    .update(`${SERVICE_AUTH_CALLER}:${method.toUpperCase()}:${pathAndQuery}:${timestamp}`)
    .digest('hex');

  return {
    'x-service-name': SERVICE_AUTH_CALLER,
    'x-service-timestamp': timestamp,
    'x-service-signature': signature,
  };
}

// ─── Customer breaker ────────────────────────────────────────────────────────

const getCustomerFn = async (id: number): Promise<CustomerDto | null> => {
  const url = `${CUSTOMER_SERVICE_URL}/api/customers/${id}`;
  try {
    const res = await axios.get<CustomerDto>(url, {
      headers: buildServiceHeaders('GET', url),
    });
    return res.data;
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 404) return null;
    throw err;
  }
};

const getCustomerBreaker = new CircuitBreaker(getCustomerFn, breakerOptions);

export async function getCustomer(id: number): Promise<CustomerDto | null> {
  return getCustomerBreaker.fire(id);
}

// ─── Product breaker ─────────────────────────────────────────────────────────

const getProductFn = async (id: number): Promise<ProductDto | null> => {
  const url = `${INVENTORY_SERVICE_URL}/api/products/${id}`;
  try {
    const res = await axios.get<ProductDto>(url, {
      headers: buildServiceHeaders('GET', url),
    });
    return res.data;
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 404) return null;
    throw err;
  }
};

const getProductBreaker = new CircuitBreaker(getProductFn, breakerOptions);

export async function getProduct(id: number): Promise<ProductDto | null> {
  return getProductBreaker.fire(id);
}

// ─── Reserve stock breaker ───────────────────────────────────────────────────

const reserveStockFn = async (
  productId: number,
  quantity: number,
): Promise<boolean> => {
  const url = `${INVENTORY_SERVICE_URL}/api/products/${productId}/reserve?quantity=${quantity}`;
  try {
    await axios.post(url, undefined, {
      headers: buildServiceHeaders('POST', url),
    });
    return true;
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 400) return false;
    throw err;
  }
};

const reserveStockBreaker = new CircuitBreaker(reserveStockFn, breakerOptions);

export async function reserveStock(
  productId: number,
  quantity: number,
): Promise<boolean> {
  return reserveStockBreaker.fire(productId, quantity);
}

// ─── Restore stock breaker ───────────────────────────────────────────────────

const restoreStockFn = async (
  productId: number,
  quantity: number,
): Promise<void> => {
  const url = `${INVENTORY_SERVICE_URL}/api/products/${productId}/restore?quantity=${quantity}`;
  await axios.post(url, undefined, {
    headers: buildServiceHeaders('POST', url),
  });
};

const restoreStockBreaker = new CircuitBreaker(restoreStockFn, breakerOptions);

export async function restoreStock(
  productId: number,
  quantity: number,
): Promise<void> {
  return restoreStockBreaker.fire(productId, quantity);
}
