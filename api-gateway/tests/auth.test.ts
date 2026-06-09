import request from 'supertest';
import jwt from 'jsonwebtoken';
import axios from 'axios';

jest.mock('../src/eureka');
jest.mock('axios');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.SERVICE_AUTH_SECRET = 'test-service-secret';
process.env.SERVICE_AUTH_CALLER = 'api-gateway';

import app from '../src/index';

const mockedAxios = axios as jest.MockedFunction<typeof axios>;

function createToken(): string {
  return jwt.sign({ sub: 'user-1' }, process.env.JWT_SECRET as string, {
    algorithm: 'HS256',
    expiresIn: '10m',
  });
}

describe('api-gateway auth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedAxios.mockResolvedValue({
      status: 200,
      data: [{ id: 1, firstName: 'Alice' }],
      headers: { 'content-type': 'application/json' },
      statusText: 'OK',
      config: {},
    });
  });

  it('returns 401 without bearer token', async () => {
    const res = await request(app).get('/api/customers');

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/missing bearer token/i);
    expect(mockedAxios).not.toHaveBeenCalled();
  });

  it('returns 401 with invalid token', async () => {
    const res = await request(app)
      .get('/api/customers')
      .set('Authorization', 'Bearer invalid-token');

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid token/i);
    expect(mockedAxios).not.toHaveBeenCalled();
  });

  it('forwards request for valid token and preserves Authorization header', async () => {
    const token = createToken();

    const res = await request(app)
      .get('/api/customers')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(mockedAxios).toHaveBeenCalledTimes(1);

    const axiosCall = mockedAxios.mock.calls[0][0] as any;
    expect(axiosCall?.headers?.authorization).toBe(`Bearer ${token}`);
    expect(axiosCall?.headers?.['x-service-name']).toBe('api-gateway');
    expect(axiosCall?.headers?.['x-service-timestamp']).toEqual(expect.any(String));
    expect(axiosCall?.headers?.['x-service-signature']).toEqual(expect.any(String));
  });
});
