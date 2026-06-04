import type { Session } from './types.js';
import { resolveProjectKey } from './util/project-key.js';

export interface SessionRow {
  id: string;
  agent: string;
  session_id: string;
  log_path: string;
  pwd: string;
  project_key: string;
  first_prompt: string | null;
  summary: string | null;
  message_count: number | null;
  git_branch: string | null;
  created_at: number | null;
  modified_at: number | null;
  is_sidechain: number;
  is_subagent: number;
  parent_session_id: string | null;
  file_mtime: number | null;
  last_indexed_at: number | null;
  curation_status: 'pending' | 'consumed' | 'skipped' | 'deferred';
  curated_revision: string | null;
  curated_at: number | null;
  curation_note: string | null;
  curation_priority_at: number | null;
}

export function rowToSession(r: SessionRow): Session {
  return {
    id: r.id,
    agent: r.agent,
    sessionId: r.session_id,
    logPath: r.log_path,
    pwd: r.pwd,
    projectKey: r.project_key || resolveProjectKey(r.pwd),
    firstPrompt: r.first_prompt,
    summary: r.summary,
    messageCount: r.message_count,
    gitBranch: r.git_branch,
    createdAt: r.created_at,
    modifiedAt: r.modified_at,
    isSidechain: !!r.is_sidechain,
    isSubagent: !!r.is_subagent,
    parentSessionId: r.parent_session_id ?? null,
    fileMtime: r.file_mtime,
    lastIndexedAt: r.last_indexed_at,
    curationStatus: r.curation_status,
    curatedRevision: r.curated_revision,
    curatedAt: r.curated_at,
    curationNote: r.curation_note,
    curationPriorityAt: r.curation_priority_at,
  };
}
