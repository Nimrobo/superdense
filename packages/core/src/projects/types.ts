export type ProjectProfileStatus = 'unprofiled' | 'profiled' | 'covered';

export type ArtifactDetector =
  | { kind: 'folder-leaf'; include: string[]; exclude?: string[] }
  | { kind: 'file-glob'; include: string[]; exclude?: string[] }
  | { kind: 'branch' }
  | { kind: 'whole-surface' };

export interface ArtifactShape {
  type: string;
  detector: ArtifactDetector;
  outputHint?: {
    globs: string[];
    note?: string;
  };
}

export interface ProjectProfile {
  id: string;
  projectKey: string;
  status: ProjectProfileStatus;
  coveredBy: string | null;
  name: string | null;
  description: string | null;
  roots: string[];
  artifactShapes: ArtifactShape[];
  evidenceSummary: string[];
  notes: string | null;
  needsHumanAttention: boolean;
  attentionReasons: string[];
  firstSeenAt: number;
  lastSeenAt: number;
  profiledAt: number | null;
  updatedAt: number;
  coveredProjects: ProjectProfileSummary[];
}

export type ProjectProfileSummary = Omit<ProjectProfile, 'coveredProjects'>;

export interface ProjectProfileResolution {
  project: ProjectProfile;
  redirectedFrom: string | null;
}

export interface ProjectPathResolution extends ProjectProfileResolution {
  path: string;
  projectKey: string;
  matchedProject: ProjectProfileSummary;
  matchedBy: 'projectKey' | 'root';
  matchedPath: string;
}

export interface ProjectContext {
  project: ProjectProfile;
  observed: {
    projectKeys: string[];
    paths: Array<{ pwd: string; sessions: number; lastSeenAt: number | null }>;
    sessionCount: number;
    firstIntents: string[];
    touchedFiles: Array<{ path: string; sessions: number; writes: number }>;
    tools: Array<{ name: string; count: number }>;
    clis: Array<{ name: string; count: number }>;
  };
  siblingCandidates: ProjectProfileSummary[];
  fileCensus: {
    root: string | null;
    filesScanned: number;
    directoriesScanned: number;
    extensions: Array<{ extension: string; count: number }>;
    sampleFiles: string[];
    truncated: boolean;
    warnings: string[];
  };
}
