import express from "express";
import customerRoutes from "./routes";
import { startEurekaClient } from "./eureka";
import { connectWithRetry, runMigrations, seedDefaultCustomers, isDbHealthy } from "./db";
import { requireAuth } from "./auth";

const app = express();
const PORT = process.env.PORT ?? 8081;

app.use(express.json({ limit: '10kb' }));

app.get("/actuator/health", async (_req, res) => {
  const healthy = await isDbHealthy();
  if (healthy) {
    res.json({ status: "UP", db: "connected" });
  } else {
    res.status(503).json({ status: "DOWN", db: "disconnected" });
  }
});

app.use('/api', requireAuth);
app.use("/api/customers", customerRoutes);

async function start() {
  await connectWithRetry();
  await runMigrations();
  await seedDefaultCustomers();
  app.listen(PORT, () => {
    console.log(`customer-service listening on port ${PORT}`);
    startEurekaClient("customer-service", Number(PORT));
  });
}

if (process.env.NODE_ENV !== "test") {
  start().catch((err) => {
    console.error("Failed to start customer-service:", err);
    process.exit(1);
  });
}

export { app };
