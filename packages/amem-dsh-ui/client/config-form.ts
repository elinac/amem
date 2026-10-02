/**
 * Config Panel form helpers aligned with server extractEditableConfigPatch.
 * Fingerprint / put body use the same editable field set as applyEditableConfigPatch
 * (llm + budget.consolidate.refine_proposals + write-only api_key_replacement).
 * Display-only fields (has_api_key, api_key_source) are not part of dirty detection.
 */

export type ConfigFormState = {
  path: string | null;
  config: Record<string, unknown>;
  apiKeyReplacement: string;
  /** Fingerprint of the editable put surface as loaded; drives dirty state. */
  baseline: string;
};

export type LlmForm = {
  mode: string;
  base_url: string;
  model: string;
  api_key_env: string;
  has_api_key: boolean;
  api_key_source: "inline" | "env" | "none";
};

/** Editable slice that mirrors what extractEditableConfigPatch accepts from this panel. */
export type EditablePutSlice = {
  llm: {
    mode: string;
    base_url: string;
    model: string;
    api_key_env: string;
  };
  budget: {
    consolidate: {
      refine_proposals: boolean;
    };
  };
};

function asRecord(v: unknown): Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

export function readLlmForm(config: Record<string, unknown>): LlmForm {
  const llm = asRecord(config.llm);
  const hasKey = llm.has_api_key === true;
  const source: LlmForm["api_key_source"] =
    llm.api_key_source === "env"
      ? "env"
      : llm.api_key_source === "inline"
        ? "inline"
        : hasKey
          ? "inline"
          : "none";
  return {
    mode: typeof llm.mode === "string" ? llm.mode : "stub",
    base_url: typeof llm.base_url === "string" ? llm.base_url : "",
    model: typeof llm.model === "string" ? llm.model : "",
    api_key_env: typeof llm.api_key_env === "string" ? llm.api_key_env : "",
    has_api_key: hasKey,
    api_key_source: source,
  };
}

export function readRefineProposals(config: Record<string, unknown>): boolean {
  const consolidate = asRecord(asRecord(config.budget).consolidate);
  return consolidate.refine_proposals === true;
}

/** Build the put-shaped editable slice from a safe config view. */
export function editablePutSlice(config: Record<string, unknown>): EditablePutSlice {
  const llm = readLlmForm(config);
  return {
    llm: {
      mode: llm.mode,
      base_url: llm.base_url,
      model: llm.model,
      api_key_env: llm.api_key_env,
    },
    budget: {
      consolidate: {
        refine_proposals: readRefineProposals(config),
      },
    },
  };
}

export function editableFingerprint(state: ConfigFormState): string {
  return JSON.stringify({
    slice: editablePutSlice(state.config),
    api_key_replacement: state.apiKeyReplacement.trim(),
  });
}

export function isConfigDirty(state: ConfigFormState | null): boolean {
  return state != null && editableFingerprint(state) !== state.baseline;
}

export function patchLlm(
  config: Record<string, unknown>,
  patch: Partial<Pick<LlmForm, "mode" | "base_url" | "model" | "api_key_env">>,
): Record<string, unknown> {
  return { ...config, llm: { ...asRecord(config.llm), ...patch } };
}

export function patchRefineProposals(
  config: Record<string, unknown>,
  refine: boolean,
): Record<string, unknown> {
  const budget = asRecord(config.budget);
  const consolidate = asRecord(budget.consolidate);
  return {
    ...config,
    budget: { ...budget, consolidate: { ...consolidate, refine_proposals: refine } },
  };
}

/** Body for config.put — server re-extracts via extractEditableConfigPatch. */
export function buildConfigPutBody(state: ConfigFormState): {
  config: EditablePutSlice;
  api_key_replacement?: string;
} {
  const slice = editablePutSlice(state.config);
  const replacement = state.apiKeyReplacement.trim();
  return replacement
    ? { config: slice, api_key_replacement: replacement }
    : { config: slice };
}
