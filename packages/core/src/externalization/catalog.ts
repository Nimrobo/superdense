import { accessSync, constants } from 'node:fs';
import { delimiter, join } from 'node:path';

export interface ExternalizationConnector {
  name: string;
  executable: string;
  repository: string;
  description: string;
}

export interface ExternalizationConnectorAvailability extends ExternalizationConnector {
  installed: boolean;
}

// Layer 4 starts without built-in providers. Add reviewed external connector
// repositories here as they become available.
export const externalizationConnectorCatalog: readonly ExternalizationConnector[] = [];

export function isExecutableOnPath(executable: string, pathValue = process.env.PATH): boolean {
  if (!pathValue) return false;
  for (const dir of pathValue.split(delimiter)) {
    if (!dir) continue;
    try {
      accessSync(join(dir, executable), constants.X_OK);
      return true;
    } catch {
      // Keep searching PATH.
    }
  }
  return false;
}

export function listExternalizationConnectors(
  catalog: readonly ExternalizationConnector[] = externalizationConnectorCatalog,
  pathValue = process.env.PATH,
): ExternalizationConnectorAvailability[] {
  return catalog.map((connector) => {
    const expectedExecutable = `superdense-externalize-${connector.name}`;
    if (connector.executable !== expectedExecutable) {
      throw new Error(`connector ${connector.name} executable must be ${expectedExecutable}`);
    }
    return {
      ...connector,
      installed: isExecutableOnPath(connector.executable, pathValue),
    };
  });
}
