import express from 'express';
import { startEurekaClient } from './eureka.js';
import authRoutes from './routes.js';
import { runMigrations } from './db.js';

export const app = express();
const PORT = parseInt(process.env.PORT ?? '8085', 10);

app.use(express.json({ limit: '10kb' }));

app.get('/actuator/health', (_req, res) => {
  res.json({ status: 'UP' });
});

app.use('/auth', authRoutes);

async function start(): Promise<void> {
  await runMigrations();
  app.listen(PORT, () => {
    console.log(`auth-service listening on port ${PORT}`);
    startEurekaClient('auth-service', PORT);
  });
}

if (process.env.NODE_ENV !== 'test') {
  start().catch((err) => {
    console.error('Failed to start auth-service:', err);
    process.exit(1);
  });
}