export interface InstanceInfo {
  instanceId: string;
  app: string;
  hostName: string;
  ipAddr: string;
  port: { $: number; '@enabled': string };
  securePort: { $: number; '@enabled': string };
  status: string;
  overriddenstatus: string;
  homePageUrl: string;
  statusPageUrl: string;
  healthCheckUrl: string;
  dataCenterInfo: { '@class': string; name: string };
  leaseInfo: { renewalIntervalInSecs: number; durationInSecs: number };
  metadata: Record<string, string>;
  lastUpdated?: number;
}

class Registry {
  readonly instances: Map<string, Map<string, InstanceInfo>> = new Map();

  register(appId: string, instance: InstanceInfo): void {
    const key = appId.toUpperCase();
    if (!this.instances.has(key)) {
      this.instances.set(key, new Map());
    }
    instance.lastUpdated = Date.now();
    this.instances.get(key)!.set(instance.instanceId, instance);
  }

  renew(appId: string, instanceId: string): boolean {
    const app = this.instances.get(appId.toUpperCase());
    const inst = app?.get(instanceId);
    if (!inst) return false;
    inst.lastUpdated = Date.now();
    return true;
  }

  deregister(appId: string, instanceId: string): boolean {
    const app = this.instances.get(appId.toUpperCase());
    if (!app) return false;
    return app.delete(instanceId);
  }

  getApp(appId: string): InstanceInfo[] {
    const app = this.instances.get(appId.toUpperCase());
    return app ? Array.from(app.values()) : [];
  }

  getAllApps(): { name: string; instance: InstanceInfo[] }[] {
    return Array.from(this.instances.entries()).map(([name, instanceMap]) => ({
      name,
      instance: Array.from(instanceMap.values()),
    }));
  }

  getInstance(appId: string, instanceId: string): InstanceInfo | undefined {
    return this.instances.get(appId.toUpperCase())?.get(instanceId);
  }

  evictExpired(ttlMs: number): void {
    const now = Date.now();
    for (const [appId, instanceMap] of this.instances.entries()) {
      for (const [instanceId, inst] of instanceMap.entries()) {
        if (inst.lastUpdated !== undefined && now - inst.lastUpdated > ttlMs) {
          console.log(`[registry] Evicting expired instance ${instanceId} of ${appId}`);
          instanceMap.delete(instanceId);
        }
      }
      if (instanceMap.size === 0) {
        this.instances.delete(appId);
      }
    }
  }
}

export const registry = new Registry();

const TTL_MS = 90_000;
setInterval(() => registry.evictExpired(TTL_MS), 30_000);
