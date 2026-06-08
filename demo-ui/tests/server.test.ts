import request from 'supertest';
import { app } from '../server';

process.env.NODE_ENV = 'test';

describe('demo-ui', () => {
  it('GET / serves index.html with 200', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
  });
});
