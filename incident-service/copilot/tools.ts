// ---------------------------------------------------------------------------
// Copilot Agent — tool definitions for the LLM
// ---------------------------------------------------------------------------
// These tools are registered with the Copilot SDK's prompt() function so the
// model can call them to inspect services, query metrics, run diagnostics, and
// interact with the incident service.
// ---------------------------------------------------------------------------

export interface ToolFunction {
  name: string;
  description: string;
  strict: boolean;
  parameters: {
    type: string;
    properties: Record<string, unknown>;
    required: string[];
    additionalProperties: boolean;
  };
}

export interface Tool {
  type: 'function';
  function: ToolFunction;
}

export const TOOL_DEFINITIONS: Tool[] = [
  {
    type: 'function',
    function: {
      name: 'list_incidents',
      description: 'List all current incidents, optionally filtered by status (open, acknowledged, resolved). Returns severity, service name, error rate, and revenue impact score.',
      strict: true,
      parameters: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['open', 'acknowledged', 'resolved', 'all'],
            description: 'Filter incidents by status. Use "all" to return everything.',
          },
        },
        required: ['status'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_incident_details',
      description: 'Get full details of a specific incident including triage analysis, playbook, error logs, reproduction steps, and revenue impact.',
      strict: true,
      parameters: {
        type: 'object',
        properties: {
          service: {
            type: 'string',
            description: 'The service name (e.g. "order-service", "api-gateway"). If multiple incidents exist, returns the most recent open one.',
          },
        },
        required: ['service'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_prometheus',
      description: 'Run an arbitrary PromQL query against Prometheus and return the results. Use this for deep metrics analysis — error rates, latency percentiles, JVM metrics, circuit breaker states, request counts, etc.',
      strict: true,
      parameters: {
        type: 'object',
        properties: {
          promql: {
            type: 'string',
            description: 'The PromQL query to execute. Example: rate(http_server_requests_seconds_count{job="order-service",status=~"5.."}[5m])',
          },
        },
        required: ['promql'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_service_health',
      description: 'Check the health status of a specific microservice by hitting its Spring Boot Actuator health endpoint. Returns the full health response including dependency status.',
      strict: true,
      parameters: {
        type: 'object',
        properties: {
          service: {
            type: 'string',
            enum: ['api-gateway', 'customer-service', 'inventory-service', 'order-service', 'eureka-server'],
            description: 'The service to check health for.',
          },
        },
        required: ['service'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_service_logs',
      description: 'Fetch recent Docker container logs for a service. Can optionally filter for only error/exception lines.',
      strict: true,
      parameters: {
        type: 'object',
        properties: {
          service: {
            type: 'string',
            enum: ['api-gateway', 'customer-service', 'inventory-service', 'order-service', 'eureka-server'],
            description: 'The service to get logs for.',
          },
          tail: {
            type: 'number',
            description: 'Number of log lines to fetch (from the end). Default 100.',
          },
          errors_only: {
            type: 'boolean',
            description: 'If true, filter to only lines containing error, exception, fatal, or warn.',
          },
        },
        required: ['service', 'tail', 'errors_only'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_diagnostic_command',
      description: 'Run a diagnostic shell command on the server. Use for things like checking Docker container status, inspecting JVM metrics via actuator, testing endpoint connectivity, etc. Commands run in the project root directory.',
      strict: true,
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The shell command to execute. Examples: "docker ps", "curl -s http://localhost:8080/actuator/health | jq .", "docker stats --no-stream"',
          },
          timeout_seconds: {
            type: 'number',
            description: 'Maximum seconds to wait for the command. Default 15.',
          },
        },
        required: ['command', 'timeout_seconds'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_service_metrics',
      description: 'Get a comprehensive metrics snapshot for a service: error rate, P99 latency, JVM heap usage, GC pause times, thread count, and circuit breaker state.',
      strict: true,
      parameters: {
        type: 'object',
        properties: {
          service: {
            type: 'string',
            enum: ['api-gateway', 'customer-service', 'inventory-service', 'order-service', 'eureka-server'],
            description: 'The service to get metrics for.',
          },
        },
        required: ['service'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_playbook_step',
      description: 'Execute a specific step from an incident\'s interactive playbook. Returns the command output and exit code.',
      strict: true,
      parameters: {
        type: 'object',
        properties: {
          service: {
            type: 'string',
            description: 'The service name to find the incident for.',
          },
          step_number: {
            type: 'number',
            description: 'The step number (1-based) in the playbook to execute.',
          },
        },
        required: ['service', 'step_number'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_architecture_context',
      description: 'Get context about the microservices architecture, service dependencies, and revenue impact mapping. Use this to understand how services relate to each other and which are most critical for revenue.',
      strict: true,
      parameters: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'acknowledge_or_resolve_incident',
      description: 'Change the status of an incident. Use to acknowledge an incident you are investigating, or resolve it when the issue is fixed.',
      strict: true,
      parameters: {
        type: 'object',
        properties: {
          service: {
            type: 'string',
            description: 'The service name to find the incident for.',
          },
          new_status: {
            type: 'string',
            enum: ['acknowledged', 'resolved'],
            description: 'The new status for the incident.',
          },
        },
        required: ['service', 'new_status'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_github_issue',
      description: 'Create a GitHub issue in the repository to track an incident or bug. Use this when the user asks to file, create, or open an issue for an incident. The issue will be created in the configured repository.',
      strict: true,
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'The issue title. Should be concise and descriptive, e.g. "[INC-0001] order-service: 42% error rate — circuit breaker open".',
          },
          body: {
            type: 'string',
            description: 'The issue body in Markdown. Include service name, severity, error rate, P99 latency, triage summary, and recommended next steps.',
          },
          labels: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional list of label names to apply, e.g. ["incident", "critical", "order-service"]. Labels must already exist in the repo.',
          },
        },
        required: ['title', 'body', 'labels'],
        additionalProperties: false,
      },
    },
  },
];
