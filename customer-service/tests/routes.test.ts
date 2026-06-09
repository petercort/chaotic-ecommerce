import request from 'supertest';
import { createHmac } from 'crypto';
import { app } from '../src/index';
import pool, { rowToCustomer, runMigrations, seedDefaultCustomers, closePool } from '../src/db';
import type { CustomerRow } from '../src/types';

jest.mock('../src/eureka');

process.env.NODE_ENV = 'test';
process.env.SERVICE_AUTH_SECRET = 'test-service-secret';

function serviceHeaders(method: string, path: string): Record<string, string> {
  const timestamp = Date.now().toString();
  const serviceName = 'api-gateway';
  const signature = createHmac('sha256', process.env.SERVICE_AUTH_SECRET as string)
    .update(`${serviceName}:${method.toUpperCase()}:${path}:${timestamp}`)
    .digest('hex');

  return {
    'x-service-name': serviceName,
    'x-service-timestamp': timestamp,
    'x-service-signature': signature,
  };
}

function getApi(path: string) {
  return request(app).get(path).set(serviceHeaders('GET', path));
}

function postApi(path: string) {
  return request(app).post(path).set(serviceHeaders('POST', path));
}

function putApi(path: string) {
  return request(app).put(path).set(serviceHeaders('PUT', path));
}

function deleteApi(path: string) {
  return request(app).delete(path).set(serviceHeaders('DELETE', path));
}

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

  it('GET /api/customers returns seeded list', async () => {
    const res = await getApi('/api/customers');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(3);
  });

  it('GET /api/customers returns 401 without service credentials', async () => {
    const res = await request(app).get('/api/customers');
    expect(res.status).toBe(401);
  });

  // ── GET /api/customers/email/:email ────────────────────────────────────────

  it('GET /api/customers/email/:email returns customer', async () => {
    const res = await getApi('/api/customers/email/john.doe@example.com');
    expect(res.status).toBe(200);
    expect(res.body.email).toBe('john.doe@example.com');
  });

  it('GET /api/customers/email/:email returns 404 for unknown email', async () => {
    const res = await getApi('/api/customers/email/nobody@example.com');
    expect(res.status).toBe(404);
  });

  // ── GET /api/customers/:id ──────────────────────────────────────────────────

  it('GET /api/customers/:id returns customer', async () => {
    const list = await getApi('/api/customers');
    const id = list.body[0].id;
    const res = await getApi(`/api/customers/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(id);
  });

  it('GET /api/customers/:id returns 404 for nonexistent id', async () => {
    const res = await getApi('/api/customers/999999');
    expect(res.status).toBe(404);
  });

  // ── POST /api/customers ─────────────────────────────────────────────────────

  it('POST /api/customers creates a new customer', async () => {
    const before = (await getApi('/api/customers')).body.length;
    const res = await postApi('/api/customers').send(validCustomer);
    expect(res.status).toBe(201);
    expect(res.body.email).toBe(validCustomer.email);
    const after = (await getApi('/api/customers')).body.length;
    expect(after).toBe(before + 1);
  });

  it('POST /api/customers returns 400 for invalid payload (Zod)', async () => {
    const res = await postApi('/api/customers')
      .send({ firstName: '', email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(expect.any(Array));
  });

  it('POST /api/customers returns 409 for duplicate email', async () => {
    await postApi('/api/customers').send(validCustomer);
    const res = await postApi('/api/customers').send(validCustomer);
    expect(res.status).toBe(409);
  });

  // ── PUT /api/customers/:id ──────────────────────────────────────────────────

  it('PUT /api/customers/:id updates customer', async () => {
    const create = await postApi('/api/customers').send(validCustomer);
    const id = create.body.id;
    const res = await putApi(`/api/customers/${id}`)
      .send({ ...validCustomer, firstName: 'Updated' });
    expect(res.status).toBe(200);
    expect(res.body.firstName).toBe('Updated');
  });

  it('PUT /api/customers/:id returns 409 for email conflict with other customer', async () => {
    const create = await postApi('/api/customers').send(validCustomer);
    const id = create.body.id;
    const res = await putApi(`/api/customers/${id}`)
      .send({ ...validCustomer, email: 'john.doe@example.com' });
    expect(res.status).toBe(409);
  });

  it('PUT /api/customers/:id returns 404 for nonexistent customer', async () => {
    const res = await putApi('/api/customers/999999')
      .send(validCustomer);
    expect(res.status).toBe(404);
  });

  // ── DELETE /api/customers/:id ───────────────────────────────────────────────

  it('DELETE /api/customers/:id deletes customer', async () => {
    const create = await postApi('/api/customers').send(validCustomer);
    const id = create.body.id;
    const del = await deleteApi(`/api/customers/${id}`);
    expect(del.status).toBe(204);
    const get = await getApi(`/api/customers/${id}`);
    expect(get.status).toBe(404);
  });

  it('DELETE /api/customers/:id returns 404 for nonexistent customer', async () => {
    const res = await deleteApi('/api/customers/999999');
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
