// ---------------------------------------------------------------------------
// Copilot Agent — tool execution handlers
// ---------------------------------------------------------------------------
// Each handler receives parsed arguments and the shared app context (incidents,
// prometheus URL, service ports) and returns a string result for the LLM.
// ---------------------------------------------------------------------------

const { execSync } = require('child_process');
const http = require('http');

const SERVICE_PORTS = {
  'api-gateway': 8080,
  'customer-service': 8081,
  'inventory-service': 8082,
  'order-service': 8083,
  'eureka-server': 8761,
};

const REVENUE_IMPACT = {
  'order-service':      { weight: 1.0, domain: 'Order Processing',     description: 'Directly handles revenue transactions — orders, payments, checkout' },
  'inventory-service':  { weight: 0.9, domain: 'Inventory Management', description: 'Blocks order fulfilment when unavailable — customers cannot purchase out-of-stock items' },
  'customer-service':   { weight: 0.7, domain: 'Customer Data',        description: 'Customer lookup failures block new orders and account access' },
  'api-gateway':        { weight: 1.0, domain: 'API Gateway',          description: 'Single entry point — total outage means zero revenue capability' },
  'eureka-server':      { weight: 0.5, domain: 'Service Discovery',    description: 'Services degrade over time as registry cache expires — delayed revenue impact' },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function queryPrometheus(promql, prometheusUrl) {
  try {
    const url = `${prometheusUrl}/api/v1/query?query=${encodeURIComponent(promql)}`;
    const res = await fetch(url);
    if (!res.ok) return { error: `Prometheus returned ${res.status}` };
    const json = await res.json();
    return json.data?.result || [];
  } catch (err) {
    return { error: err.message };
  }
}

function fetchDockerLogs(container, tail = 100) {
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
        const cleaned = data.replace(/[\x00-\x08]/g, '').replace(/\r/g, '');
        resolve(cleaned || `(No logs from ${container})`);
      });
    });
    req.on('error', () => resolve(`(Could not fetch logs for ${container})`));
    req.setTimeout(5000, () => { req.destroy(); resolve(`(Timeout fetching logs for ${container})`); });
    req.end();
  });
}

function runCommand(cmd, timeoutMs = 15000) {
  try {
    const output = execSync(cmd, {
      encoding: 'utf-8',
      timeout: timeoutMs,
      cwd: process.env.PROJECT_ROOT || '/app',
    });
    return { output: output.trim(), exitCode: 0 };
  } catch (err) {
    return {
      output: (err.stdout || err.stderr || err.message || '').trim(),
      exitCode: err.status || 1,
    };
  }
}

// ---------------------------------------------------------------------------
// Allowed command patterns for security
// ---------------------------------------------------------------------------
const ALLOWED_COMMAND_PATTERNS = [
  /^docker\s+(ps|logs|stats|inspect|compose)/,
  /^curl\s/,
  /^cat\s/,
  /^ls\s/,
  /^grep\s/,
  /^head\s/,
  /^tail\s/,
  /^wc\s/,
  /^bash\s+scripts\//,
  /^bash\s+scenarios\//,
  /^jq\s/,
  /^echo\s/,
  /^df\s/,
  /^free\s/,
  /^top\s+-bn1/,
  /^uptime/,
  /^hostname/,
  /^netstat\s/,
  /^ss\s/,
];

function isCommandAllowed(cmd) {
  return ALLOWED_COMMAND_PATTERNS.some(pattern => pattern.test(cmd.trim()));
}

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------
const handlers = {
  list_incidents(args, ctx) {
    let list = [...ctx.incidents.values()]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    if (args.status !== 'all') {
      list = list.filter(i => i.status === args.status);
    }

    if (list.length === 0) {
      return `No ${args.status === 'all' ? '' : args.status + ' '}incidents found. All systems appear healthy.`;
    }

    const rows = list.map(i =>
      `• [${i.severity.label}] ${i.service} — ${i.isDown ? 'DOWN' : `error=${i.errorRate.toFixed(1)}%`} ` +
      `| latency=${i.latencyP99.toFixed(0)}ms | revenue_score=${i.severity.score.toFixed(0)} | status=${i.status} | id=${i.id.slice(0, 8)}`
    );
    return `Found ${list.length} incident(s):\n${rows.join('\n')}`;
  },

  get_incident_details(args, ctx) {
    const inc = [...ctx.incidents.values()]
      .filter(i => i.service === args.service)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];

    if (!inc) return `No incidents found for service "${args.service}".`;

    return [
      `# Incident: ${inc.service} [${inc.severity.label}]`,
      `Status: ${inc.status} | Created: ${inc.createdAt} | Updates: ${inc.updateCount}`,
      `Error Rate: ${inc.errorRate.toFixed(1)}% | P99 Latency: ${inc.latencyP99.toFixed(0)}ms | Down: ${inc.isDown} | CB Open: ${inc.cbOpen}`,
      `Revenue Impact Score: ${inc.severity.score.toFixed(0)}/100`,
      '',
      inc.analysis,
      '',
      `## Playbook: ${inc.playbook?.title}`,
      ...(inc.playbook?.steps || []).map(s =>
        `  Step ${s.id}: ${s.label}\n    Command: ${s.command}\n    Expected: ${s.expect}`
      ),
      '',
      `## Error Log Highlights (${inc.errorLines?.length || 0} lines)`,
      ...(inc.errorLines || []).slice(0, 10),
    ].join('\n');
  },

  async query_prometheus(args, ctx) {
    const results = await queryPrometheus(args.promql, ctx.prometheusUrl);
    if (results.error) return `Prometheus query error: ${results.error}`;
    if (results.length === 0) return `Query returned no results.\nPromQL: ${args.promql}`;

    const formatted = results.map(r => {
      const labels = Object.entries(r.metric || {}).map(([k, v]) => `${k}="${v}"`).join(', ');
      const value = r.value?.[1] || 'N/A';
      return `  {${labels}} => ${value}`;
    });
    return `PromQL: ${args.promql}\nResults (${results.length}):\n${formatted.join('\n')}`;
  },

  async check_service_health(args) {
    const port = SERVICE_PORTS[args.service];
    if (!port) return `Unknown service: ${args.service}`;

    // Try Docker hostname first (inside Docker network), then localhost
    for (const host of [args.service, 'localhost']) {
      try {
        const res = await fetch(`http://${host}:${port}/actuator/health`, {
          signal: AbortSignal.timeout(3000),
        });
        const body = await res.json();
        return `Service: ${args.service} (port ${port}, via ${host})\nHTTP ${res.status}\n${JSON.stringify(body, null, 2)}`;
      } catch {
        continue;
      }
    }
    return `Service: ${args.service} (port ${port})\nStatus: UNREACHABLE`;
  },

  async get_service_logs(args) {
    const tail = args.tail || 100;
    const output = await fetchDockerLogs(args.service, tail);

    if (args.errors_only) {
      const errorLines = output.split('\n')
        .filter(l => /error|exception|fail|fatal|warn|oom|killed/i.test(l));
      return errorLines.length > 0
        ? `Error lines from ${args.service} (${errorLines.length}):\n${errorLines.slice(-30).join('\n')}`
        : `No error lines found in the last ${tail} log lines of ${args.service}.`;
    }

    return `Logs from ${args.service} (last ${args.tail || 100} lines):\n${output}`;
  },

  run_diagnostic_command(args) {
    if (!isCommandAllowed(args.command)) {
      return `Command not allowed for security reasons. Permitted: docker, curl, cat, ls, grep, head, tail, bash scripts/*, bash scenarios/*, jq, echo, df, free, top, uptime, hostname, netstat, ss`;
    }

    const timeout = (args.timeout_seconds || 15) * 1000;
    const { output, exitCode } = runCommand(args.command, timeout);
    return `$ ${args.command}\nExit code: ${exitCode}\n${output}`;
  },

  async get_service_metrics(args, ctx) {
    const service = args.service;
    const port = SERVICE_PORTS[service];
    if (!port) return `Unknown service: ${service}`;

    const queries = {
      error_rate: `sum(rate(http_server_requests_seconds_count{job="${service}",status=~"5.."}[5m])) / sum(rate(http_server_requests_seconds_count{job="${service}"}[5m])) * 100`,
      p99_latency_ms: `histogram_quantile(0.99, sum(rate(http_server_requests_seconds_bucket{job="${service}"}[5m])) by (le)) * 1000`,
      p50_latency_ms: `histogram_quantile(0.50, sum(rate(http_server_requests_seconds_bucket{job="${service}"}[5m])) by (le)) * 1000`,
      request_rate: `sum(rate(http_server_requests_seconds_count{job="${service}"}[5m]))`,
      jvm_heap_used_bytes: `jvm_memory_used_bytes{job="${service}",area="heap"}`,
      jvm_heap_max_bytes: `jvm_memory_max_bytes{job="${service}",area="heap"}`,
      gc_pause_seconds: `rate(jvm_gc_pause_seconds_sum{job="${service}"}[5m])`,
      threads_live: `jvm_threads_live_threads{job="${service}"}`,
      cb_state: `resilience4j_circuitbreaker_state{job="${service}"}`,
    };

    const results = {};
    for (const [name, promql] of Object.entries(queries)) {
      const r = await queryPrometheus(promql, ctx.prometheusUrl);
      if (r.error) {
        results[name] = `error: ${r.error}`;
      } else if (r.length > 0) {
        results[name] = r.map(item => {
          const labels = Object.entries(item.metric || {})
            .filter(([k]) => !['__name__', 'job', 'instance'].includes(k))
            .map(([k, v]) => `${k}=${v}`)
            .join(', ');
          return labels ? `${item.value?.[1]} (${labels})` : item.value?.[1];
        }).join('; ');
      } else {
        results[name] = 'no data';
      }
    }

    const lines = [`# Metrics Snapshot: ${service} (port ${port})`, ''];
    for (const [name, val] of Object.entries(results)) {
      lines.push(`  ${name}: ${val}`);
    }
    return lines.join('\n');
  },

  run_playbook_step(args, ctx) {
    const inc = [...ctx.incidents.values()]
      .filter(i => i.service === args.service && i.status !== 'resolved')
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];

    if (!inc) return `No active incident found for service "${args.service}".`;

    const step = inc.playbook?.steps?.find(s => s.id === args.step_number);
    if (!step) return `Step ${args.step_number} not found in playbook. Available steps: ${inc.playbook?.steps?.map(s => s.id).join(', ')}`;

    const { output, exitCode } = runCommand(step.command, 30000);
    inc.commandResults = inc.commandResults || {};
    inc.commandResults[step.id] = { output, exitCode, ranAt: new Date().toISOString() };

    return [
      `## Playbook Step ${step.id}: ${step.label}`,
      `Command: ${step.command}`,
      `Expected: ${step.expect}`,
      `Exit code: ${exitCode}`,
      `Output:`,
      output,
    ].join('\n');
  },

  get_architecture_context() {
    const lines = [
      '# E-Commerce Microservices Architecture',
      '',
      '## Services',
      '  eureka-server (port 8761) — Netflix Eureka service registry. All services register here.',
      '  api-gateway (port 8080) — Spring Cloud Gateway. Single entry point for all API traffic.',
      '  customer-service (port 8081) — Manages customer data (CRUD). Used by order-service.',
      '  inventory-service (port 8082) — Manages product catalog and stock levels. Used by order-service.',
      '  order-service (port 8083) — Orchestrates orders. Calls customer-service + inventory-service.',
      '  demo-ui (port 8090) — Express.js frontend that proxies /api/* through api-gateway.',
      '',
      '## Service Dependencies (order of calls)',
      '  demo-ui → api-gateway → {customer-service, inventory-service, order-service}',
      '  order-service → customer-service (validate customer)',
      '  order-service → inventory-service (check/reserve stock)',
      '',
      '## Revenue Impact Mapping',
    ];
    for (const [svc, info] of Object.entries(REVENUE_IMPACT)) {
      lines.push(`  ${svc}: weight=${info.weight} (${info.domain}) — ${info.description}`);
    }
    lines.push('');
    lines.push('## Resilience Patterns');
    lines.push('  - Resilience4j circuit breakers on order-service → customer-service and order-service → inventory-service');
    lines.push('  - Eureka registry cache allows services to continue routing for ~60s after Eureka dies');
    lines.push('  - Spring Boot Actuator on all services at /actuator/health, /actuator/prometheus');
    lines.push('  - Prometheus scrapes all services every 5s');
    lines.push('  - Grafana dashboard: chaos-overview with 8 panels');
    lines.push('');
    lines.push('## Chaos Scenarios Available');
    lines.push('  S1: Eureka kill — registry cache survivability');
    lines.push('  S2: Customer-service kill — circuit breaker activation');
    lines.push('  S3: Inventory latency — Chaos Monkey 8-12s latency');
    lines.push('  S4: Gateway overload — 300 concurrent requests');
    lines.push('  S5: Cascade failure — blast radius containment');
    lines.push('  S6: Network partition — Toxiproxy latency injection');
    lines.push('  S7: JVM heap exhaustion — OOM testing');
    lines.push('  S8: Network packet drop — 60% packet loss via pumba');

    return lines.join('\n');
  },

  acknowledge_or_resolve_incident(args, ctx) {
    const inc = [...ctx.incidents.values()]
      .filter(i => i.service === args.service && i.status !== 'resolved')
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];

    if (!inc) return `No active incident found for service "${args.service}".`;

    inc.status = args.new_status;
    inc.updatedAt = new Date().toISOString();
    if (args.new_status === 'resolved') inc.resolvedAt = new Date().toISOString();

    return `Incident ${inc.id.slice(0, 8)} for ${inc.service} is now ${args.new_status}.`;
  },

  async create_github_issue(args, ctx) {
    const token = ctx.githubToken;
    if (!token) {
      return 'Cannot create GitHub issue: no GitHub token available. Please sign in with GitHub OAuth first.';
    }

    const repo = process.env.GITHUB_REPO || 'petercort/copilot-spring-boot-demo';
    const labels = Array.isArray(args.labels) ? args.labels : [];

    try {
      const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
          'User-Agent': 'incident-command-center/1.0',
        },
        body: JSON.stringify({
          title: args.title,
          body: args.body,
          labels,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        // 401/403 means token lacks public_repo scope — tell user to re-authenticate
        if (res.status === 401 || res.status === 403) {
          return `Cannot create GitHub issue: your token does not have the required \`public_repo\` permission (HTTP ${res.status}).\n\nPlease **sign out and sign back in** at [/login](/login) to grant the updated permissions, then try again.`;
        }
        // If labels don't exist the API returns 422 — retry without labels
        if (res.status === 422) {
          const retry = await fetch(`https://api.github.com/repos/${repo}/issues`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Accept': 'application/vnd.github+json',
              'X-GitHub-Api-Version': '2022-11-28',
              'Content-Type': 'application/json',
              'User-Agent': 'incident-command-center/1.0',
            },
            body: JSON.stringify({ title: args.title, body: args.body }),
          });
          if (retry.ok) {
            const issue = await retry.json();
            return `GitHub issue created (labels skipped — they don't exist in the repo):
- **#${issue.number}**: ${issue.title}
- URL: ${issue.html_url}`;
          }
        }
        return `Failed to create GitHub issue: HTTP ${res.status} — ${err.message || JSON.stringify(err)}`;
      }

      const issue = await res.json();
      return `GitHub issue created successfully:
- **#${issue.number}**: ${issue.title}
- URL: ${issue.html_url}
- Labels: ${issue.labels?.map(l => l.name).join(', ') || 'none'}`;
    } catch (err) {
      return `Error creating GitHub issue: ${err.message}`;
    }
  },
};

module.exports = { handlers };
