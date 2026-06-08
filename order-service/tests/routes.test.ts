import request from 'supertest';
import app from '../src/index';

jest.mock('../src/eureka');
jest.mock('../src/clients');

process.env.NODE_ENV = 'test';

import * as clients from '../src/clients';

const mockGetCustomer = clients.getCustomer as jest.MockedFunction<typeof clients.getCustomer>;
const mockGetProduct = clients.getProduct as jest.MockedFunction<typeof clients.getProduct>;
const mockReserveStock = clients.reserveStock as jest.MockedFunction<typeof clients.reserveStock>;
const mockRestoreStock = clients.restoreStock as jest.MockedFunction<typeof clients.restoreStock>;

const customer = { id: 1, firstName: 'Alice', lastName: 'Test', email: 'alice@test.com' };
const product = { id: 10, name: 'Widget', sku: 'W-001', price: 25.00, stockQuantity: 100 };

beforeEach(() => {
  jest.clearAllMocks();
});

describe('order-service', () => {
  // ── Health ────────────────────────────────────────────────────────────────

  it('GET /actuator/health returns UP', async () => {
    const res = await request(app).get('/actuator/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'UP' });
  });

  // ── POST /api/orders — saga happy path ────────────────────────────────────

  it('POST /api/orders creates order on happy path', async () => {
    mockGetCustomer.mockResolvedValue(customer as any);
    mockGetProduct.mockResolvedValue(product as any);
    mockReserveStock.mockResolvedValue(true);

    const res = await request(app).post('/api/orders').send({
      customerId: 1,
      items: [{ productId: 10, quantity: 2 }],
    });

    expect(res.status).toBe(201);
    expect(res.body.customerId).toBe(1);
    expect(res.body.totalAmount).toBe(50.00);
    expect(mockReserveStock).toHaveBeenCalledWith(10, 2);
  });

  it('POST /api/orders returns 404 when customer not found', async () => {
    mockGetCustomer.mockResolvedValue(null);

    const res = await request(app).post('/api/orders').send({
      customerId: 999,
      items: [{ productId: 10, quantity: 1 }],
    });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/customer not found/i);
  });

  it('POST /api/orders returns 404 when product not found', async () => {
    mockGetCustomer.mockResolvedValue(customer as any);
    mockGetProduct.mockResolvedValue(null);

    const res = await request(app).post('/api/orders').send({
      customerId: 1,
      items: [{ productId: 999, quantity: 1 }],
    });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it('POST /api/orders returns 400 for insufficient stock and calls restoreStock rollback', async () => {
    mockGetCustomer.mockResolvedValue(customer as any);
    mockGetProduct.mockResolvedValueOnce(product as any).mockResolvedValueOnce(product as any);
    mockReserveStock
      .mockResolvedValueOnce(true)  // first item reserved
      .mockResolvedValueOnce(false); // second item fails
    mockRestoreStock.mockResolvedValue(undefined);

    const res = await request(app).post('/api/orders').send({
      customerId: 1,
      items: [
        { productId: 10, quantity: 1 },
        { productId: 10, quantity: 1 },
      ],
    });

    expect(res.status).toBe(400);
    expect(mockRestoreStock).toHaveBeenCalledWith(10, 1);
  });

  it('POST /api/orders returns 503 when circuit is open', async () => {
    mockGetCustomer.mockResolvedValue(customer as any);
    mockGetProduct.mockResolvedValue(product as any);
    const openErr = new Error('Circuit breaker is open');
    mockReserveStock.mockRejectedValue(openErr);
    mockRestoreStock.mockResolvedValue(undefined);

    const res = await request(app).post('/api/orders').send({
      customerId: 1,
      items: [{ productId: 10, quantity: 1 }],
    });

    expect(res.status).toBe(503);
  });

  it('POST /api/orders returns 400 for Zod validation error', async () => {
    const res = await request(app).post('/api/orders').send({ customerId: 1, items: [] });
    expect(res.status).toBe(400);
  });

  // ── GET /api/orders ───────────────────────────────────────────────────────

  it('GET /api/orders returns list', async () => {
    const res = await request(app).get('/api/orders');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /api/orders/:id returns 404 for nonexistent', async () => {
    const res = await request(app).get('/api/orders/999999');
    expect(res.status).toBe(404);
  });

  it('GET /api/orders/customer/:customerId returns list', async () => {
    const res = await request(app).get('/api/orders/customer/1');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /api/orders/status/:status returns list', async () => {
    const res = await request(app).get('/api/orders/status/CONFIRMED');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  // ── PATCH /api/orders/:id/status ──────────────────────────────────────────

  it('PATCH /api/orders/:id/status updates status', async () => {
    mockGetCustomer.mockResolvedValue(customer as any);
    mockGetProduct.mockResolvedValue(product as any);
    mockReserveStock.mockResolvedValue(true);

    const create = await request(app).post('/api/orders').send({
      customerId: 1,
      items: [{ productId: 10, quantity: 1 }],
    });
    const id = create.body.id;

    const res = await request(app)
      .patch(`/api/orders/${id}/status`)
      .send({ status: 'SHIPPED' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('SHIPPED');
  });

  it('PATCH /api/orders/:id/status returns 400 for invalid status', async () => {
    const res = await request(app)
      .patch('/api/orders/1/status')
      .send({ status: 'INVALID_STATUS' });
    expect(res.status).toBe(400);
  });

  it('PATCH /api/orders/:id/status returns 404 for nonexistent order', async () => {
    const res = await request(app)
      .patch('/api/orders/999999/status')
      .send({ status: 'SHIPPED' });
    expect(res.status).toBe(404);
  });

  // ── DELETE /api/orders/:id ────────────────────────────────────────────────

  it('DELETE /api/orders/:id deletes order', async () => {
    mockGetCustomer.mockResolvedValue(customer as any);
    mockGetProduct.mockResolvedValue(product as any);
    mockReserveStock.mockResolvedValue(true);

    const create = await request(app).post('/api/orders').send({
      customerId: 1,
      items: [{ productId: 10, quantity: 1 }],
    });
    const id = create.body.id;

    const del = await request(app).delete(`/api/orders/${id}`);
    expect(del.status).toBe(204);

    const get = await request(app).get(`/api/orders/${id}`);
    expect(get.status).toBe(404);
  });

  it('DELETE /api/orders/:id returns 404 for nonexistent', async () => {
    const res = await request(app).delete('/api/orders/999999');
    expect(res.status).toBe(404);
  });
});
