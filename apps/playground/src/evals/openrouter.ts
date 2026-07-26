/**
 * OpenRouter connection for the Evals run dialog — client-side only.
 *
 * Runs record *which model authored the StyleDNA and screens* in their
 * provenance. Typing that by hand produces drift ("claude-opus-4", "opus 4",
 * "anthropic/claude-opus-4"), which makes runs uncomparable later. So the model
 * field is backed by OpenRouter's live catalogue and the provider is derived
 * from the canonical id rather than typed twice.
 *
 * Key handling — the constraints this file is built around:
 *  - The key lives in localStorage on this origin and nowhere else. There is no
 *    server in the playground; nothing is ever POSTed anywhere but openrouter.ai.
 *  - It is only transmitted in two user-initiated cases: when the user presses
 *    Verify, and when the user starts an agent-loop eval run (chat
 *    completions). The model catalogue endpoint is public, so browsing models
 *    sends no credential.
 *  - It is never logged, never written into a run summary, and never included
 *    in an exported training example. `RunProvenance` carries the model *name*,
 *    not the key.
 *  - localStorage is not secure storage. It is readable by any script on this
 *    origin. That is an acceptable trade for a local dev workbench; it is
 *    stated in the UI rather than hidden.
 *  - If OPENROUTER_API_KEY is set in the dev server's environment (process env
 *    or a local .env), vite inlines it as the FALLBACK key — used only when
 *    nothing is stored in localStorage. A saved key always wins; Clear returns
 *    to the env key rather than to nothing.
 */

declare const __OPENROUTER_API_KEY__: string;

/** Env-seeded key (vite define), empty string when the dev server had none. */
const ENV_KEY: string =
  typeof __OPENROUTER_API_KEY__ === 'string' ? __OPENROUTER_API_KEY__ : '';

/** Where the active key came from — the UI states this rather than implying it. */
export type KeySource = 'stored' | 'env' | null;

const KEY_STORAGE = 'idleScreens.evals.openrouterKey';
const MODELS_STORAGE = 'idleScreens.evals.openrouterModels';
const MODELS_TTL_MS = 24 * 60 * 60 * 1000;

const MODELS_URL = 'https://openrouter.ai/api/v1/models';
const KEY_URL = 'https://openrouter.ai/api/v1/key';

export interface OpenRouterModel {
  /** Canonical `provider/model` id, e.g. `anthropic/claude-opus-4`. */
  id: string;
  name: string;
  /** Derived from the id — never a second free-text field. */
  provider: string;
  contextLength?: number;
}

export interface KeyStatus {
  ok: boolean;
  /** Human-readable outcome for the dialog; never contains the key. */
  message: string;
  label?: string;
}

/**
 * Applied to every OpenRouter request.
 *
 * `credentials: 'omit'` stops any ambient cookie for the origin riding along;
 * `referrerPolicy: 'no-referrer'` stops the page URL (which can carry saver ids
 * and run labels) being disclosed to a third party. Neither is needed for the
 * API to work, so there is no reason to send them.
 */
const SAFE_FETCH = { credentials: 'omit', referrerPolicy: 'no-referrer' } as const satisfies RequestInit;

/**
 * OpenRouter keys are `sk-or-v1-<hex>`. Checking the shape before storing turns
 * the commonest mistakes — pasting a different provider's key, a whole curl
 * command, or a stray newline — into an immediate, explicit error instead of an
 * opaque 401 later. It is a usability guard, not a security boundary.
 */
const KEY_SHAPE = /^sk-or-v1-[A-Za-z0-9]{16,}$/;

export function looksLikeKey(key: string): boolean {
  return KEY_SHAPE.test(key.trim());
}

// ---------------------------------------------------------------------------
// key storage

function safeLocal(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null; // private mode / blocked storage
  }
}

export function getKey(): string {
  return safeLocal()?.getItem(KEY_STORAGE) || ENV_KEY;
}

export function keySource(): KeySource {
  if (safeLocal()?.getItem(KEY_STORAGE)) return 'stored';
  return ENV_KEY ? 'env' : null;
}

export function setKey(key: string): void {
  const trimmed = key.trim();
  if (!trimmed) return clearKey();
  safeLocal()?.setItem(KEY_STORAGE, trimmed);
}

export function clearKey(): void {
  safeLocal()?.removeItem(KEY_STORAGE);
}

export function hasKey(): boolean {
  return getKey().length > 0;
}

/** `sk-or-v1-…a91f` — safe to render; used instead of ever showing the value. */
export function maskKey(key = getKey()): string {
  if (!key) return '';
  if (key.length <= 12) return '••••';
  return `${key.slice(0, 8)}…${key.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// model catalogue

interface CachedModels {
  fetchedAt: number;
  models: OpenRouterModel[];
}

export function providerOf(modelId: string): string {
  const slash = modelId.indexOf('/');
  return slash > 0 ? modelId.slice(0, slash) : '';
}

function readCache(): CachedModels | null {
  const raw = safeLocal()?.getItem(MODELS_STORAGE);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CachedModels;
    if (!Array.isArray(parsed.models)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Cached catalogue without touching the network — used to paint immediately. */
export function cachedModels(): OpenRouterModel[] {
  return readCache()?.models ?? [];
}

/**
 * Fetch the public model catalogue. No credential is sent — this endpoint is
 * unauthenticated, so browsing models never exposes the key.
 */
export async function fetchModels(opts: { force?: boolean } = {}): Promise<OpenRouterModel[]> {
  const cache = readCache();
  if (!opts.force && cache && Date.now() - cache.fetchedAt < MODELS_TTL_MS && cache.models.length) {
    return cache.models;
  }
  const res = await fetch(MODELS_URL, {
    headers: { accept: 'application/json' },
    ...SAFE_FETCH,
  });
  if (!res.ok) throw new Error(`OpenRouter models: HTTP ${res.status}`);
  const body = (await res.json()) as { data?: Array<{ id?: string; name?: string; context_length?: number }> };
  const models: OpenRouterModel[] = (body.data ?? [])
    .filter((m): m is { id: string; name?: string; context_length?: number } => typeof m.id === 'string')
    .map((m) => ({
      id: m.id,
      name: m.name ?? m.id,
      provider: providerOf(m.id),
      contextLength: m.context_length,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  safeLocal()?.setItem(MODELS_STORAGE, JSON.stringify({ fetchedAt: Date.now(), models } satisfies CachedModels));
  return models;
}

/**
 * Verify the stored key. This is the only call that transmits it, and it only
 * happens when the user asks for it.
 */
export async function verifyKey(key = getKey()): Promise<KeyStatus> {
  if (!key) return { ok: false, message: 'No key stored.' };
  try {
    const res = await fetch(KEY_URL, {
      headers: { Authorization: `Bearer ${key}` },
      ...SAFE_FETCH,
    });
    if (res.status === 401) return { ok: false, message: 'Rejected — OpenRouter says this key is invalid.' };
    if (!res.ok) return { ok: false, message: `Could not verify (HTTP ${res.status}).` };
    const body = (await res.json()) as { data?: { label?: string; usage?: number; limit?: number | null } };
    const label = body.data?.label;
    const usage = body.data?.usage;
    const limit = body.data?.limit;
    const spend =
      typeof usage === 'number'
        ? ` · used $${usage.toFixed(2)}${typeof limit === 'number' ? ` of $${limit.toFixed(2)}` : ''}`
        : '';
    return { ok: true, message: `Key valid${spend}.`, label };
  } catch {
    // Network/CORS failures must not be reported as an invalid key.
    return { ok: false, message: 'Could not reach OpenRouter (offline or blocked).' };
  }
}

// ---------------------------------------------------------------------------
// chat completions (agent-loop eval runs)

const CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';

export interface ChatToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ChatToolCall[];
  tool_call_id?: string;
}

export interface ChatToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ChatToolDef[];
  signal?: AbortSignal;
}

export interface ChatResponse {
  content: string | null;
  toolCalls: ChatToolCall[];
}

/** OpenRouter failure with a machine-readable kind for the UI to branch on. */
export class ChatError extends Error {
  constructor(
    readonly kind: 'auth' | 'rate' | 'http' | 'network',
    message: string,
  ) {
    super(message);
    this.name = 'ChatError';
  }
}

/**
 * One chat completion round-trip. This is the ONLY other call that transmits
 * the key, and it only happens when the user explicitly starts an agent run.
 * The key never enters messages, artifacts, trajectories, or exports — those
 * record the model's name, never the credential.
 */
export async function chatCompletion(req: ChatRequest): Promise<ChatResponse> {
  const key = getKey();
  if (!key) throw new ChatError('auth', 'No OpenRouter key — add one in Settings.');
  let res: Response;
  try {
    res = await fetch(CHAT_URL, {
      method: 'POST',
      ...SAFE_FETCH,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: req.model,
        messages: req.messages,
        ...(req.tools?.length ? { tools: req.tools } : {}),
      }),
      signal: req.signal ?? null,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ChatError('network', 'Could not reach OpenRouter (offline or blocked).');
  }
  if (res.status === 401) throw new ChatError('auth', 'OpenRouter rejected the key — check Settings.');
  if (res.status === 429) throw new ChatError('rate', 'Rate limited by OpenRouter — wait and retry.');
  if (!res.ok) throw new ChatError('http', `OpenRouter chat: HTTP ${res.status}`);
  const body = (await res.json()) as {
    choices?: Array<{ message?: { content?: string | null; tool_calls?: ChatToolCall[] } }>;
  };
  const msg = body.choices?.[0]?.message;
  return { content: msg?.content ?? null, toolCalls: msg?.tool_calls ?? [] };
}
