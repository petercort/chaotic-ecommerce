import express from 'express';
import productRoutes from './routes';
import { startEurekaClient } from './eureka';
import { requireAuth } from './auth';

const app = express();
const PORT = parseInt(process.env['PORT'] ?? '8082', 10);

app.use(express.json({ limit: '10kb' }));

app.get('/actuator/health', (_req, res) => {
  res.json({ status: 'UP' });
});

app.use('/api', requireAuth);
app.use('/api/products', productRoutes);

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`inventory-service running on port ${PORT}`);
    startEurekaClient('inventory-service', PORT);
  });
}

export default app;
