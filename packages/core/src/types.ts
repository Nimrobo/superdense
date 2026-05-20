export interface Session {
  id: string;
  agent: string;
  sessionId: string;
  logPath: string;
  pwd: string;
  firstPrompt?: string | null;
  summary?: string | null;
  messageCount?: number | null;
  gitBranch?: string | null;
  createdAt?: number | null;
  modifiedAt?: number | null;
  isSidechain?: boolean;
  fileMtime?: number | null;
  lastIndexedAt?: number | null;
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
  toolName?: string;
  inputText?: string;
  role?: 'user' | 'assistant' | 'system';
  text?: string;
  raw?: unknown;
}

export interface Adapter {
  name: string;
  discover(): Promise<DiscoveredSession[]>;
  iterEvents(logPath: string): AsyncIterable<TranscriptEvent>;
}

export interface PluginHelpers {
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

export interface GroupingPlugin {
  name: string;
  title: string;
  description?: string;
  configSchema?: JsonSchemaField[];
  prefilter?(session: Session, config: Record<string, unknown>): boolean;
  matches(
    session: Session,
    jsonlPath: string,
    config: Record<string, unknown>,
    helpers: PluginHelpers,
  ): Promise<MatchResult>;
}

export interface Group {
  id: string;
  name: string;
  pluginName: string;
  pluginConfig: Record<string, unknown>;
  createdAt: number;
  lastRunAt?: number | null;
  memberCount?: number;
}

export interface GroupItem {
  groupId: string;
  sessionId: string;
  addedAt: number;
  evidence?: string | null;
}
