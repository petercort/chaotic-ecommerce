declare module 'eureka-js-client' {
  interface EurekaInstanceConfig {
    app: string;
    instanceId: string;
    hostName: string;
    ipAddr: string;
    port: { $: number; '@enabled': string };
    securePort: { $: number; '@enabled': string };
    vipAddress: string;
    statusPageUrl: string;
    healthCheckUrl: string;
    homePageUrl: string;
    dataCenterInfo: { '@class': string; name: string };
  }

  interface EurekaClientConfig {
    host: string;
    port: number;
    servicePath: string;
    maxRetries?: number;
    requestRetryDelay?: number;
  }

  interface EurekaOptions {
    instance: EurekaInstanceConfig;
    eureka: EurekaClientConfig;
    requestMiddleware?: (
      requestOpts: Record<string, unknown>,
      done: (opts: Record<string, unknown>) => void
    ) => void;
  }

  class Eureka {
    constructor(options: EurekaOptions);
    start(callback?: (error?: Error) => void): void;
    stop(callback?: () => void): void;
  }

  export = Eureka;
}
