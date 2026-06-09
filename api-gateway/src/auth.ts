import { createHmac } from 'crypto';
import type { Request, RequestHandler } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-jwt-secret-change-me';
const JWT_ISSUER = process.env.JWT_ISSUER;
const JWT_AUDIENCE = process.env.JWT_AUDIENCE;
const SERVICE_AUTH_SECRET = process.env.SERVICE_AUTH_SECRET ?? 'dev-service-auth-secret-change-me';
const SERVICE_AUTH_CALLER = process.env.SERVICE_AUTH_CALLER ?? 'api-gateway';

function getBearerToken(req: Request): string | null {
  const auth = req.header('authorization');
  if (!auth) return null;
  const [scheme, token] = auth.split(' ');
  if (!scheme || !token || scheme.toLowerCase() !== 'bearer') return null;
  return token;
}

export const requireJwt: RequestHandler = (req, res, next) => {
  const token = getBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'Missing bearer token' });
    return;
  }

  try {
    jwt.verify(token, JWT_SECRET, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      algorithms: ['HS256'],
    });
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
};

function signPayload(serviceName: string, method: string, pathAndQuery: string, timestamp: string): string {
  return createHmac('sha256', SERVICE_AUTH_SECRET)
    .update(`${serviceName}:${method.toUpperCase()}:${pathAndQuery}:${timestamp}`)
    .digest('hex');
}

export function buildServiceAuthHeaders(req: Request): Record<string, string> {
  const timestamp = Date.now().toString();
  const pathAndQuery = req.originalUrl;
  const signature = signPayload(SERVICE_AUTH_CALLER, req.method, pathAndQuery, timestamp);

  return {
    'x-service-name': SERVICE_AUTH_CALLER,
    'x-service-timestamp': timestamp,
    'x-service-signature': signature,
  };
}
