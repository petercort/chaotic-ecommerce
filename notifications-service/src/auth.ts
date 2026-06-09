import { createHmac, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

type JwtPayload = Record<string, unknown> & {
  exp?: number;
};

function base64UrlEncode(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(input: string): Buffer {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(normalized + padding, 'base64');
}

export function signJwt(payload: JwtPayload, secret: string, expiresInSeconds: number): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const issuedAt = Math.floor(Date.now() / 1000);
  const tokenPayload = {
    ...payload,
    iat: issuedAt,
    exp: issuedAt + expiresInSeconds,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(tokenPayload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac('sha256', secret).update(signingInput).digest();
  return `${signingInput}.${base64UrlEncode(signature)}`;
}

export function verifyJwt(token: string, secret: string): JwtPayload {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid token format');
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const expectedSignature = createHmac('sha256', secret).update(signingInput).digest();
  const actualSignature = base64UrlDecode(encodedSignature);

  if (expectedSignature.length !== actualSignature.length || !timingSafeEqual(expectedSignature, actualSignature)) {
    throw new Error('Invalid token signature');
  }

  const payload = JSON.parse(base64UrlDecode(encodedPayload).toString('utf8')) as JwtPayload;
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp < now) {
    throw new Error('Token expired');
  }

  return payload;
}

export function extractBearerToken(headerValue: string | undefined): string | null {
  if (!headerValue) return null;
  const [scheme, token] = headerValue.split(' ');
  if (scheme !== 'Bearer' || !token) return null;
  return token;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = extractBearerToken(req.header('authorization'));
  if (!token) {
    res.status(401).json({ error: 'Missing bearer token' });
    return;
  }

  const secrets = [process.env.JWT_SECRET ?? 'dev-jwt-secret', process.env.SERVICE_JWT_SECRET ?? 'dev-service-jwt-secret'];
  for (const secret of secrets) {
    try {
      verifyJwt(token, secret);
      next();
      return;
    } catch {
      // try next secret
    }
  }

  res.status(401).json({ error: 'Invalid bearer token' });
}