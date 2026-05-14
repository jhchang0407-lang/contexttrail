import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { parse as parseYaml, stringify as yamlStringify } from 'yaml';
import { computeFingerprint } from '../config/fingerprint.js';
import {
  type AuthoredConfig,
  AuthoredConfigSchema,
  type ResolvedConfig,
  type ResolvedLabel,
  type ResolvedSignal,
  type ResolvedState,
} from '../schemas/index.js';
import type { Label, LinearClient, Project, WorkflowState } from './types.js';

export type SetupError =
  | { code: 'authored_missing'; path: string }
  | { code: 'authored_invalid'; path: string; reason: string }
  | { code: 'ambiguous_name'; kind: 'label' | 'state' | 'project'; name: string; matches: string[] }
  | { code: 'missing_name'; kind: 'label' | 'state' | 'project'; name: string }
  | { code: 'team_id_missing' }
  | { code: 'linear_unreachable'; cause: string }
  | { code: 'write_failed'; path: string; cause: string };

export type SetupResult = { ok: true; resolved: ResolvedConfig } | { ok: false; error: SetupError };

const AUTHORED_PATH = '.pi/executor.yaml';
const RESOLVED_PATH = '.pi/executor.lock.yaml';

export interface SetupSyncOpts {
  repoRoot: string;
  client: LinearClient;
  now?: () => string;
}

export async function setupSync(opts: SetupSyncOpts): Promise<SetupResult> {
  const authoredPath = join(opts.repoRoot, AUTHORED_PATH);
  const authoredRaw = await readFileOrNone(authoredPath);
  if (authoredRaw === null) {
    return { ok: false, error: { code: 'authored_missing', path: AUTHORED_PATH } };
  }

  let authored: AuthoredConfig;
  try {
    authored = AuthoredConfigSchema.parse(parseYaml(authoredRaw));
  } catch (e) {
    return {
      ok: false,
      error: { code: 'authored_invalid', path: AUTHORED_PATH, reason: (e as Error).message },
    };
  }

  const teamId = authored.linear.team.id;
  if (!teamId) {
    return { ok: false, error: { code: 'team_id_missing' } };
  }

  let labels: Label[];
  let states: WorkflowState[];
  let projects: Project[];
  try {
    [labels, states, projects] = await Promise.all([
      opts.client.fetchLabels(teamId),
      opts.client.fetchWorkflowStates(teamId),
      opts.client.fetchProjects(teamId),
    ]);
  } catch (e) {
    return { ok: false, error: { code: 'linear_unreachable', cause: (e as Error).message } };
  }

  const labelByName = indexByName(labels);
  const stateByName = indexByName(states);
  const projectByName = indexByName(projects);

  // Resolve signals
  const resolvedSignals: Record<string, ResolvedSignal> = {};
  for (const [signalKey, signalDef] of Object.entries(authored.linear.signals)) {
    const lookup = signalDef.mode === 'label' ? labelByName : stateByName;
    const found = resolveOne(signalDef.name, lookup, signalDef.mode);
    if (!found.ok) return { ok: false, error: found.error };
    resolvedSignals[signalKey] = {
      mode: signalDef.mode,
      name: signalDef.name,
      id: found.id,
    };
  }

  // Resolve label constants
  const resolvedLabelConstants: Record<string, ResolvedLabel> = {};
  for (const [key, def] of Object.entries(authored.linear.constants.labels)) {
    const found = resolveOne(def.name, labelByName, 'label');
    if (!found.ok) return { ok: false, error: found.error };
    resolvedLabelConstants[key] = { name: def.name, id: found.id };
  }

  // Resolve state constants
  const resolvedStateConstants: Record<string, ResolvedState> = {};
  for (const [key, def] of Object.entries(authored.linear.constants.states)) {
    const found = resolveOne(def.name, stateByName, 'state');
    if (!found.ok) return { ok: false, error: found.error };
    resolvedStateConstants[key] = { name: def.name, id: found.id };
  }

  // Resolve projects
  const resolvedProjects: Record<string, { name: string; id: string }> = {};
  for (const [key, def] of Object.entries(authored.linear.projects)) {
    if (def.id) {
      // project ID already known — accept as-is
      resolvedProjects[key] = { name: def.name, id: def.id };
      continue;
    }
    const found = resolveOne(def.name, projectByName, 'project');
    if (!found.ok) return { ok: false, error: found.error };
    resolvedProjects[key] = { name: def.name, id: found.id };
  }

  const fingerprint = computeFingerprint(authored);
  const now = opts.now?.() ?? new Date().toISOString();

  const resolved: ResolvedConfig = {
    schemaVersion: 1,
    authoredFingerprint: fingerprint,
    syncedAt: now,
    linear: {
      workspace_id: authored.linear.workspace_id || teamId,
      team_id: teamId,
      signals: resolvedSignals as ResolvedConfig['linear']['signals'],
      constants: {
        labels: resolvedLabelConstants,
        states: resolvedStateConstants,
      },
      projects: resolvedProjects,
    },
  };

  const resolvedPath = join(opts.repoRoot, RESOLVED_PATH);
  try {
    await mkdir(dirname(resolvedPath), { recursive: true });
    await writeFile(resolvedPath, yamlStringify(resolved), 'utf-8');
  } catch (e) {
    return {
      ok: false,
      error: { code: 'write_failed', path: RESOLVED_PATH, cause: (e as Error).message },
    };
  }

  return { ok: true, resolved };
}

function indexByName<T extends { id: string; name: string }>(items: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const item of items) {
    const existing = m.get(item.name) ?? [];
    existing.push(item);
    m.set(item.name, existing);
  }
  return m;
}

function resolveOne<T extends { id: string; name: string }>(
  name: string,
  index: Map<string, T[]>,
  kind: 'label' | 'state' | 'project',
): { ok: true; id: string } | { ok: false; error: SetupError } {
  const matches = index.get(name) ?? [];
  if (matches.length === 0) {
    return { ok: false, error: { code: 'missing_name', kind, name } };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      error: {
        code: 'ambiguous_name',
        kind,
        name,
        matches: matches.map((m) => m.id),
      },
    };
  }
  return { ok: true, id: matches[0]!.id };
}

async function readFileOrNone(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf-8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}
