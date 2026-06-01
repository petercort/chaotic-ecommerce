import express, { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { startEurekaClient } from './eureka.js';
import {
  createNotificationSchema,
  addNotification,
  listNotifications,
  resetStore,
  StoredNotification
} from './notifications-store.js';

export const app = express();
const PORT = parseInt(process.env.PORT ?? '8084', 10);

app.use(express.json({ limit: '10kb' }));

app.post('/api/notifications', (req: Request, res: Response) => {
  const result = createNotificationSchema.safeParse(req.body);
  if (!result.success) {
    console.warn('[notifications-service] Rejected invalid notification payload');
    res.status(400).json({ errors: result.error.errors });
    return;
  }

  const notification: StoredNotification = {
    id: randomUUID(),
    ...result.data,
    status: 'sent',
  };
  addNotification(notification);
  res.status(201).json({ id: notification.id, status: notification.status });
});

app.get('/api/notifications', (_req: Request, res: Response) => {
  res.json(listNotifications());
});

app.get('/actuator/health', (_req: Request, res: Response) => {
  res.json({ status: 'UP' });
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`notifications-service listening on port ${PORT}`);
    startEurekaClient('notifications-service', PORT);
  });
}

export { resetStore };
