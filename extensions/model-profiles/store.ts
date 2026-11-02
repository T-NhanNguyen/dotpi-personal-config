import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

export const profileNames = ['coding', 'writing', 'education'] as const;
export type ProfileName = typeof profileNames[number];
export const supportedApis = new Set(['openai-completions', 'openai-responses', 'azure-openai-responses']);
type ObjectValue = Record<string, any>;
type Sampling = { temperature?: number; top_p?: number };
export type Target = { provider: string; model: string };
export type CatalogModel = { provider: string; id: string; api: string };
type Config = { version: 1; targets: Target[]; profiles: Record<ProfileName, Sampling> };
type Slot = { present: false } | { present: true; value: unknown };
type Owned = Target & { key: keyof Sampling; original: Slot; applied: number };
type State = { version: 1; profile: ProfileName | null; owned: Owned[] };
const keys = ['temperature', 'top_p'] as const;
const own = (obj: object, key: string) => Object.hasOwn(obj, key);
const object = (v: unknown): v is ObjectValue => v !== null && typeof v === 'object' && !Array.isArray(v);
const put = (obj: ObjectValue, key: string, value: unknown) => Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true });
export class ProfileError extends Error {}
function fail(message: string): never { throw new ProfileError(message); }
function read(file: string): string | undefined {
  try { return fs.readFileSync(file, 'utf8'); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    return fail(`Cannot read ${path.basename(file)} (check permissions).`);
  }
}
function parse(text: string | undefined, label: string): ObjectValue {
  if (text === undefined) return {};
  let value: unknown;
  try { value = JSON.parse(text.replace(/^\uFEFF/, '')); } catch {
    return fail(`${label} must be strict JSON; comments, trailing commas and malformed JSON are not supported. No files changed.`);
  }
  if (!object(value)) fail(`${label} must contain a JSON object.`);
  return value as ObjectValue;
}
function sampling(value: unknown, label: string): asserts value is Sampling {
  if (!object(value) || Object.keys(value).length === 0 || Object.keys(value).some(k => !keys.includes(k as any))) fail(`${label}: use temperature and/or top_p only.`);
  for (const key of keys) {
    if (!own(value, key)) continue;
    const n = value[key];
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > (key === 'temperature' ? 2 : 1)) fail(`${label}: ${key} must be finite in [0, ${key === 'temperature' ? 2 : 1}].`);
  }
}
function target(value: unknown): asserts value is Target {
  if (!object(value) || typeof value.provider !== 'string' || !value.provider.trim() || typeof value.model !== 'string' || !value.model.trim()) fail('Targets require nonempty provider and model IDs.');
}
const identity = (t: Target) => JSON.stringify([t.provider, t.model]);
function validateConfig(value: ObjectValue): Config {
  if (value.version !== 1 || !Array.isArray(value.targets) || !object(value.profiles)) fail('model-profiles.json requires version: 1, targets and profiles.');
  const seen = new Set<string>();
  for (const t of value.targets) {
    target(t);
    if (seen.has(identity(t))) fail(`Duplicate target: ${t.provider}/${t.model}.`);
    seen.add(identity(t));
  }
  for (const name of profileNames) sampling(value.profiles[name], `Profile ${name}`);
  return value as Config;
}
function validateModels(models: ObjectValue): void {
  if (!own(models, 'providers')) return;
  if (!object(models.providers)) fail('models.json providers must be an object.');
  for (const provider of Object.values(models.providers)) {
    if (!object(provider)) fail('models.json provider must be an object.');
    if (!own(provider, 'modelOverrides')) continue;
    if (!object(provider.modelOverrides)) fail('models.json modelOverrides must be an object.');
    for (const override of Object.values(provider.modelOverrides)) {
      if (!object(override) || (own(override, 'samplingParams') && !object(override.samplingParams))) fail('models.json overrides and samplingParams must be objects.');
    }
  }
}
function validateState(value: ObjectValue | undefined): State {
  if (value === undefined) return { version: 1, profile: null, owned: [] };
  if (value.version !== 1 || !(value.profile === null || profileNames.includes(value.profile)) || !Array.isArray(value.owned)) fail('Invalid model-profiles.state.json.');
  const seen = new Set<string>();
  for (const entry of value.owned) {
    target(entry);
    const owned = entry as Target & ObjectValue;
    if (!keys.includes(owned.key) || !object(owned.original) || typeof owned.original.present !== 'boolean' || (owned.original.present && !own(owned.original, 'value'))) fail('Invalid model profile ownership state.');
    sampling({ [owned.key]: owned.applied }, 'Ownership state');
    const id = JSON.stringify([owned.provider, owned.model, owned.key]);
    if (seen.has(id)) fail('Duplicate model profile ownership state.');
    seen.add(id);
  }
  return value as State;
}
function child(parent: ObjectValue, key: string): ObjectValue {
  if (!own(parent, key)) put(parent, key, {});
  return parent[key];
}
function params(models: ObjectValue, t: Target, create = false): ObjectValue | undefined {
  let cursor = models;
  for (const key of ['providers', t.provider, 'modelOverrides', t.model, 'samplingParams']) {
    if (!own(cursor, key)) { if (!create) return undefined; child(cursor, key); }
    cursor = cursor[key];
  }
  return cursor;
}
function slot(models: ObjectValue, entry: Target, key: string): Slot {
  const p = params(models, entry);
  return p && own(p, key) ? { present: true, value: p[key] } : { present: false };
}
function atomic(file: string, text: string): void {
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    const mode = fs.existsSync(file) ? fs.statSync(file).mode & 0o777 : 0o600;
    fs.writeFileSync(temp, text, { flag: 'wx', mode });
    fs.chmodSync(temp, mode); // A restrictive umask must not change existing permissions.
    fs.renameSync(temp, file);
  } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
function encode(value: unknown, previous?: string): string {
  return `${previous?.startsWith('\uFEFF') ? '\uFEFF' : ''}${JSON.stringify(value, null, 2)}\n`;
}
export function example(current?: CatalogModel): Config {
  return { version: 1, targets: current && supportedApis.has(current.api) ? [{ provider: current.provider, model: current.id }] : [], profiles: { coding: { temperature: 0.2 }, writing: { temperature: 0.7 }, education: { temperature: 0.4 } } };
}

/** Synchronous lock covers read/validate/compare/rename; no runtime or network effects. */
export function updateProfiles(dir: string, action: ProfileName | 'restore' | 'init', catalog: CatalogModel[], current?: CatalogModel): string {
  fs.mkdirSync(dir, { recursive: true });
  const lock = path.join(dir, 'model-profiles.lock');
  let fd: number;
  try { fd = fs.openSync(lock, 'wx', 0o600); } catch { return fail('Model profiles are locked. Retry; remove model-profiles.lock only after confirming no command is running.'); }
  try {
    const configFile = path.join(dir, 'model-profiles.json');
    const modelsFile = path.join(dir, 'models.json');
    const stateFile = path.join(dir, 'model-profiles.state.json');
    // Restore depends only on models and ownership state, not profile config availability or validity.
    const beforeConfig = action === 'restore' ? undefined : read(configFile);
    if (action === 'init' && beforeConfig !== undefined) return 'model-profiles.json already exists; edit it to choose targets and presets.';
    const beforeModels = read(modelsFile), beforeState = read(stateFile);
    const models = parse(beforeModels, 'models.json');
    validateModels(models);
    const state = validateState(beforeState === undefined ? undefined : parse(beforeState, 'model-profiles.state.json'));
    const config = action === 'restore' ? undefined : validateConfig(beforeConfig === undefined ? example(current) : parse(beforeConfig, 'model-profiles.json'));
    if (action === 'restore' && state.owned.length === 0 && state.profile === null) return 'No owned sampling keys to restore; disk unchanged.';
    if (action !== 'init' && config && !config.targets.length) fail('No targets configured. Run /model-profile init and edit model-profiles.json with explicit compatible provider/model IDs.');
    if (action !== 'init' && config) {
      for (const t of config.targets) {
        const model = catalog.find(m => m.provider === t.provider && m.id === t.model);
        if (!model) fail(`Target not found: ${t.provider}/${t.model}. No files changed.`);
        if (!supportedApis.has(model.api)) fail(`Unsupported API ${model.api} for ${t.provider}/${t.model}. No files changed.`);
      }
    }
    const next: State = { version: 1, profile: action === 'restore' ? null : action === 'init' ? state.profile : action, owned: [] };
    if (action !== 'init') {
      // Check every owned key before touching any of them, including keys no longer targeted.
      for (const entry of state.owned) {
        const actual = slot(models, entry, entry.key);
        if (!actual.present || actual.value !== entry.applied) fail(`Restore conflict at ${entry.provider}/${entry.model} ${entry.key}; reconcile manual edits before retrying. No files changed.`);
      }
      for (const entry of state.owned) {
        const p = params(models, entry)!;
        if (entry.original.present) put(p, entry.key, entry.original.value); else delete p[entry.key];
      }
      if (config && action !== 'restore') {
        for (const t of config.targets) for (const key of keys) {
          const applied = config.profiles[action][key];
          if (applied === undefined) continue;
          next.owned.push({ ...t, key, original: slot(models, t, key), applied });
          put(params(models, t, true)!, key, applied);
        }
      }
    }
    const writes: { file: string; before: string | undefined; after: string }[] = [];
    if (beforeConfig === undefined && config) writes.push({ file: configFile, before: beforeConfig, after: encode(config) });
    if (action !== 'init') {
      writes.push({ file: modelsFile, before: beforeModels, after: encode(models, beforeModels) });
      writes.push({ file: stateFile, before: beforeState, after: encode(next) });
    }
    const completed: typeof writes = [];
    try {
      // Lock coordinates this extension; byte checks also catch edits by other writers.
      if ((action !== 'restore' && read(configFile) !== beforeConfig) || read(modelsFile) !== beforeModels || read(stateFile) !== beforeState) fail('Profile files changed concurrently. Retry.');
      for (const write of writes) {
        if (read(write.file) !== write.before) fail('Profile files changed concurrently. Retry.');
        atomic(write.file, write.after);
        completed.push(write);
      }
    } catch {
      let rollbackFailed = false;
      for (const write of completed.reverse()) {
        try {
          if (read(write.file) !== write.after) { rollbackFailed = true; continue; }
          if (write.before === undefined) fs.unlinkSync(write.file); else atomic(write.file, write.before);
        } catch { rollbackFailed = true; }
      }
      fail(rollbackFailed ? 'Persistence failed; rollback incomplete. Inspect models.json and model-profiles.state.json before retrying.' : 'Persistence failed or concurrent edit detected; completed writes rolled back. Retry after checking file permissions.');
    }
    if (action === 'init' && config) return `Created model-profiles.json. ${config.targets.length ? 'Current model is the explicit target; edit presets as needed.' : 'Current API is unsupported or no model is active. Add explicit compatible provider/model targets before applying.'}`;
    return config ? `Saved ${action} sampling profile on disk for ${config.targets.length} target(s).` : 'Restored owned sampling keys on disk.';
  } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}

export function profileStatus(dir: string): string {
  const text = read(path.join(dir, 'model-profiles.state.json'));
  const state = validateState(text === undefined ? undefined : parse(text, 'model-profiles.state.json'));
  return `Global disk profile: ${state.profile ?? 'none'}; owned sampling keys: ${state.owned.length}. Config: ${path.join(dir, 'model-profiles.json')}. Runtime and endpoint acceptance are not verified by status.`;
}
