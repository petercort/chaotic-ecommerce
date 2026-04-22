import { Router, Request, Response } from 'express';
import { registry, InstanceInfo } from './registry';

const router = Router();

router.post('/:appId', (req: Request, res: Response): void => {
  const { appId } = req.params;
  const instance: InstanceInfo = req.body.instance ?? req.body;
  instance.app = appId.toUpperCase();
  instance.lastUpdated = Date.now();
  instance.status = instance.status || 'UP';
  registry.register(appId, instance);
  res.status(204).send();
});

router.put('/:appId/:instanceId', (req: Request, res: Response): void => {
  const { appId, instanceId } = req.params;
  const renewed = registry.renew(appId, instanceId);
  res.status(renewed ? 200 : 404).send();
});

router.delete('/:appId/:instanceId', (req: Request, res: Response): void => {
  const { appId, instanceId } = req.params;
  registry.deregister(appId, instanceId);
  res.status(200).send();
});

router.get('/', (_req: Request, res: Response): void => {
  const allApps = registry.getAllApps();
  const totalUp = allApps.reduce((n, a) => n + a.instance.length, 0);
  res.setHeader('Content-Type', 'application/json');
  res.json({
    applications: {
      versions__delta: 1,
      apps__hashcode: `UP_${totalUp}_`,
      application: allApps,
    },
  });
});

router.get('/:appId', (req: Request, res: Response): void => {
  const { appId } = req.params;
  const instances = registry.getApp(appId);
  if (instances.length === 0) {
    res.status(404).send();
    return;
  }
  res.json({ application: { name: appId.toUpperCase(), instance: instances } });
});

router.get('/:appId/:instanceId', (req: Request, res: Response): void => {
  const { appId, instanceId } = req.params;
  const instance = registry.getInstance(appId, instanceId);
  if (!instance) {
    res.status(404).send();
    return;
  }
  res.json({ instance });
});

router.put('/:appId/:instanceId/status', (req: Request, res: Response): void => {
  const { appId, instanceId } = req.params;
  const value = req.query['value'] as string;
  const instance = registry.getInstance(appId, instanceId);
  if (!instance) {
    res.status(404).send();
    return;
  }
  instance.status = value;
  res.status(200).send();
});

export default router;
