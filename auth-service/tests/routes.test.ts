import request from 'supertest';
import { app } from '../src/index.js';
import { closePool, runMigrations, pool } from '../src/db.js';
import { verifyJwt } from '../src/auth.js';

jest.mock('../src/eureka');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';

const validUser = {
  username: 'alice',
  email: 'alice@example.com',
  password: 'super-secret',
};

describe('auth-service', () => {
  beforeAll(async () => {
    await runMigrations();
  });

  afterAll(async () => {
    await closePool();
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM users');
  });

  it('GET /actuator/health returns UP', async () => {
    const res = await request(app).get('/actuator/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'UP' });
  });

  it('POST /auth/register creates a user', async () => {
    const res = await request(app).post('/auth/register').send(validUser);
    expect(res.status).toBe(201);
    expect(res.body.username).toBe(validUser.username);
    expect(res.body.email).toBe(validUser.email);
  });

  it('POST /auth/register rejects invalid payload', async () => {
    const res = await request(app).post('/auth/register').send({ username: '', email: 'bad', password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(expect.any(Array));
  });

  it('POST /auth/register rejects duplicates', async () => {
    await request(app).post('/auth/register').send(validUser);
    const res = await request(app).post('/auth/register').send(validUser);
    expect(res.status).toBe(409);
  });

  it('POST /auth/login returns a valid token', async () => {
    await request(app).post('/auth/register').send(validUser);
    const res = await request(app).post('/auth/login').send({
      username: validUser.username,
      password: validUser.password,
    });
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');

    const payload = verifyJwt(res.body.token, process.env.JWT_SECRET ?? 'test-secret');
    expect(payload.username).toBe(validUser.username);
    expect(payload.email).toBe(validUser.email);
    expect(payload.type).toBe('user');
  });

  it('POST /auth/login rejects invalid credentials', async () => {
    await request(app).post('/auth/register').send(validUser);
    const res = await request(app).post('/auth/login').send({
      username: validUser.username,
      password: 'wrong-password',
    });
    expect(res.status).toBe(401);
  });
});