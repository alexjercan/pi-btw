import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Model } from "@earendil-works/pi-ai";

export const SETTINGS_KEY = "btw";
export const THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
export type BtwThinkingLevel = (typeof THINKING_LEVELS)[number];

/** The `btw` key of Pi's settings.json. Project settings override global ones. */
export interface BtwSettings {
  /** `provider/model-id`, or a bare model ID from the available catalogue. */
  model?: string;
  thinkingLevel?: BtwThinkingLevel;
}

export interface ModelSource {
  getAvailable(): Model<any>[];
  find(provider: string, modelId: string): Model<any> | undefined;
}

/** Global settings first, then the project file, so the project wins. */
export function settingsPaths(cwd: string, agentDir: string): string[] {
  return [join(agentDir, "settings.json"), join(cwd, ".pi", "settings.json")];
}

function parse(raw: unknown, path: string): BtwSettings {
  if (raw === undefined) return {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`${path}: "${SETTINGS_KEY}" must be an object`);
  }
  const { model, thinkingLevel } = raw as Record<string, unknown>;
  const settings: BtwSettings = {};
  if (model !== undefined) {
    if (typeof model !== "string" || !model.trim()) {
      throw new Error(`${path}: "${SETTINGS_KEY}.model" must be a model ID`);
    }
    settings.model = model.trim();
  }
  if (thinkingLevel !== undefined) {
    if (
      typeof thinkingLevel !== "string" ||
      !(THINKING_LEVELS as readonly string[]).includes(thinkingLevel)
    ) {
      throw new Error(
        `${path}: "${SETTINGS_KEY}.thinkingLevel" must be one of ${THINKING_LEVELS.join(", ")}`,
      );
    }
    settings.thinkingLevel = thinkingLevel as BtwThinkingLevel;
  }
  return settings;
}

/** Read and merge the `btw` key from each settings file that exists. */
export function readBtwSettings(paths: string[]): BtwSettings {
  let settings: BtwSettings = {};
  for (const path of paths) {
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (error) {
      throw new Error(`${path}: ${String(error)}`);
    }
    const section =
      typeof json === "object" && json !== null && !Array.isArray(json)
        ? (json as Record<string, unknown>)[SETTINGS_KEY]
        : undefined;
    settings = { ...settings, ...parse(section, path) };
  }
  return settings;
}

/**
 * Resolve the configured BTW model. Without a setting the main Pi model is
 * used. A bare ID prefers the main model's provider when several match.
 */
export function resolveModel(
  setting: string | undefined,
  models: ModelSource,
  fallback: Model<any> | undefined,
): Model<any> {
  if (!setting) {
    if (!fallback) throw new Error("No Pi model selected");
    return fallback;
  }
  const slash = setting.indexOf("/");
  if (slash > 0) {
    const model = models.find(
      setting.slice(0, slash),
      setting.slice(slash + 1),
    );
    if (!model) throw new Error(`BTW model is not available: ${setting}`);
    return model;
  }
  const matches = models.getAvailable().filter((model) => model.id === setting);
  const model =
    matches.find((candidate) => candidate.provider === fallback?.provider) ??
    matches[0];
  if (!model) throw new Error(`BTW model is not available: ${setting}`);
  return model;
}
