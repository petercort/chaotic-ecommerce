import request from 'supertest';
import { app } from '../src/index';
import pool, { rowToCustomer, runMigrations, seedDefaultCustomers, closePool } from '../src/db';
import type { CustomerRow } from '../src/types';
import { signJwt } from '../src/auth';

jest.mock('../src/eureka');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';

const authHeaders = {
  Authorization: `Bearer ${signJwt({ sub: '1', username: 'tester', email: 'tester@example.com', type: 'user' }, process.env.JWT_SECRET ?? 'test-secret', 60 * 60)}`,
};

const api = {
  get: (path: string) => request(app).get(path).set(authHeaders),
  post: (path: string) => request(app).post(path).set(authHeaders),
  put: (path: string) => request(app).put(path).set(authHeaders),
  delete: (path: string) => request(app).delete(path).set(authHeaders),
};

const validCustomer = {
  firstName: 'Alice',
  lastName: 'Test',
  email: 'alice.test@example.com',
  phone: '555-9999',
  address: '1 Test Lane',
  city: 'Testville',
  state: 'CA',
  zipCode: '90001',
  country: 'USA',
};

describe('customer-service', () => {
  beforeAll(async () => {
    await runMigrations();
    await seedDefaultCustomers();
  });

  afterAll(async () => {
    await closePool();
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM customers WHERE email NOT IN ($1, $2, $3)', [
      'john.doe@example.com',
      'jane.smith@example.com',
      'bob.johnson@example.com',
    ]);
  });

  // ── Health ──────────────────────────────────────────────────────────────────

  it('GET /actuator/health returns UP when DB is connected', async () => {
    const res = await request(app).get('/actuator/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('UP');
    expect(res.body.db).toBe('connected');
  });

  // ── GET /api/customers ──────────────────────────────────────────────────────

  it('GET /api/customers returns 401 without a bearer token', async () => {
    const res = await request(app).get('/api/customers');
    expect(res.status).toBe(401);
  });

  it('GET /api/customers returns seeded list', async () => {
    const res = await api.get('/api/customers');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(3);
  });

  // ── GET /api/customers/email/:email ────────────────────────────────────────

  it('GET /api/customers/email/:email returns customer', async () => {
    const res = await api.get('/api/customers/email/john.doe@example.com');
    expect(res.status).toBe(200);
    expect(res.body.email).toBe('john.doe@example.com');
  });

  it('GET /api/customers/email/:email returns 404 for unknown email', async () => {
    const res = await api.get('/api/customers/email/nobody@example.com');
    expect(res.status).toBe(404);
  });

  // ── GET /api/customers/:id ──────────────────────────────────────────────────

  it('GET /api/customers/:id returns customer', async () => {
    const list = await api.get('/api/customers');
    const id = list.body[0].id;
    const res = await api.get(`/api/customers/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(id);
  });

  it('GET /api/customers/:id returns 404 for nonexistent id', async () => {
    const res = await api.get('/api/customers/999999');
    expect(res.status).toBe(404);
  });

  // ── POST /api/customers ─────────────────────────────────────────────────────

  it('POST /api/customers creates a new customer', async () => {
    const before = (await api.get('/api/customers')).body.length;
    const res = await api.post('/api/customers').send(validCustomer);
    expect(res.status).toBe(201);
    expect(res.body.email).toBe(validCustomer.email);
    const after = (await api.get('/api/customers')).body.length;
    expect(after).toBe(before + 1);
  });

  it('POST /api/customers returns 400 for invalid payload (Zod)', async () => {
    const res = await api
      .post('/api/customers')
      .send({ firstName: '', email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(expect.any(Array));
  });

  it('POST /api/customers returns 409 for duplicate email', async () => {
    await api.post('/api/customers').send(validCustomer);
    const res = await api.post('/api/customers').send(validCustomer);
    expect(res.status).toBe(409);
  });

  // ── PUT /api/customers/:id ──────────────────────────────────────────────────

  it('PUT /api/customers/:id updates customer', async () => {
    const create = await api.post('/api/customers').send(validCustomer);
    const id = create.body.id;
    const res = await api
      .put(`/api/customers/${id}`)
      .send({ ...validCustomer, firstName: 'Updated' });
    expect(res.status).toBe(200);
    expect(res.body.firstName).toBe('Updated');
  });

  it('PUT /api/customers/:id returns 409 for email conflict with other customer', async () => {
    const create = await api.post('/api/customers').send(validCustomer);
    const id = create.body.id;
    const res = await api
      .put(`/api/customers/${id}`)
      .send({ ...validCustomer, email: 'john.doe@example.com' });
    expect(res.status).toBe(409);
  });

  it('PUT /api/customers/:id returns 404 for nonexistent customer', async () => {
    const res = await api
      .put('/api/customers/999999')
      .send(validCustomer);
    expect(res.status).toBe(404);
  });

  // ── DELETE /api/customers/:id ───────────────────────────────────────────────

  it('DELETE /api/customers/:id deletes customer', async () => {
    const create = await api.post('/api/customers').send(validCustomer);
    const id = create.body.id;
    const del = await api.delete(`/api/customers/${id}`);
    expect(del.status).toBe(204);
    const get = await api.get(`/api/customers/${id}`);
    expect(get.status).toBe(404);
  });

  it('DELETE /api/customers/:id returns 404 for nonexistent customer', async () => {
    const res = await api.delete('/api/customers/999999');
    expect(res.status).toBe(404);
  });

  // ── rowToCustomer unit test ─────────────────────────────────────────────────

  it('rowToCustomer maps snake_case to camelCase', () => {
    const row: CustomerRow = {
      id: 1,
      first_name: 'John',
      last_name: 'Doe',
      email: 'john@example.com',
      phone: '555-0000',
      address: '1 Main St',
      city: 'Springfield',
      state: 'IL',
      zip_code: '62701',
      country: 'USA',
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: null,
    };
    const customer = rowToCustomer(row);
    expect(customer.firstName).toBe('John');
    expect(customer.lastName).toBe('Doe');
    expect(customer.zipCode).toBe('62701');
    expect(customer.createdAt).toBe('2024-01-01T00:00:00.000Z');
    expect(customer.updatedAt).toBeNull();
  });
});
