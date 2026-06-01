import type { QueryDefinition } from './query/types.js';

export interface Session {
  id: string;
  agent: string;
  sessionId: string;
  logPath: string;
  pwd: string;
  projectKey: string;
  firstPrompt?: string | null;
  summary?: string | null;
  messageCount?: number | null;
  gitBranch?: string | null;
  createdAt?: number | null;
  modifiedAt?: number | null;
  isSidechain?: boolean;
  isSubagent?: boolean;
  parentSessionId?: string | null;
  fileMtime?: number | null;
  lastIndexedAt?: number | null;
  curationStatus?: 'pending' | 'consumed' | 'skipped' | 'deferred';
  curatedRevision?: string | null;
  curatedAt?: number | null;
  curationNote?: string | null;
  curationPriorityAt?: number | null;
}

export interface DiscoveredSession {
  sessionId: string;
  logPath: string;
  pwd: string;
  firstPrompt?: string;
  summary?: string;
  messageCount?: number;
  gitBranch?: string;
  createdAt?: number;
  modifiedAt?: number;
  isSidechain?: boolean;
  raw?: unknown;
}

export interface TranscriptEvent {
  ts?: number;
  kind?: 'text' | 'tool_call' | 'tool_result' | 'mode_change';
  toolCallId?: string;
  toolName?: string;
  inputText?: string;
  role?: 'user' | 'assistant' | 'system';
  text?: string;
  isError?: boolean;
  mode?: string;
  prevMode?: string;
  raw?: unknown;
}

export interface DiscoveredSubAgent {
  session: DiscoveredSession;
  relation: 'subagent';
  metadata?: Record<string, unknown>;
}

export interface Adapter {
  name: string;
  discover(): Promise<DiscoveredSession[]>;
  discoverSubAgentSessions(parentSessionId: string): Promise<DiscoveredSubAgent[]>;
  iterEvents(logPath: string): AsyncIterable<TranscriptEvent>;
  sourceMtime?(session: DiscoveredSession): Promise<number | undefined>;
}

export interface FilterHelpers {
  iterEvents(jsonlPath: string): AsyncIterable<TranscriptEvent>;
}

export type MatchResult = boolean | { match: true; evidence?: string };

export interface JsonSchemaField {
  name: string;
  type: 'string' | 'number' | 'boolean';
  required?: boolean;
  description?: string;
  default?: string | number | boolean;
}

export interface Query {
  id: string;
  name: string;
  filters: QueryDefinition['filters'];
  enrichers: string[];
  createdAt: number;
  lastRunAt?: number | null;
  memberCount?: number;
}

export interface QueryMatch {
  queryRunId: string;
  sessionId: string;
  addedAt: number;
  evidence?: string | null;
}
