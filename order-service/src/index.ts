import express from 'express';
import orderRouter from './routes.js';
import { startEurekaClient } from './eureka';

const app = express();

app.use(express.json());

app.get('/actuator/health', (_req, res) => {
  res.json({ status: 'UP' });
});

app.use('/api/orders', orderRouter);

const PORT = Number(process.env.PORT ?? 8083);

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`order-service listening on port ${PORT}`);
    startEurekaClient('order-service', PORT);
  });
}

export default app;
