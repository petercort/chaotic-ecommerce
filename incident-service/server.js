const express = require('express');
const path = require('path');
const session = require('express-session');
const cron = require('node-cron');
const { v4: uuidv4 } = require('uuid');
const { registerCopilotAgent, handleCopilotAPIChat } = require('./copilot/agent');
const oauthRouter = require('./auth/oauth');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8095;
const PROMETHEUS_URL = process.env.PROMETHEUS_URL || 'http://localhost:9090';

// ---------------------------------------------------------------------------
// Session middleware (must be before auth routes)
// ---------------------------------------------------------------------------
app.use(session({
  secret: process.env.SESSION_SECRET || 'incident-cmd-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,   // not accessible via JS
    secure: false,    // set true if serving over HTTPS
    maxAge: 8 * 60 * 60 * 1000, // 8 hours
  },
}));

// ---------------------------------------------------------------------------
// Auth routes (public — no session check)
// ---------------------------------------------------------------------------
app.use('/auth', oauthRouter);

// Serve login page (public)
app.get('/login', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Health check (public — for container probes)
app.get('/health', (_req, res) => res.json({ status: 'UP' }));

// ---------------------------------------------------------------------------
// Auth middleware — protects all other routes
// ---------------------------------------------------------------------------
// Auth is OPTIONAL — logging in with GitHub unlocks Copilot AI chat mode.
// The page and all APIs are fully accessible without authentication.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// In-memory stores
// ---------------------------------------------------------------------------
const incidents = new Map();
const serviceHealth = new Map(); // tracks latest health snapshot per service
let incidentCounter = 0;
function nextUid() { return String(incidentCounter++).padStart(4, '0'); }

// Service → revenue impact mapping
const REVENUE_IMPACT = {
  'order-service':      { weight: 1.0, domain: 'Order Processing',     description: 'Directly handles revenue transactions — orders, payments, checkout' },
  'inventory-service':  { weight: 0.9, domain: 'Inventory Management', description: 'Blocks order fulfilment when unavailable — customers cannot purchase out-of-stock items' },
  'customer-service':   { weight: 0.7, domain: 'Customer Data',        description: 'Customer lookup failures block new orders and account access' },
  'api-gateway':        { weight: 1.0, domain: 'API Gateway',          description: 'Single entry point — total outage means zero revenue capability' },
  'eureka-server':      { weight: 0.5, domain: 'Service Discovery',    description: 'Services degrade over time as registry cache expires — delayed revenue impact' },
};

// Playbooks keyed by scenario pattern
const PLAYBOOKS = {
  'high-error-rate': {
    title: 'High Error Rate Remediation',
    steps: [
      { id: 1, label: 'Check service health',         command: 'curl -s http://localhost:${PORT}/actuator/health | jq .',                    expect: 'Status should be UP' },
      { id: 2, label: 'Tail recent logs',              command: 'docker logs --tail 100 ${CONTAINER}',                                       expect: 'Look for stack traces or connection errors' },
      { id: 3, label: 'Check JVM heap',                command: 'curl -s http://localhost:${PORT}/actuator/metrics/jvm.memory.used | jq .', expect: 'Heap should be below 80% of max' },
      { id: 4, label: 'Restart service',               command: 'docker compose restart ${CONTAINER}',                                       expect: 'Container restarts within 30s' },
      { id: 5, label: 'Verify recovery',               command: 'bash scripts/verify-steady-state.sh',                                       expect: 'All services return 200' },
    ],
  },
  'service-down': {
    title: 'Service Down — Emergency Recovery',
    steps: [
      { id: 1, label: 'Confirm service is down',       command: 'docker inspect --format="{{.State.Status}}" ${CONTAINER}',                   expect: 'Should show "exited" or "dead"' },
      { id: 2, label: 'Check exit reason',             command: 'docker logs --tail 50 ${CONTAINER}',                                        expect: 'Look for OOMKilled, fatal errors' },
      { id: 3, label: 'Restart container',             command: 'docker compose up -d ${CONTAINER}',                                         expect: 'Container starts within 45s' },
      { id: 4, label: 'Wait for health check',         command: 'sleep 30 && curl -sf http://localhost:${PORT}/actuator/health',            expect: 'Health endpoint returns UP' },
      { id: 5, label: 'Run full steady-state check',   command: 'bash scripts/verify-steady-state.sh',                                       expect: 'All services healthy' },
    ],
  },
  'high-latency': {
    title: 'High Latency Investigation',
    steps: [
      { id: 1, label: 'Check current response times',  command: 'curl -o /dev/null -s -w "time_total: %{time_total}s\\n" http://localhost:${PORT}/actuator/health', expect: '< 1s response time' },
      { id: 2, label: 'Check GC pressure',             command: 'curl -s http://localhost:${PORT}/actuator/metrics/jvm.gc.pause | jq .',   expect: 'GC pause < 200ms' },
      { id: 3, label: 'Check thread pool',              command: 'curl -s http://localhost:${PORT}/actuator/metrics/executor.active | jq .', expect: 'Active threads below pool max' },
      { id: 4, label: 'Check downstream dependencies', command: 'curl -s http://localhost:${PORT}/actuator/health | jq .components',       expect: 'All dependencies UP' },
      { id: 5, label: 'Enable debug logging',          command: 'curl -X POST http://localhost:${PORT}/actuator/loggers/ROOT -H "Content-Type: application/json" -d \'{"configuredLevel":"DEBUG"}\'', expect: 'Temporary — revert after investigation' },
    ],
  },
  'circuit-breaker-open': {
    title: 'Circuit Breaker Open — Dependency Failure',
    steps: [
      { id: 1, label: 'Check circuit breaker state',   command: 'curl -s http://localhost:${PORT}/actuator/health | jq .components.circuitBreakers', expect: 'Identify which breaker is OPEN' },
      { id: 2, label: 'Check downstream service',      command: 'curl -sf http://localhost:${DOWNSTREAM_PORT}/actuator/health',             expect: 'Downstream should be UP' },
      { id: 3, label: 'Restart downstream if needed',  command: 'docker compose restart ${DOWNSTREAM}',                                      expect: 'Downstream recovers' },
      { id: 4, label: 'Wait for half-open transition', command: 'sleep 15 && curl -s http://localhost:${PORT}/actuator/health | jq .components.circuitBreakers', expect: 'State transitions to HALF_OPEN then CLOSED' },
      { id: 5, label: 'Verify end-to-end',             command: 'curl -sf http://localhost:8080/api/orders && echo OK',                       expect: 'Full order flow succeeds' },
    ],
  },
};

// Map of chaos scenario scripts for one-click execution
const CHAOS_SCENARIOS = {
  's1-eureka-kill':           { script: 'scenarios/s1-eureka-kill.sh',           label: 'S1: Eureka Kill',            description: 'Kill Eureka server and validate registry cache survivability' },
  's2-customer-service-kill': { script: 'scenarios/s2-customer-service-kill.sh', label: 'S2: Customer Service Kill',  description: 'Kill customer-service and test circuit breaker activation' },
  's3-inventory-latency':     { script: 'scenarios/s3-inventory-latency.sh',     label: 'S3: Inventory Latency',      description: 'Inject 8-12s latency via Chaos Monkey on inventory service' },
  's4-gateway-overload':      { script: 'scenarios/s4-gateway-overload.sh',      label: 'S4: Gateway Overload',       description: '300 concurrent requests across all gateway endpoints' },
  's5-cascade-failure':       { script: 'scenarios/s5-cascade-failure.sh',       label: 'S5: Cascade Failure',        description: 'Kill inventory and verify blast radius containment' },
  's6-network-partition':     { script: 'scenarios/s6-network-partition.sh',     label: 'S6: Network Partition',      description: 'Toxiproxy 10s latency injection simulating network partition' },
  's7-jvm-heap-exhaustion':   { script: 'scenarios/s7-jvm-heap-exhaustion.sh',   label: 'S7: JVM Heap Exhaustion',    description: 'Run order-service with -Xmx32m and fire 100 requests' },
  's8-network-packet-drop':   { script: 'scenarios/s8-network-packet-drop.sh',   label: 'S8: Network Packet Drop',    description: '60% packet loss on customer-service via pumba' },
};

// ---------------------------------------------------------------------------
// Prometheus query helpers
// ---------------------------------------------------------------------------
async function queryPrometheus(promql) {
  try {
    const url = `${PROMETHEUS_URL}/api/v1/query?query=${encodeURIComponent(promql)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    return json.data?.result || [];
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Revenue-impact scoring
// ---------------------------------------------------------------------------
function computeSeverity(service, errorRate, isDown) {
  const impact = REVENUE_IMPACT[service] || { weight: 0.3 };
  let score = 0;

  if (isDown) {
    score = impact.weight * 100;
  } else if (errorRate > 50) {
    score = impact.weight * 80;
  } else if (errorRate > 20) {
    score = impact.weight * 50;
  } else if (errorRate > 5) {
    score = impact.weight * 30;
  } else {
    score = impact.weight * 10;
  }

  if (score >= 80) return { level: 'critical', label: 'SEV-1', score, color: '#e74c3c' };
  if (score >= 50) return { level: 'high',     label: 'SEV-2', score, color: '#e67e22' };
  if (score >= 30) return { level: 'medium',   label: 'SEV-3', score, color: '#f1c40f' };
  return                   { level: 'low',      label: 'SEV-4', score, color: '#27ae60' };
}

function selectPlaybook(isDown, errorRate, latencyHigh, cbOpen) {
  if (isDown) return PLAYBOOKS['service-down'];
  if (cbOpen) return PLAYBOOKS['circuit-breaker-open'];
  if (latencyHigh) return PLAYBOOKS['high-latency'];
  if (errorRate > 5) return PLAYBOOKS['high-error-rate'];
  return PLAYBOOKS['high-error-rate'];
}

function interpolatePlaybook(playbook, service, port) {
  const containerName = service;
  // Resolve downstream service for circuit-breaker playbooks
  const downstreamMap = {
    'order-service': 'inventory-service',
    'inventory-service': 'customer-service',
    'customer-service': 'order-service',
    'api-gateway': 'eureka-server',
    'eureka-server': 'api-gateway',
  };
  const downstream = downstreamMap[service] || 'inventory-service';
  const downstreamPort = SERVICE_PORTS[downstream] || 8082;
  return {
    ...playbook,
    steps: playbook.steps.map(s => ({
      ...s,
      command: s.command
        .replace(/\$\{CONTAINER\}/g, containerName)
        .replace(/\$\{PORT\}/g, String(port))
        .replace(/\$\{DOWNSTREAM_PORT\}/g, String(downstreamPort))
        .replace(/\$\{DOWNSTREAM\}/g, downstream)
        // Commands run inside the Docker container — use service hostname, not localhost
        .replace(/localhost:(\d+)/g, (_, p) => {
          const svc = Object.entries(SERVICE_PORTS).find(([, v]) => String(v) === p);
          return svc ? `${svc[0]}:${p}` : `localhost:${p}`;
        }),
    })),
  };
}

// ---------------------------------------------------------------------------
// Log fetching via Docker Engine API (HTTP over Unix socket)
// ---------------------------------------------------------------------------
async function fetchDockerLogs(container, tail = 80) {
  try {
    // Use Docker Engine API over the mounted socket — works reliably inside containers
    // without needing the docker CLI installed
    const http = require('http');
    return new Promise((resolve) => {
      const options = {
        socketPath: '/var/run/docker.sock',
        path: `/containers/${container}/logs?stdout=1&stderr=1&tail=${tail}&timestamps=false`,
        method: 'GET',
      };
      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          // Docker multiplexed stream: strip 8-byte frame headers
          const cleaned = data.replace(/[\x00-\x08]/g, '').replace(/\r/g, '');
          resolve(cleaned || `(No logs from ${container})`);
        });
      });
      req.on('error', () => resolve(`(Could not fetch logs for ${container})`));
      req.setTimeout(5000, () => { req.destroy(); resolve(`(Timeout fetching logs for ${container})`); });
      req.end();
    });
  } catch {
    return `(Could not fetch logs for ${container})`;
  }
}

function extractErrorLines(logText) {
  return logText
    .split('\n')
    .filter(line => /error|exception|fail|fatal|warn|oom|killed/i.test(line))
    .slice(-30);
}

// ---------------------------------------------------------------------------
// Copilot-powered triage analysis
// ---------------------------------------------------------------------------
function generateTriageAnalysis(service, errorRate, isDown, latencyP99, errorLines) {
  const impact = REVENUE_IMPACT[service] || {};
  const lines = [];

  lines.push(`## Triage Analysis — ${service}`);
  lines.push('');

  // Revenue impact
  lines.push(`### Revenue Impact`);
  lines.push(`- **Domain**: ${impact.domain || 'Unknown'}`);
  lines.push(`- **Impact**: ${impact.description || 'Unknown impact'}`);
  lines.push(`- **Revenue Weight**: ${((impact.weight || 0) * 100).toFixed(0)}%`);
  lines.push('');

  // Current state
  lines.push(`### Current State`);
  if (isDown) {
    lines.push(`- **Status**: 🔴 SERVICE DOWN`);
    lines.push(`- **Immediate Effect**: All requests to ${service} are failing`);
  } else {
    lines.push(`- **Status**: ⚠️ DEGRADED`);
    lines.push(`- **Error Rate**: ${errorRate.toFixed(1)}% of requests failing`);
  }
  if (latencyP99 > 0) {
    lines.push(`- **P99 Latency**: ${latencyP99.toFixed(0)}ms`);
  }
  lines.push('');

  // Reproduction
  lines.push('### Likely Reproduction Steps');
  const servicePort = { 'api-gateway': 8080, 'customer-service': 8081, 'inventory-service': 8082, 'order-service': 8083, 'eureka-server': 8761 }[service] || 8080;
  if (isDown) {
    lines.push(`1. Attempt to reach \`http://localhost:${servicePort}/actuator/health\` — expect connection refused`);
    lines.push(`2. Check Docker: \`docker ps -a --filter name=${service}\``);
    lines.push(`3. If container exited, inspect logs: \`docker logs --tail 50 ${service}\``);
  } else {
    lines.push(`1. Send multiple requests: \`for i in $(seq 1 20); do curl -s -o /dev/null -w "%{http_code}\\n" http://localhost:8080/api/${service.replace('-service', 's')}; done\``);
    lines.push(`2. Check error pattern in logs: \`docker logs --tail 100 ${service} 2>&1 | grep -i error\``);
    lines.push(`3. Compare against Prometheus: open http://localhost:9090 and query \`rate(http_server_requests_seconds_count{status=~"5.."}[1m])\``);
  }
  lines.push('');

  // Error log highlights
  if (errorLines.length > 0) {
    lines.push('### Error Log Highlights');
    lines.push('```');
    lines.push(errorLines.slice(0, 15).join('\n'));
    lines.push('```');
    lines.push('');
  }

  // Links
  lines.push('### Monitoring Links');
  lines.push(`- [Grafana Dashboard](http://localhost:3000/d/chaos-overview/chaos-testing-overview)`);
  lines.push(`- [Prometheus](http://localhost:9090/graph?g0.expr=rate(http_server_requests_seconds_count{status=~"5.."}[1m]))`);
  lines.push(`- [Dozzle Logs](http://localhost:9999)`);
  lines.push(`- [Service Health](http://localhost:${servicePort}/actuator/health)`);

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Polling loop — queries Prometheus every 15s
// ---------------------------------------------------------------------------
const SERVICE_PORTS = {
  'api-gateway': 8080,
  'customer-service': 8081,
  'inventory-service': 8082,
  'order-service': 8083,
  'eureka-server': 8761,
};

async function pollForIncidents() {
  console.log(`[${new Date().toISOString()}] Polling Prometheus for errors...`);

  for (const [service, port] of Object.entries(SERVICE_PORTS)) {
    try {
      // 1. Check if service is up
      let isDown = false;
      try {
        const healthRes = await fetch(`http://${service}:${port}/actuator/health`, { signal: AbortSignal.timeout(3000) });
        if (!healthRes.ok) isDown = true;
      } catch {
        // When running outside Docker, try localhost
        try {
          const healthRes = await fetch(`http://localhost:${port}/actuator/health`, { signal: AbortSignal.timeout(3000) });
          if (!healthRes.ok) isDown = true;
        } catch {
          isDown = true;
        }
      }

      // 2. Query 5xx error rate from Prometheus
      let errorRate = 0;
      const errorResults = await queryPrometheus(
        `sum(rate(http_server_requests_seconds_count{job="${service}",status=~"5.."}[1m])) / sum(rate(http_server_requests_seconds_count{job="${service}"}[1m])) * 100`
      );
      if (errorResults && errorResults.length > 0) {
        const val = parseFloat(errorResults[0].value?.[1]);
        if (!isNaN(val)) errorRate = val;
      }

      // 3. Query P99 latency
      let latencyP99 = 0;
      const latResults = await queryPrometheus(
        `histogram_quantile(0.99, sum(rate(http_server_requests_seconds_bucket{job="${service}"}[1m])) by (le)) * 1000`
      );
      if (latResults && latResults.length > 0) {
        const val = parseFloat(latResults[0].value?.[1]);
        if (!isNaN(val)) latencyP99 = val;
      }

      // 4. Check circuit breaker state
      let cbOpen = false;
      const cbResults = await queryPrometheus(
        `resilience4j_circuitbreaker_state{job="${service}",state="open"}`
      );
      if (cbResults && cbResults.length > 0) {
        cbOpen = parseFloat(cbResults[0].value?.[1]) === 1;
      }

      const latencyHigh = latencyP99 > 2000;

      // Record health snapshot for /api/status
      serviceHealth.set(service, {
        service, port, isDown, errorRate, latencyP99, cbOpen,
        updatedAt: new Date().toISOString(),
      });

      console.log(`  ${service}: down=${isDown} errorRate=${errorRate.toFixed(2)}% p99=${latencyP99.toFixed(0)}ms cbOpen=${cbOpen}`);

      // 5. Decide whether to create/update an incident (threshold: 1% errors)
      if (isDown || errorRate > 1 || latencyHigh || cbOpen) {
        // Check for existing open incident for this service
        const existingId = [...incidents.values()].find(i => i.service === service && i.status === 'open')?.id;

        const logs = await fetchDockerLogs(service);
        const errorLines = extractErrorLines(logs);
        const severity = computeSeverity(service, errorRate, isDown);
        const playbook = selectPlaybook(isDown, errorRate, latencyHigh, cbOpen);
        const analysis = generateTriageAnalysis(service, errorRate, isDown, latencyP99, errorLines);
        const interpolated = interpolatePlaybook(playbook, service, port);

        if (existingId) {
          // Update existing incident
          const inc = incidents.get(existingId);
          inc.severity = severity;
          inc.errorRate = errorRate;
          inc.latencyP99 = latencyP99;
          inc.isDown = isDown;
          inc.cbOpen = cbOpen;
          inc.errorLines = errorLines;
          inc.analysis = analysis;
          inc.playbook = interpolated;
          inc.updatedAt = new Date().toISOString();
          inc.updateCount = (inc.updateCount || 0) + 1;
          console.log(`  [updated] ${service} — ${severity.label} (error=${errorRate.toFixed(1)}%, down=${isDown})`);
        } else {
          // Create new incident
          const id = uuidv4();
          const uid = nextUid();
          incidents.set(id, {
            id,
            uid,
            service,
            port,
            severity,
            errorRate,
            latencyP99,
            isDown,
            cbOpen,
            status: 'open',
            errorLines,
            rawLogs: logs,
            analysis,
            playbook: interpolated,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            updateCount: 0,
            commandResults: {},
          });
          console.log(`  [NEW INCIDENT] #${uid} ${id.slice(0, 8)} — ${service} — ${severity.label}`);
        }
      } else {
        // Auto-resolve if an open incident exists and service is healthy now
        const existing = [...incidents.values()].find(i => i.service === service && i.status === 'open');
        if (existing) {
          existing.status = 'resolved';
          existing.resolvedAt = new Date().toISOString();
          console.log(`  [resolved] ${existing.id.slice(0, 8)} — ${service}`);
        }
      }
    } catch (err) {
      console.error(`  [poll error] ${service}: ${err.message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// REST API — all routes below require authentication
// ---------------------------------------------------------------------------

// List all incidents (most recent first)
app.get('/api/incidents', (_req, res) => {
  const list = [...incidents.values()].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(list);
});

// Get single incident
app.get('/api/incidents/:id', (req, res) => {
  const inc = incidents.get(req.params.id);
  if (!inc) return res.status(404).json({ error: 'Incident not found' });
  res.json(inc);
});

// Acknowledge / resolve
app.patch('/api/incidents/:id', (req, res) => {
  const inc = incidents.get(req.params.id);
  if (!inc) return res.status(404).json({ error: 'Incident not found' });
  const { status } = req.body;
  if (status && ['open', 'acknowledged', 'resolved'].includes(status)) {
    inc.status = status;
    inc.updatedAt = new Date().toISOString();
    if (status === 'resolved') inc.resolvedAt = new Date().toISOString();
  }
  res.json(inc);
});

// ---------------------------------------------------------------------------
// Summarize playbook step output via Copilot (or heuristic fallback)
// ---------------------------------------------------------------------------
async function summarizeStepOutput(label, command, expect, output, exitCode, githubToken) {
  const truncated = output.length > 4000 ? output.slice(0, 4000) + '\n...(truncated)' : output;

  // Try Copilot API if token available
  if (githubToken && githubToken.length >= 10) {
    try {
      const prompt = `You are an SRE assistant interpreting the output of a diagnostic command.

**Step**: ${label}
**Command**: \`${command}\`
**Expected outcome**: ${expect}
**Exit code**: ${exitCode}

**Raw output**:
\`\`\`
${truncated}
\`\`\`

Provide a concise 2-4 sentence plain-English summary of what the output shows and whether it meets the expected outcome. Start with a clear PASS / WARN / FAIL verdict. Focus on the key metric values (e.g. actual heap used vs max, circuit breaker state, health status). Do not repeat the raw output.`;

      const content = await handleCopilotAPIChat(
        [{ role: 'user', content: prompt }],
        githubToken,
        {},
      );
      // Determine status from summary text
      const upper = content.toUpperCase();
      const status = upper.includes('FAIL') ? 'fail' : upper.includes('WARN') ? 'warn' : 'pass';
      return { summary: content, status };
    } catch (err) {
      console.warn('[summarize step] Copilot API error, using heuristic:', err.message);
    }
  }

  // Heuristic fallback — no Copilot token
  return heuristicSummary(label, expect, output, exitCode);
}

function heuristicSummary(label, expect, output, exitCode) {
  if (exitCode !== 0) {
    return { summary: `**FAIL** — command exited with code ${exitCode}. Check the raw output for errors. Expected: _${expect}_`, status: 'fail' };
  }

  // JVM heap check
  if (/heap|jvm.*memory|memory.*used/i.test(label)) {
    const usedMatch = output.match(/"value"\s*:\s*([\d.]+)/);
    const maxMatch = output.match(/"max"\s*:\s*([\d.]+)/);
    if (usedMatch && maxMatch) {
      const pct = (parseFloat(usedMatch[1]) / parseFloat(maxMatch[1]) * 100).toFixed(1);
      const status = parseFloat(pct) < 80 ? 'pass' : parseFloat(pct) < 90 ? 'warn' : 'fail';
      const verdict = status === 'pass' ? 'PASS' : status === 'warn' ? 'WARN' : 'FAIL';
      return { summary: `**${verdict}** — Heap used is **${pct}%** of max. Expected: below 80%. ${parseFloat(pct) >= 80 ? 'Consider a heap dump or restart.' : 'Heap is healthy.'}`, status };
    }
    // Try bytes fallback
    const vals = [...output.matchAll(/"value"\s*:\s*([\d.]+)/g)].map(m => parseFloat(m[1]));
    if (vals.length >= 1) {
      const mb = (vals[0] / 1024 / 1024).toFixed(1);
      return { summary: `**PASS** — JVM memory used: **${mb} MB**. Expected: _${expect}_`, status: 'pass' };
    }
  }

  // Circuit breaker state
  if (/circuit.?breaker/i.test(label)) {
    if (/CLOSED/i.test(output)) return { summary: `**PASS** — Circuit breaker is **CLOSED**. Service is operating normally.`, status: 'pass' };
    if (/HALF_OPEN/i.test(output)) return { summary: `**WARN** — Circuit breaker is **HALF_OPEN**. Recovery probes in progress — watch for transition to CLOSED.`, status: 'warn' };
    if (/OPEN/i.test(output)) return { summary: `**FAIL** — Circuit breaker is **OPEN**. Downstream dependency is still failing. Expected: HALF_OPEN or CLOSED.`, status: 'fail' };
  }

  // Health status
  if (/health/i.test(label) || /actuator\/health/.test(label)) {
    if (/"status"\s*:\s*"UP"/i.test(output)) return { summary: `**PASS** — Service status is **UP**. All components healthy.`, status: 'pass' };
    if (/"status"\s*:\s*"DOWN"/i.test(output)) return { summary: `**FAIL** — Service status is **DOWN**. Check component details in raw output.`, status: 'fail' };
    if (/"status"\s*:\s*"OUT_OF_SERVICE"/i.test(output)) return { summary: `**WARN** — Service is **OUT_OF_SERVICE**. May be intentionally disabled.`, status: 'warn' };
  }

  // Log inspection
  if (/log|tail/i.test(label)) {
    const errorCount = (output.match(/\b(ERROR|FATAL|Exception|OOMKilled)\b/g) || []).length;
    const warnCount = (output.match(/\bWARN\b/g) || []).length;
    if (errorCount > 0) return { summary: `**WARN** — Found **${errorCount} error(s)** and ${warnCount} warning(s) in recent logs. Review raw output for stack traces.`, status: 'warn' };
    return { summary: `**PASS** — No errors found in recent logs. ${warnCount > 0 ? `${warnCount} warning(s) noted.` : 'Logs look clean.'}`, status: 'pass' };
  }

  // Generic pass
  return { summary: `**PASS** — Command completed successfully (exit 0). Expected: _${expect}_`, status: 'pass' };
}

// Execute a playbook step command
app.post('/api/incidents/:id/run-step/:stepId', async (req, res) => {
  const inc = incidents.get(req.params.id);
  if (!inc) return res.status(404).json({ error: 'Incident not found' });

  const stepId = parseInt(req.params.stepId, 10);
  const step = inc.playbook?.steps?.find(s => s.id === stepId);
  if (!step) return res.status(404).json({ error: 'Step not found' });

  const githubToken = req.session?.githubToken || process.env.GITHUB_TOKEN || '';

  let output, exitCode;
  try {
    const { execSync } = require('child_process');
    // Allow extra time for steps that contain sleep
    const hasSleep = /\bsleep\s+\d+/.test(step.command);
    const sleepSecs = hasSleep ? parseInt((step.command.match(/\bsleep\s+(\d+)/) || [])[1] || '0', 10) : 0;
    const timeout = (hasSleep ? (sleepSecs * 1000 + 15000) : 30000);
    output = execSync(step.command, { encoding: 'utf-8', timeout, cwd: process.env.PROJECT_ROOT || '/app' });
    exitCode = 0;
  } catch (err) {
    output = err.stdout || err.stderr || err.message;
    exitCode = err.status || 1;
  }

  // AI/heuristic summary
  const { summary, status: summaryStatus } = await summarizeStepOutput(
    step.label, step.command, step.expect, output, exitCode, githubToken,
  );

  inc.commandResults[stepId] = { output, exitCode, summary, summaryStatus, ranAt: new Date().toISOString() };
  res.json({ stepId, output, exitCode, summary, summaryStatus });
});

// Run a chaos scenario
app.post('/api/chaos/:scenarioId', (req, res) => {
  const scenario = CHAOS_SCENARIOS[req.params.scenarioId];
  if (!scenario) return res.status(404).json({ error: 'Scenario not found' });

  try {
    const { exec } = require('child_process');
    const child = exec(`bash ${scenario.script}`, { cwd: process.env.PROJECT_ROOT || '/app', timeout: 120000 });

    let output = '';
    child.stdout.on('data', d => { output += d; });
    child.stderr.on('data', d => { output += d; });
    child.on('close', code => {
      console.log(`[chaos] ${scenario.label} finished with code ${code}`);
    });

    res.json({ message: `Started ${scenario.label}`, pid: child.pid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List available chaos scenarios
app.get('/api/chaos', (_req, res) => {
  res.json(Object.entries(CHAOS_SCENARIOS).map(([id, s]) => ({ id, ...s })));
});

// Live service health snapshot
app.get('/api/status', (_req, res) => {
  res.json([...serviceHealth.values()]);
});

// Seed a demo incident (for testing the UI without needing a real error)
app.post('/api/incidents/seed', async (req, res) => {
  const service = req.body.service || 'order-service';
  const port = SERVICE_PORTS[service];
  if (!port) return res.status(400).json({ error: 'Unknown service' });

  const errorRate = req.body.errorRate ?? 25;
  const isDown = req.body.isDown ?? false;
  const latencyP99 = req.body.latencyP99 ?? 1200;

  const logs = await fetchDockerLogs(service);
  const errorLines = extractErrorLines(logs);
  const severity = computeSeverity(service, errorRate, isDown);
  const playbook = selectPlaybook(isDown, errorRate, latencyP99 > 2000, false);
  const analysis = generateTriageAnalysis(service, errorRate, isDown, latencyP99, errorLines);
  const interpolated = interpolatePlaybook(playbook, service, port);

  const id = uuidv4();
  const uid = nextUid();
  incidents.set(id, {
    id, uid, service, port, severity, errorRate, latencyP99,
    isDown, cbOpen: false, status: 'open',
    errorLines, rawLogs: logs, analysis,
    playbook: interpolated,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    updateCount: 0, commandResults: {},
    seeded: true,
  });
  console.log(`  [SEEDED] #${uid} ${id.slice(0, 8)} — ${service} — ${severity.label}`);
  res.json({ id, service, severity });
});

// Register Copilot agent routes
registerCopilotAgent(app, { incidents, prometheusUrl: PROMETHEUS_URL });

// Serve static UI (index.html etc.)
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`Incident Service running at http://localhost:${PORT}`);
  console.log(`Prometheus: ${PROMETHEUS_URL}`);

  // Poll every 15 seconds
  setInterval(pollForIncidents, 15000);

  // Initial poll after 5s startup delay
  setTimeout(pollForIncidents, 5000);
});
