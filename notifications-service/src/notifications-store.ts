import { z } from 'zod';

export const createNotificationSchema = z.object({
  channel: z.enum(['email', 'sms', 'webhook']),
  to: z.string().min(1).max(320),
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(5000),
}).superRefine((data, ctx) => {
  if (data.channel === 'email') {
    // Simple email regex for demo purposes
    const emailRegex = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
    if (!emailRegex.test(data.to)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'to must be a valid email when channel is email',
        path: ['to'],
      });
    }
  }
});

export type NotificationChannel = z.infer<typeof createNotificationSchema>['channel'];

export type StoredNotification = {
  id: string;
  channel: NotificationChannel;
  to: string;
  subject: string;
  body: string;
  status: 'sent';
};

const notifications: StoredNotification[] = [];

export function addNotification(n: StoredNotification) {
  notifications.push(n);
}

export function listNotifications() {
  return notifications;
}

export function resetStore() {
  notifications.length = 0;
}
