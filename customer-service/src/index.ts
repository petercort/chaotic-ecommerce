import express from "express";
import customerRoutes from "./routes";
import { startEurekaClient } from "./eureka";

const app = express();
const PORT = process.env.PORT ?? 8081;

app.use(express.json());

app.get("/actuator/health", (_req, res) => {
  res.json({ status: "UP" });
});

app.use("/api/customers", customerRoutes);

app.listen(PORT, () => {
  console.log(`customer-service listening on port ${PORT}`);
  startEurekaClient('customer-service', Number(PORT));
});
