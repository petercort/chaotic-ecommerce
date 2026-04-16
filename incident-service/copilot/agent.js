// ---------------------------------------------------------------------------
// Copilot Agent — main module
// ---------------------------------------------------------------------------
// Two modes:
//   1. Local chat (X-Local-Chat: true) — pattern-matches user queries and
//      dispatches tools directly. No external LLM call needed.
//   2. SSE mode (Copilot Extensions protocol) — uses the Copilot SDK prompt()
//      with tool calling when a valid GitHub token is available.
// ---------------------------------------------------------------------------

const {
  createAckEvent,
  createTextEvent,
  createDoneEvent,
  createErrorsEvent,
  prompt,
  getFunctionCalls,
} = require('@copilot-extensions/preview-sdk');

const { TOOL_DEFINITIONS } = require('./tools');
const { handlers } = require('./handlers');

const SERVICES = ['api-gateway', 'customer-service', 'inventory-service', 'order-service', 'eureka-server'];

// ---------------------------------------------------------------------------
// Pattern-based intent detection for local chat
// ---------------------------------------------------------------------------
function detectIntent(message) {
  const msg = message.toLowerCase();

  // Extract a service name if mentioned
  const service = SERVICES.find(s => msg.includes(s) || msg.includes(s.replace('-service', '')));

  // Status / overview
  if (/status|overview|how.*(system|things|everything)|what.*(going on|happening)/.test(msg)) {
    return [
      { tool: 'list_incidents', args: { status: 'all' } },
      ...SERVICES.map(s => ({ tool: 'check_service_health', args: { service: s } })),
    ];
  }

  // Active incidents
  if (/active.*(incident|alert)|open.*(incident|alert)|incident|alert/.test(msg) && !service) {
    return [{ tool: 'list_incidents', args: { status: 'open' } }];
  }

  // Deep diagnostic on a specific service
  if (/diagnos|deep dive|investigate|analyze|troubleshoot/.test(msg) && service) {
    return [
      { tool: 'get_incident_details', args: { service } },
      { tool: 'get_service_metrics', args: { service } },
      { tool: 'get_service_logs', args: { service, tail: 50, errors_only: true } },
    ];
  }

  // Deep diagnostic on most critical
  if (/diagnos|deep dive|critical/.test(msg) && !service) {
    return [
      { tool: 'list_incidents', args: { status: 'open' } },
      { tool: 'get_architecture_context', args: {} },
    ];
  }

  // Health check
  if (/health|alive|up\b|down\b/.test(msg)) {
    if (service) {
      return [{ tool: 'check_service_health', args: { service } }];
    }
    return SERVICES.map(s => ({ tool: 'check_service_health', args: { service: s } }));
  }

  // Logs
  if (/log|trace|stack|exception/.test(msg)) {
    const svc = service || 'order-service';
    const errorsOnly = /error|exception|fail|warn/.test(msg);
    const tailMatch = msg.match(/(\d+)\s*(line|log|recent)/);
    const tail = tailMatch ? parseInt(tailMatch[1], 10) : 50;
    return [{ tool: 'get_service_logs', args: { service: svc, tail, errors_only: errorsOnly } }];
  }

  // Error rates / metrics
  if (/error.*(rate|percent|%)|5xx|metric|latency|p99|p50|heap|jvm|gc|thread/.test(msg)) {
    if (service) {
      return [{ tool: 'get_service_metrics', args: { service } }];
    }
    return SERVICES.filter(s => s !== 'eureka-server')
      .map(s => ({ tool: 'get_service_metrics', args: { service: s } }));
  }

  // Prometheus query
  if (/promql|prometheus|query.*prom/.test(msg)) {
    const promqlMatch = msg.match(/`([^`]+)`/) || msg.match(/query[:\s]+(.+)/i);
    if (promqlMatch) {
      return [{ tool: 'query_prometheus', args: { promql: promqlMatch[1].trim() } }];
    }
    return [{ tool: 'query_prometheus', args: { promql: 'up' } }];
  }

  // Circuit breaker
  if (/circuit.?breaker|cb\b|breaker/.test(msg)) {
    const svc = service || 'order-service';
    return [
      { tool: 'query_prometheus', args: { promql: `resilience4j_circuitbreaker_state{job="${svc}"}` } },
      { tool: 'check_service_health', args: { service: svc } },
    ];
  }

  // Architecture
  if (/architect|dependen|revenue.*(impact|map|weight)|how.*connect|topology/.test(msg)) {
    return [{ tool: 'get_architecture_context', args: {} }];
  }

  // Playbook step
  if (/run.*(step|playbook)|execute.*(step|playbook)|step\s*(\d)/.test(msg)) {
    const stepMatch = msg.match(/step\s*(\d)/);
    const step = stepMatch ? parseInt(stepMatch[1], 10) : 1;
    const svc = service || 'order-service';
    return [{ tool: 'run_playbook_step', args: { service: svc, step_number: step } }];
  }

  // Create GitHub issue
  if (/create.*issue|file.*issue|open.*issue|log.*issue|github.*issue|issue.*github|track.*incident/.test(msg)) {
    const svc = service || 'the affected service';
    return [{ tool: 'create_github_issue', args: {
      title: `[Incident] ${svc}: issue detected`,
      body: `An incident was detected for **${svc}**. Please investigate.`,
      labels: ['incident'],
    } }];
  }

  // Acknowledge / resolve
  if (/acknowledge|ack\b/.test(msg) && service) {
    return [{ tool: 'acknowledge_or_resolve_incident', args: { service, new_status: 'acknowledged' } }];
  }
  if (/resolve|close|fix/.test(msg) && service) {
    return [{ tool: 'acknowledge_or_resolve_incident', args: { service, new_status: 'resolved' } }];
  }

  // Incident details for a specific service
  if (service) {
    return [
      { tool: 'get_incident_details', args: { service } },
      { tool: 'check_service_health', args: { service } },
    ];
  }

  // Fallback — show incidents + architecture
  return [
    { tool: 'list_incidents', args: { status: 'open' } },
    { tool: 'get_architecture_context', args: {} },
  ];
}

// Maximum tool-calling iterations to prevent infinite loops
const MAX_TOOL_ROUNDS = 8;

const SYSTEM_PROMPT = `You are the Incident Command Center AI — an expert SRE copilot for a Spring Boot microservices e-commerce platform.
5 services: eureka-server (8761), api-gateway (8080), customer-service (8081), inventory-service (8082), order-service (8083).
Order flow: demo-ui → api-gateway → order-service → {customer-service, inventory-service}.
Revenue priority: order-service = api-gateway > inventory-service > customer-service > eureka-server.
Always use tools to get real data. Explain findings in terms of revenue impact. Format responses in Markdown.
You can also create GitHub issues to track incidents — use create_github_issue when asked to file or track an incident as an issue. Write a detailed issue body including severity, metrics, triage analysis, and recommended remediation steps.`;

// ---------------------------------------------------------------------------
// Direct Copilot API chat — calls api.githubcopilot.com with OAuth token
// ---------------------------------------------------------------------------
async function handleCopilotAPIChat(messages, token, ctx) {
  // Strip 'strict' field — not needed and may cause issues with some models
  const tools = TOOL_DEFINITIONS.map(t => ({
    type: t.type,
    function: {
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters,
    },
  }));

  let conversationMessages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...messages,
  ];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await fetch('https://api.githubcopilot.com/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'incident-command-center/1.0',
        'Copilot-Integration-Id': 'incident-command-center',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: conversationMessages,
        tools,
        tool_choice: 'auto',
        stream: false,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Copilot API ${response.status}: ${body.slice(0, 200)}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    if (!choice) break;

    const msg = choice.message;

    if (choice.finish_reason === 'tool_calls' && msg.tool_calls?.length) {
      conversationMessages.push(msg);
      for (const tc of msg.tool_calls) {
        const handler = handlers[tc.function.name];
        let result;
        if (handler) {
          try {
            const args = JSON.parse(tc.function.arguments || '{}');
            const r = handler(args, ctx);
            result = r instanceof Promise ? await r : r;
          } catch (e) {
            result = `Tool error: ${e.message}`;
          }
        } else {
          result = `Unknown tool: ${tc.function.name}`;
        }
        conversationMessages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: String(result),
        });
      }
    } else {
      return msg.content || 'Analysis complete.';
    }
  }

  return 'Max tool rounds reached.';
}

/**
 * Register the Copilot agent routes on an Express app.
 */
function registerCopilotAgent(app, ctx) {
  app.post('/api/copilot/chat', async (req, res) => {
    // Prefer session token (OAuth login), then explicit header/env var
    const token = req.session?.githubToken
      || req.headers['x-github-token']
      || process.env.GITHUB_TOKEN
      || '';

    // Merge token into ctx so ALL paths (local, SSE, API) can use it for tools
    const reqCtx = { ...ctx, githubToken: token };

    let messages;
    if (req.body.messages) {
      messages = req.body.messages;
    } else if (req.body.message) {
      messages = [{ role: 'user', content: req.body.message }];
    } else {
      res.status(400).json({ error: 'No message provided' });
      return;
    }

    // SSE mode — Copilot Extensions protocol
    if (req.headers['accept'] === 'text/event-stream') {
      await handleSSEChat(messages, token, reqCtx, res);
      return;
    }

    // JSON mode — authenticated: call Copilot API; unauthenticated: local patterns
    if (token && token.length >= 10) {
      try {
        const content = await handleCopilotAPIChat(messages, token, reqCtx);
        res.json({ role: 'assistant', content });
      } catch (err) {
        const status = err.message.match(/Copilot API (\d+)/)?.[1];
        if (status === '401' || status === '403') {
          // Token doesn't have Copilot access — fall back gracefully
          console.warn('[copilot api] token rejected, using local mode:', err.message);
          await handleLocalChat(messages, reqCtx, res);
        } else {
          console.error('[copilot api error]', err.message);
          res.status(500).json({ error: err.message });
        }
      }
    } else {
      await handleLocalChat(messages, reqCtx, res);
    }
  });
}

// ---------------------------------------------------------------------------
// Local chat — pattern-match → dispatch tools → format results
// ---------------------------------------------------------------------------
async function handleLocalChat(messages, ctx, res) {
  try {
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    if (!lastUserMsg) {
      res.json({ role: 'assistant', content: 'No message received.' });
      return;
    }

    const intents = detectIntent(lastUserMsg.content);
    const sections = [];

    for (const intent of intents) {
      const handler = handlers[intent.tool];
      if (!handler) {
        sections.push(`**${intent.tool}**: Unknown tool`);
        continue;
      }

      try {
        const result = handler(intent.args, ctx);
        const output = result instanceof Promise ? await result : result;
        sections.push(String(output));
      } catch (err) {
        sections.push(`**${intent.tool}** error: ${err.message}`);
      }
    }

    const content = sections.join('\n\n---\n\n');
    res.json({ role: 'assistant', content });
  } catch (err) {
    console.error('[local chat error]', err);
    res.status(500).json({ error: err.message });
  }
}

// ---------------------------------------------------------------------------
// SSE handler — Copilot Extensions protocol (requires valid GitHub token)
// ---------------------------------------------------------------------------
async function handleSSEChat(messages, token, ctx, res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // If no valid token, fall back to local dispatch over SSE
  if (!token || token.length < 10) {
    res.write(createAckEvent());
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    const intents = detectIntent(lastUserMsg?.content || '');
    const sections = [];

    for (const intent of intents) {
      const handler = handlers[intent.tool];
      if (!handler) continue;
      try {
        const result = handler(intent.args, ctx);
        const output = result instanceof Promise ? await result : result;
        sections.push(String(output));
      } catch (err) {
        sections.push(`**${intent.tool}** error: ${err.message}`);
      }
    }

    res.write(createTextEvent(sections.join('\n\n---\n\n')));
    res.write(createDoneEvent());
    res.end();
    return;
  }

  try {
    res.write(createAckEvent());

    const systemMessages = [{
      role: 'system',
      content: `You are the Incident Command Center AI — an expert SRE copilot for a Spring Boot microservices e-commerce platform.
5 services: eureka-server (8761), api-gateway (8080), customer-service (8081), inventory-service (8082), order-service (8083).
Order flow: demo-ui → api-gateway → order-service → {customer-service, inventory-service}.
Always use tools to get real data. Explain findings in terms of revenue impact.`,
    }];
    let conversationMessages = [...systemMessages, ...messages];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const result = await prompt({
        token,
        model: 'gpt-4o',
        messages: conversationMessages,
        tools: TOOL_DEFINITIONS,
        toolChoice: 'auto',
      });

      const functionCalls = getFunctionCalls(result);

      if (!functionCalls || functionCalls.length === 0) {
        const content = result.message?.content || 'Analysis complete — no additional output.';
        res.write(createTextEvent(content));
        break;
      }

      conversationMessages.push(result.message);

      for (const fc of functionCalls) {
        const handler = handlers[fc.function.name];
        let toolResult;
        if (handler) {
          try {
            const args = JSON.parse(fc.function.arguments);
            const handlerResult = handler(args, ctx);
            toolResult = handlerResult instanceof Promise ? await handlerResult : handlerResult;
          } catch (err) {
            toolResult = `Tool error: ${err.message}`;
          }
        } else {
          toolResult = `Unknown tool: ${fc.function.name}`;
        }
        conversationMessages.push({ role: 'tool', tool_call_id: fc.id, content: String(toolResult) });
      }

      res.write(createTextEvent(`\n\n_Executing ${functionCalls.map(f => f.function.name).join(', ')}..._\n\n`));
    }

    res.write(createDoneEvent());
    res.end();
  } catch (err) {
    console.error('[copilot agent SSE error]', err);
    res.write(createErrorsEvent([{ type: 'agent', code: 'AGENT_ERROR', message: err.message, identifier: 'incident-agent' }]));
    res.write(createDoneEvent());
    res.end();
  }
}

module.exports = { registerCopilotAgent, handleCopilotAPIChat };
