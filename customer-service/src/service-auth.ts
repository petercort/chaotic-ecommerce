import { createHmac, timingSafeEqual } from 'crypto';
import type { RequestHandler } from 'express';

function invalid(res: Parameters<RequestHandler>[1], message = 'Unauthorized service request'): void {
  res.status(401).json({ error: message });
}

function computeSignature(serviceName: string, method: string, pathAndQuery: string, timestamp: string): string {
  const serviceAuthSecret = process.env.SERVICE_AUTH_SECRET ?? 'dev-service-auth-secret-change-me';
  return createHmac('sha256', serviceAuthSecret)
    .update(`${serviceName}:${method.toUpperCase()}:${pathAndQuery}:${timestamp}`)
    .digest('hex');
}

export const requireServiceAuth: RequestHandler = (req, res, next) => {
  const serviceName = req.header('x-service-name');
  const timestamp = req.header('x-service-timestamp');
  const signature = req.header('x-service-signature');

  if (!serviceName || !timestamp || !signature) {
    invalid(res);
    return;
  }

  const ts = Number(timestamp);
  const maxSkewMs = Number(process.env.SERVICE_AUTH_MAX_SKEW_MS ?? 5 * 60 * 1000);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > maxSkewMs) {
    invalid(res, 'Stale service request');
    return;
  }

  const expected = computeSignature(serviceName, req.method, req.originalUrl, timestamp);
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(signature);

  if (expectedBuf.length !== providedBuf.length || !timingSafeEqual(expectedBuf, providedBuf)) {
    invalid(res);
    return;
  }

  next();
};
