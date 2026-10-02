import { existsSync, readFileSync } from "node:fs";
import {
  type AmemConfig,
  extractEditableConfigPatch,
  llmApiKeySource,
  loadConfig,
  mergeConfigOverlay,
  resolveLlmApiKey,
  validateEditableConfigPatch,
  writeAmemConfigFile,
} from "./config.js";
import { paths } from "./paths.js";

export type SafeConfigView = Omit<AmemConfig, "llm"> & {
  llm: Omit<AmemConfig["llm"], "api_key"> & {
    has_api_key: boolean;
    api_key_source: ReturnType<typeof llmApiKeySource>;
  };
};

export type ConfigDocumentError = {
  ok: false;
  error: string;
  message: string;
};

export type ConfigDocumentOk<T> = { ok: true; data: T };

/** Safe AmemConfig view for Config Panel / admin (never includes api_key). */
export function getSafeConfigView(home: string): ConfigDocumentOk<{
  path: string;
  config: SafeConfigView;
}> {
  const configPath = paths(home).config;
  const raw = loadConfig(home);
  const { api_key: _apiKey, ...llmRest } = raw.llm;
  const config: SafeConfigView = {
    ...raw,
    llm: {
      ...llmRest,
      has_api_key: !!resolveLlmApiKey(raw),
      api_key_source: llmApiKeySource(raw),
    },
  };
  return { ok: true, data: { path: configPath, config } };
}

/**
 * Apply an editable config patch (and optional write-only api_key_replacement),
 * freezing embedding/privacy and preserving on-disk TOML comments.
 */
export function applyEditableConfigPatch(
  home: string,
  body: unknown,
): ConfigDocumentOk<{ path: string; saved: true }> | ConfigDocumentError {
  try {
    const extracted = extractEditableConfigPatch(body);
    if ("error" in extracted) {
      return { ok: false, error: extracted.error, message: extracted.message };
    }
    const validated = validateEditableConfigPatch(extracted);
    if (!validated.ok) {
      return { ok: false, error: validated.error, message: validated.message };
    }
    const base = loadConfig(home);
    const merged = mergeConfigOverlay(base, extracted);
    merged.embedding = base.embedding;
    merged.privacy = base.privacy;

    const apiKeyReplacement =
      body != null && typeof body === "object" && "api_key_replacement" in body
        ? String((body as Record<string, unknown>).api_key_replacement ?? "")
        : "";
    if (apiKeyReplacement) {
      merged.llm.api_key = apiKeyReplacement;
    }

    const configPath = paths(home).config;
    const disk = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
    writeAmemConfigFile(home, merged, disk);
    return { ok: true, data: { path: configPath, saved: true } };
  } catch {
    return { ok: false, error: "internal", message: "internal error" };
  }
}
