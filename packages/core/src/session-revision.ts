import type { Session } from './types.js';

const REVISION_NUMBER_EPSILON = 0.01;

type RevisionTuple = [number | null, number | null, number | null];

function revisionTuple(
  fileMtime: unknown,
  modifiedAt: unknown,
  messageCount: unknown,
): RevisionTuple {
  return [numberOrNull(fileMtime), numberOrNull(modifiedAt), numberOrNull(messageCount)];
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseRevision(value: unknown): RevisionTuple | null {
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 3) return null;
    return revisionTuple(parsed[0], parsed[1], parsed[2]);
  } catch {
    return null;
  }
}

function revisionTuplesEqual(left: RevisionTuple, right: RevisionTuple): boolean {
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (a == null || b == null) {
      if (a !== b) return false;
      continue;
    }
    if (Math.abs(a - b) > REVISION_NUMBER_EPSILON) return false;
  }
  return true;
}

export function sessionRevision(
  session: Pick<Session, 'fileMtime' | 'modifiedAt' | 'messageCount'>,
): string {
  return JSON.stringify(
    revisionTuple(
      session.fileMtime ?? null,
      session.modifiedAt ?? null,
      session.messageCount ?? null,
    ),
  );
}

export function sessionRevisionMatchesFields(
  storedRevision: unknown,
  fields: { fileMtime?: unknown; modifiedAt?: unknown; messageCount?: unknown },
): boolean {
  const stored = parseRevision(storedRevision);
  if (!stored) return false;
  return revisionTuplesEqual(
    stored,
    revisionTuple(fields.fileMtime ?? null, fields.modifiedAt ?? null, fields.messageCount ?? null),
  );
}
