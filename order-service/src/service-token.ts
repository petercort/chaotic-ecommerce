import { signJwt } from './auth.js';

let cachedToken: string | null = null;
let cachedTokenExpiryMs = 0;

export function getServiceToken(): string {
  const now = Date.now();
  if (cachedToken && now < cachedTokenExpiryMs) {
    return cachedToken;
  }

  const secret = process.env.SERVICE_JWT_SECRET ?? process.env.JWT_SECRET ?? 'dev-service-jwt-secret';
  const token = signJwt(
    {
      sub: 'order-service',
      type: 'service',
      username: 'order-service',
      email: 'order-service@internal.local',
    },
    secret,
    5 * 60,
  );

  cachedToken = token;
  cachedTokenExpiryMs = now + 4 * 60 * 1000;
  return token;
}