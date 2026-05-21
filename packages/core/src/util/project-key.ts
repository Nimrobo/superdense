const CONDUCTOR_WORKSPACES = '/conductor/workspaces/';

export function resolveProjectKey(pwd: string): string {
  const markerIndex = pwd.indexOf(CONDUCTOR_WORKSPACES);
  if (markerIndex < 0) return pwd;

  const rest = pwd.slice(markerIndex + CONDUCTOR_WORKSPACES.length);
  const parts = rest.split('/');
  const project = parts[0];
  const workspace = parts[1];
  if (!project || !workspace) return pwd;

  return pwd.slice(0, markerIndex + CONDUCTOR_WORKSPACES.length + project.length);
}
