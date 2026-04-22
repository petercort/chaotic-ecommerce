import express from 'express';
import { registry } from './registry';
import eurekaRoutes from './routes';

const app = express();
const PORT = parseInt(process.env.PORT ?? '8761', 10);

app.use(express.json());

app.use('/eureka/apps', eurekaRoutes);
app.use('/eureka/v2/apps', eurekaRoutes);

app.get('/actuator/health', (_req, res) => {
  const allApps = registry.getAllApps();
  const totalInstances = allApps.reduce((n, a) => n + a.instance.length, 0);
  res.json({ status: 'UP', registeredServices: allApps.length, totalInstances });
});

app.get('/', (_req, res) => {
  const allApps = registry.getAllApps();
  const rows = allApps.flatMap(a =>
    a.instance.map(inst => `<tr><td>${inst.app}</td><td>${inst.instanceId}</td><td>${inst.status}</td><td>${inst.hostName}:${inst.port.$}</td></tr>`)
  ).join('') || '<tr><td colspan="4" style="color:#888;text-align:center">No services registered</td></tr>';
  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html><html><head><title>Eureka Server</title>
  <style>body{font-family:Arial,sans-serif;background:#f5f5f5;padding:24px}
  h1{color:#2c3e50}table{border-collapse:collapse;width:100%;background:white;box-shadow:0 1px 4px rgba(0,0,0,.1);border-radius:6px;overflow:hidden}
  th{background:#2c3e50;color:white;padding:10px 14px;text-align:left}td{padding:10px 14px;border-bottom:1px solid #eee}
  .up{color:#27ae60;font-weight:bold}.down{color:#e74c3c;font-weight:bold}</style></head>
  <body><h1>🔍 Eureka Service Registry</h1>
  <p>Registered instances: <strong>${allApps.reduce((n,a)=>n+a.instance.length,0)}</strong></p>
  <table><thead><tr><th>App</th><th>Instance ID</th><th>Status</th><th>Host</th></tr></thead>
  <tbody>${rows}</tbody></table>
  <p style="color:#888;font-size:0.85rem;margin-top:16px">Auto-refreshes every 30s — <a href="/actuator/health">/actuator/health</a></p>
  <script>setTimeout(()=>location.reload(),30000)</script>
  </body></html>`);
});

app.listen(PORT, () => {
  console.log(`eureka-server listening on port ${PORT}`);
});
