import Eureka from 'eureka-js-client';

const EUREKA_HOST = process.env.EUREKA_HOST ?? 'eureka-server';
const EUREKA_PORT = parseInt(process.env.EUREKA_PORT ?? '8761', 10);
const SERVICE_HOST = process.env.HOSTNAME ?? 'localhost';

export function createEurekaClient(appName: string, port: number): Eureka {
  const instanceId = `${SERVICE_HOST}:${appName}:${port}`;
  return new Eureka({
    instance: {
      app: appName.toUpperCase(),
      instanceId,
      hostName: SERVICE_HOST,
      ipAddr: SERVICE_HOST,
      port: { '$': port, '@enabled': 'true' },
      securePort: { '$': 443, '@enabled': 'false' },
      vipAddress: appName,
      statusPageUrl: `http://${SERVICE_HOST}:${port}/actuator/health`,
      healthCheckUrl: `http://${SERVICE_HOST}:${port}/actuator/health`,
      homePageUrl: `http://${SERVICE_HOST}:${port}/`,
      dataCenterInfo: { '@class': 'com.netflix.appinfo.InstanceInfo$DefaultDataCenterInfo', name: 'MyOwn' },
    },
    eureka: {
      host: EUREKA_HOST,
      port: EUREKA_PORT,
      servicePath: '/eureka/apps/',
      maxRetries: 3,
      requestRetryDelay: 2000,
    },
    requestMiddleware: (requestOpts: Record<string, unknown>, done: (opts: Record<string, unknown>) => void) => {
      done(requestOpts);
    },
  });
}

export function startEurekaClient(appName: string, port: number): void {
  const client = createEurekaClient(appName, port);
  client.start((error?: Error) => {
    if (error) {
      console.warn(`[eureka] Failed to register ${appName} — continuing without registry:`, error.message);
    } else {
      console.log(`[eureka] Registered ${appName} with Eureka at ${EUREKA_HOST}:${EUREKA_PORT}`);
    }
  });

  process.on('SIGTERM', () => {
    client.stop(() => process.exit(0));
  });
  process.on('SIGINT', () => {
    client.stop(() => process.exit(0));
  });
}