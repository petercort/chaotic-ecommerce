import axios from 'axios';

jest.mock('axios');

process.env.SERVICE_AUTH_SECRET = 'test-service-secret';
process.env.SERVICE_AUTH_CALLER = 'order-service';

import { getCustomer, getProduct, reserveStock, restoreStock } from '../src/clients';

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('order-service client auth headers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('adds service auth headers for GET customer', async () => {
    mockedAxios.get.mockResolvedValue({ data: { id: 1, email: 'a@test.com' } });

    await getCustomer(1);

    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    const [, config] = mockedAxios.get.mock.calls[0];
    expect(config?.headers?.['x-service-name']).toBe('order-service');
    expect(config?.headers?.['x-service-timestamp']).toEqual(expect.any(String));
    expect(config?.headers?.['x-service-signature']).toMatch(/^[a-f0-9]{64}$/i);
  });

  it('adds service auth headers for GET product', async () => {
    mockedAxios.get.mockResolvedValue({ data: { id: 10, sku: 'SKU-1', name: 'P', price: 10 } });

    await getProduct(10);

    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    const [, config] = mockedAxios.get.mock.calls[0];
    expect(config?.headers?.['x-service-name']).toBe('order-service');
    expect(config?.headers?.['x-service-signature']).toMatch(/^[a-f0-9]{64}$/i);
  });

  it('adds service auth headers for reserve stock', async () => {
    mockedAxios.post.mockResolvedValue({ data: {} });

    await reserveStock(10, 3);

    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    const [, body, config] = mockedAxios.post.mock.calls[0];
    expect(body).toBeUndefined();
    expect(config?.headers?.['x-service-name']).toBe('order-service');
    expect(config?.headers?.['x-service-signature']).toMatch(/^[a-f0-9]{64}$/i);
  });

  it('adds service auth headers for restore stock', async () => {
    mockedAxios.post.mockResolvedValue({ data: {} });

    await restoreStock(10, 2);

    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    const [, body, config] = mockedAxios.post.mock.calls[0];
    expect(body).toBeUndefined();
    expect(config?.headers?.['x-service-name']).toBe('order-service');
    expect(config?.headers?.['x-service-signature']).toMatch(/^[a-f0-9]{64}$/i);
  });
});
