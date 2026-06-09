import request from 'supertest';
import { app, resetStore } from '../src/index';
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
};

describe('notifications-service', () => {
  beforeEach(() => {
    resetStore();
  });

  it('returns UP from the health endpoint', async () => {
    const response = await request(app).get('/actuator/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'UP' });
  });

  it('creates a notification for a valid payload', async () => {
    const response = await request(app)
      .post('/api/notifications')
      .set(authHeaders)
      .send({
        channel: 'email',
        to: 'team@example.com',
        subject: 'Incident detected',
        body: 'Customer checkout latency exceeded threshold.',
      });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      id: expect.any(String),
      status: 'sent',
    });
  });

  it('rejects an invalid payload', async () => {
    const response = await request(app)
      .post('/api/notifications')
      .set(authHeaders)
      .send({
        channel: 'fax',
        to: '',
        subject: '',
        body: '',
      });

    expect(response.status).toBe(400);
    expect(response.body.errors).toEqual(expect.any(Array));
    expect(response.body.errors.length).toBeGreaterThan(0);
  });

  it('rejects invalid email when channel is email', async () => {
    const response = await request(app)
      .post('/api/notifications')
      .set(authHeaders)
      .send({
        channel: 'email',
        to: 'not-an-email',
        subject: 'Test',
        body: 'Body',
      });

    expect(response.status).toBe(400);
    expect(response.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringContaining('valid email'),
          path: ['to'],
        }),
      ])
    );
  });

  it('lists stored notifications', async () => {
    await request(app)
      .post('/api/notifications')
      .set(authHeaders)
      .send({
        channel: 'sms',
        to: '+15551234567',
        subject: 'Alert',
        body: 'Inventory service is degraded.',
      });

    const response = await api.get('/api/notifications');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      expect.objectContaining({
        id: expect.any(String),
        channel: 'sms',
        to: '+15551234567',
        subject: 'Alert',
        body: 'Inventory service is degraded.',
        status: 'sent',
      }),
    ]);
  });
});
