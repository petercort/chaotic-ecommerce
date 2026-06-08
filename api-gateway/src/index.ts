import express, { Request, Response } from 'express';
import { startEurekaClient } from './eureka';
import cors from 'cors';
import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import CircuitBreaker from 'opossum';
import rateLimit, { type Store } from 'express-rate-limit';
import { RedisStore, type RedisReply } from 'rate-limit-redis';
import { createClient } from 'redis';

const app = express();
const PORT = parseInt(process.env.PORT ?? '8080', 10);

const CUSTOMER_SERVICE_URL = process.env.CUSTOMER_SERVICE_URL ?? 'http://customer-service:8081';
const INVENTORY_SERVICE_URL = process.env.INVENTORY_SERVICE_URL ?? 'http://inventory-service:8082';
const ORDER_SERVICE_URL = process.env.ORDER_SERVICE_URL ?? 'http://order-service:8083';
const NOTIFICATIONS_SERVICE_URL = process.env.NOTIFICATIONS_SERVICE_URL ?? 'http://notifications-service:8084';

const RATE_LIMIT_ENABLED = process.env.RATE_LIMIT_ENABLED !== 'false';
const RATE_LIMIT_WINDOW_MS = parsePositiveIntegerEnv('RATE_LIMIT_WINDOW_MS', 60_000);
const RATE_LIMIT_MAX = parsePositiveIntegerEnv('RATE_LIMIT_MAX', 100);
const RATE_LIMIT_MESSAGE = process.env.RATE_LIMIT_MESSAGE ?? 'Too many requests';
const RATE_LIMIT_REDIS_PREFIX = process.env.RATE_LIMIT_REDIS_PREFIX ?? 'api-gateway:rate-limit:';
const RATE_LIMIT_REDIS_REQUIRED = process.env.RATE_LIMIT_REDIS_REQUIRED === 'true';
const RATE_LIMIT_FAIL_OPEN = process.env.RATE_LIMIT_FAIL_OPEN !== 'false';
const RATE_LIMIT_SKIP_HEALTH = process.env.RATE_LIMIT_SKIP_HEALTH !== 'false';
const RATE_LIMIT_TRUST_PROXY = process.env.RATE_LIMIT_TRUST_PROXY === 'true';
const REDIS_URL = process.env.REDIS_URL;

if (RATE_LIMIT_TRUST_PROXY) {
  app.set('trust proxy', 1);
}

function parsePositiveIntegerEnv(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (!raw) {
    return defaultValue;
  }

  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.warn(`[rate-limit] Invalid ${name}=${raw}; using ${defaultValue}`);
    return defaultValue;
  }

  return parsed;
}

function buildRateLimitStore(): Store | undefined {
  if (!REDIS_URL) {
    if (RATE_LIMIT_REDIS_REQUIRED) {
      throw new Error('RATE_LIMIT_REDIS_REQUIRED=true but REDIS_URL is not configured');
    }

    console.warn('[rate-limit] REDIS_URL not configured; using in-memory rate limit store');
    return undefined;
  }

  const redisClient = createClient({ url: REDIS_URL });

  redisClient.on('error', (err) => {
    console.error('[rate-limit] Redis client error:', err);
  });

  void redisClient.connect()
    .then(() => console.log('[rate-limit] Connected to Redis rate limit store'))
    .catch((err) => {
      console.error('[rate-limit] Failed to connect to Redis rate limit store:', err);

      if (RATE_LIMIT_REDIS_REQUIRED) {
        process.exit(1);
      }
    });

  return new RedisStore({
    prefix: RATE_LIMIT_REDIS_PREFIX,
    sendCommand: async (...args: string[]): Promise<RedisReply> => redisClient.sendCommand(args) as Promise<RedisReply>,
  });
}

function buildRateLimiter() {
  return rateLimit({
    windowMs: RATE_LIMIT_WINDOW_MS,
    limit: RATE_LIMIT_MAX,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    identifier: 'api-gateway-global',
    passOnStoreError: RATE_LIMIT_FAIL_OPEN,
    store: buildRateLimitStore(),
    skip: (req) => RATE_LIMIT_SKIP_HEALTH && req.path === '/actuator/health',
    handler: (_req, res) => {
      res.status(429).json({ error: RATE_LIMIT_MESSAGE });
    },
  });
}

app.use(
  cors({
    origin: ['http://localhost:8090', 'http://localhost:3000'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Requested-With'],
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

if (RATE_LIMIT_ENABLED) {
  app.use(buildRateLimiter());
  console.log(`[rate-limit] Enabled: ${RATE_LIMIT_MAX} requests per ${RATE_LIMIT_WINDOW_MS}ms`);
} else {
  console.warn('[rate-limit] Disabled by RATE_LIMIT_ENABLED=false');
}

const breakerOptions: CircuitBreaker.Options = {
  timeout: 5000,
  errorThresholdPercentage: 50,
  resetTimeout: 10000,
  volumeThreshold: 5,
};

type ProxyRequest = {
  method: string;
  url: string;
  headers: Record<string, string>;
  data?: unknown;
  params?: Record<string, string>;
};

async function forwardRequest(config: ProxyRequest): Promise<AxiosResponse> {
  const axiosConfig: AxiosRequestConfig = {
    method: config.method,
    url: config.url,
    headers: config.headers,
    data: config.data,
    params: config.params,
    validateStatus: () => true,
  };
  return axios(axiosConfig);
}

function buildBreaker(serviceName: string) {
  const breaker = new CircuitBreaker(forwardRequest, breakerOptions);

  breaker.on('open', () => console.log(`[circuit-breaker] ${serviceName} circuit OPEN`));
  breaker.on('halfOpen', () => console.log(`[circuit-breaker] ${serviceName} circuit HALF-OPEN`));
  breaker.on('close', () => console.log(`[circuit-breaker] ${serviceName} circuit CLOSED`));

  return breaker;
}

const customerBreaker = buildBreaker('customer-service');
const inventoryBreaker = buildBreaker('inventory-service');
const orderBreaker = buildBreaker('order-service');
const notificationsBreaker = buildBreaker('notifications-service');

function buildProxyHandler(breaker: CircuitBreaker, baseUrl: string, serviceName: string) {
  return async (req: Request, res: Response): Promise<void> => {
    const { host: _host, ...forwardHeaders } = req.headers as Record<string, string>;

    const proxyRequest: ProxyRequest = {
      method: req.method,
      url: `${baseUrl}${req.path}`,
      headers: forwardHeaders,
      data: Object.keys(req.body ?? {}).length > 0 ? req.body : undefined,
      params: req.query as Record<string, string>,
    };

    try {
      const upstream = await breaker.fire(proxyRequest) as AxiosResponse;
      res.status(upstream.status);

      const hopByHop = new Set([
        'connection', 'keep-alive', 'transfer-encoding', 'te',
        'upgrade', 'trailer', 'proxy-authorization', 'proxy-authenticate',
      ]);

      for (const [key, value] of Object.entries(upstream.headers)) {
        if (!hopByHop.has(key.toLowerCase())) {
          res.setHeader(key, value as string);
        }
      }

      res.send(upstream.data);
    } catch (err) {
      if ((err as Error).message?.includes('Breaker is open')) {
        res.status(503).json({ error: 'Service unavailable', service: serviceName });
      } else {
        console.error(`[proxy] Error forwarding to ${serviceName}:`, err);
        res.status(502).json({ error: 'Bad gateway', service: serviceName });
      }
    }
  };
}

app.get('/actuator/health', (_req: Request, res: Response) => {
  res.json({ status: 'UP' });
});

app.all('/api/customers*', buildProxyHandler(customerBreaker, CUSTOMER_SERVICE_URL, 'customer-service'));
app.all('/api/products*', buildProxyHandler(inventoryBreaker, INVENTORY_SERVICE_URL, 'inventory-service'));
app.all('/api/orders*', buildProxyHandler(orderBreaker, ORDER_SERVICE_URL, 'order-service'));
app.all('/api/notifications*', buildProxyHandler(notificationsBreaker, NOTIFICATIONS_SERVICE_URL, 'notifications-service'));

app.listen(PORT, () => {
  console.log(`api-gateway listening on port ${PORT}`);
  console.log(`  /api/customers/** → ${CUSTOMER_SERVICE_URL}`);
  console.log(`  /api/products/**  → ${INVENTORY_SERVICE_URL}`);
  console.log(`  /api/orders/**    → ${ORDER_SERVICE_URL}`);
  console.log(`  /api/notifications/** → ${NOTIFICATIONS_SERVICE_URL}`);
  startEurekaClient('api-gateway', PORT);
});
