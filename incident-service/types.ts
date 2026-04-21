// ---------------------------------------------------------------------------
// Shared type definitions for the Incident Service
// ---------------------------------------------------------------------------

import type { Request } from 'express';

// ---------------------------------------------------------------------------
// Severity
// ---------------------------------------------------------------------------
export type SeverityLevel = 'critical' | 'high' | 'medium' | 'low';
export type SeverityLabel = 'SEV-1' | 'SEV-2' | 'SEV-3' | 'SEV-4';

export interface Severity {
  level: SeverityLevel;
  label: SeverityLabel;
  score: number;
  color: string;
}

// ---------------------------------------------------------------------------
// Playbook
// ---------------------------------------------------------------------------
export interface PlaybookStep {
  id: number;
  label: string;
  command: string;
  expect: string;
}

export interface Playbook {
  title: string;
  steps: PlaybookStep[];
}

// ---------------------------------------------------------------------------
// Incident
// ---------------------------------------------------------------------------
export interface CommandResult {
  output: string;
  exitCode: number;
  summary?: string;
  summaryStatus?: 'pass' | 'warn' | 'fail';
  ranAt: string;
}

export interface Incident {
  id: string;
  uid: string;
  service: string;
  port: number;
  severity: Severity;
  errorRate: number;
  latencyP99: number;
  isDown: boolean;
  cbOpen: boolean;
  status: 'open' | 'acknowledged' | 'resolved';
  errorLines: string[];
  rawLogs: string;
  analysis: string;
  playbook: Playbook;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
  updateCount: number;
  commandResults: Record<number, CommandResult>;
  seeded?: boolean;
}

// ---------------------------------------------------------------------------
// Service Health
// ---------------------------------------------------------------------------
export interface ServiceHealth {
  service: string;
  port: number;
  isDown: boolean;
  errorRate: number;
  latencyP99: number;
  cbOpen: boolean;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Revenue impact metadata
// ---------------------------------------------------------------------------
export interface RevenueImpact {
  weight: number;
  domain: string;
  description: string;
}

// ---------------------------------------------------------------------------
// Copilot Agent context
// ---------------------------------------------------------------------------
export interface AgentContext {
  incidents: Map<string, Incident>;
  prometheusUrl: string;
  githubToken?: string;
}

// ---------------------------------------------------------------------------
// Prometheus query result
// ---------------------------------------------------------------------------
export interface PrometheusResult {
  metric: Record<string, string>;
  value?: [number, string];
}

export type PrometheusQueryResult = PrometheusResult[] | { error: string };

// ---------------------------------------------------------------------------
// Tool handler args
// ---------------------------------------------------------------------------
export interface ListIncidentsArgs {
  status: 'open' | 'acknowledged' | 'resolved' | 'all';
}

export interface GetIncidentDetailsArgs {
  service: string;
}

export interface QueryPrometheusArgs {
  promql: string;
}

export interface CheckServiceHealthArgs {
  service: string;
}

export interface GetServiceLogsArgs {
  service: string;
  tail: number;
  errors_only: boolean;
}

export interface RunDiagnosticCommandArgs {
  command: string;
  timeout_seconds: number;
}

export interface GetServiceMetricsArgs {
  service: string;
}

export interface RunPlaybookStepArgs {
  service: string;
  step_number: number;
}

export interface AcknowledgeOrResolveArgs {
  service: string;
  new_status: 'acknowledged' | 'resolved';
}

export interface CreateGithubIssueArgs {
  title: string;
  body: string;
  labels: string[];
}

// ---------------------------------------------------------------------------
// express-session augmentation
// ---------------------------------------------------------------------------
declare module 'express-session' {
  interface SessionData {
    githubToken?: string;
    oauthState?: string;
    user?: {
      id: number;
      login: string;
      name: string;
      avatar: string;
      url: string;
    };
  }
}

// ---------------------------------------------------------------------------
// Express request with session
// ---------------------------------------------------------------------------
export interface AuthenticatedRequest extends Request {
  session: Request['session'] & {
    githubToken?: string;
    oauthState?: string;
    user?: {
      id: number;
      login: string;
      name: string;
      avatar: string;
      url: string;
    };
  };
}
