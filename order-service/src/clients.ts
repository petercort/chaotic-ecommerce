import axios from 'axios';
import CircuitBreaker from 'opossum';
import type { CustomerDto, ProductDto } from './types.js';

const CUSTOMER_SERVICE_URL =
  process.env.CUSTOMER_SERVICE_URL ?? 'http://customer-service:8081';
const INVENTORY_SERVICE_URL =
  process.env.INVENTORY_SERVICE_URL ?? 'http://inventory-service:8082';

const breakerOptions = {
  timeout: 5000,
  errorThresholdPercentage: 50,
  resetTimeout: 10000,
  volumeThreshold: 5,
};

// ─── Customer breaker ────────────────────────────────────────────────────────

const getCustomerFn = async (id: number): Promise<CustomerDto | null> => {
  try {
    const res = await axios.get<CustomerDto>(
      `${CUSTOMER_SERVICE_URL}/api/customers/${id}`,
    );
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
  try {
    const res = await axios.get<ProductDto>(
      `${INVENTORY_SERVICE_URL}/api/products/${id}`,
    );
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
  try {
    await axios.post(
      `${INVENTORY_SERVICE_URL}/api/products/${productId}/reserve`,
      { quantity },
    );
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
  await axios.post(
    `${INVENTORY_SERVICE_URL}/api/products/${productId}/restore`,
    { quantity },
  );
};

const restoreStockBreaker = new CircuitBreaker(restoreStockFn, breakerOptions);

export async function restoreStock(
  productId: number,
  quantity: number,
): Promise<void> {
  return restoreStockBreaker.fire(productId, quantity);
}
