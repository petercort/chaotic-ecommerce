import express from 'express';
import productRoutes from './routes';
import { startEurekaClient } from './eureka';
import { requireServiceAuth } from './service-auth';

const app = express();
const PORT = parseInt(process.env['PORT'] ?? '8082', 10);

app.use(express.json());

app.get('/actuator/health', (_req, res) => {
  res.json({ status: 'UP' });
});

app.use('/api/products', requireServiceAuth, productRoutes);

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`inventory-service running on port ${PORT}`);
    startEurekaClient('inventory-service', PORT);
  });
}

export default app;
