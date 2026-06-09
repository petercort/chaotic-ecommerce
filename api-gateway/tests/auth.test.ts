import request from 'supertest';
import axios from 'axios';
import { app } from '../src/index';
import { signJwt } from '../src/auth';

jest.mock('axios');
jest.mock('../src/eureka');

const mockAxios = axios as unknown as jest.MockedFunction<typeof axios>;

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';

const authHeaders = {
  Authorization: `Bearer ${signJwt({ sub: '1', username: 'tester', email: 'tester@example.com', type: 'user' }, process.env.JWT_SECRET ?? 'test-secret', 60 * 60)}`,
};

describe('api-gateway auth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 401 for protected routes without a token', async () => {
    const res = await request(app).get('/api/customers');
    expect(res.status).toBe(401);
    expect(mockAxios).not.toHaveBeenCalled();
  });

  it('proxies protected routes with a valid token', async () => {
    mockAxios.mockResolvedValue({
      status: 200,
      data: [{ id: 1, firstName: 'Alice' }],
      headers: {},
      statusText: 'OK',
      config: {},
    } as never);

    const res = await request(app).get('/api/customers').set(authHeaders);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 1, firstName: 'Alice' }]);
    expect(mockAxios).toHaveBeenCalled();
  });

  it('proxies auth routes without requiring a token', async () => {
    mockAxios.mockResolvedValue({
      status: 200,
      data: { token: 'jwt-token' },
      headers: {},
      statusText: 'OK',
      config: {},
    } as never);

    const res = await request(app)
      .post('/auth/login')
      .send({ username: 'alice', password: 'secret' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ token: 'jwt-token' });
    expect(mockAxios).toHaveBeenCalled();
  });
});