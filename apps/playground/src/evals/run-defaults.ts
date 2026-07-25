/**
 * Run defaults — operator + model, set once on the Settings page and prefilled
 * into every New eval run dialog. localStorage on this origin, same trust
 * model as the OpenRouter key (these are names, not credentials).
 */

const DEFAULTS_STORAGE = 'idleScreens.evals.runDefaults';

export interface RunDefaults {
  operator?: string;
  model?: string;
}

function safeLocal(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function getRunDefaults(): RunDefaults {
  const raw = safeLocal()?.getItem(DEFAULTS_STORAGE);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as RunDefaults;
    return {
      operator: typeof parsed.operator === 'string' ? parsed.operator : undefined,
      model: typeof parsed.model === 'string' ? parsed.model : undefined,
    };
  } catch {
    return {};
  }
}

export function setRunDefaults(next: RunDefaults): void {
  const clean: RunDefaults = {};
  if (next.operator?.trim()) clean.operator = next.operator.trim();
  if (next.model?.trim()) clean.model = next.model.trim();
  safeLocal()?.setItem(DEFAULTS_STORAGE, JSON.stringify(clean));
}
