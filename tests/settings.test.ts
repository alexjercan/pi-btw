import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  readBtwSettings,
  resolveModel,
  settingsPaths,
} from "../extensions/pi-btw/settings.ts";

test("project settings override the global btw section and invalid values are reported", () => {
  const temp = mkdtempSync(join(tmpdir(), "pi-btw-settings-"));
  try {
    const agentDir = join(temp, "agent");
    const cwd = join(temp, "project");
    mkdirSync(agentDir);
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    const paths = settingsPaths(cwd, agentDir);
    assert.deepEqual(paths, [
      join(agentDir, "settings.json"),
      join(cwd, ".pi", "settings.json"),
    ]);
    assert.deepEqual(readBtwSettings(paths), {}, "Missing files are fine");

    writeFileSync(
      paths[0]!,
      JSON.stringify({
        theme: "dark",
        btw: { model: " gpt-6-luna ", thinkingLevel: "medium" },
      }),
    );
    assert.deepEqual(readBtwSettings(paths), {
      model: "gpt-6-luna",
      thinkingLevel: "medium",
    });

    writeFileSync(paths[1]!, JSON.stringify({ btw: { thinkingLevel: "off" } }));
    assert.deepEqual(readBtwSettings(paths), {
      model: "gpt-6-luna",
      thinkingLevel: "off",
    });

    writeFileSync(
      paths[1]!,
      JSON.stringify({ btw: { thinkingLevel: "deep" } }),
    );
    assert.throws(
      () => readBtwSettings(paths),
      /thinkingLevel.*must be one of/,
    );
    writeFileSync(paths[1]!, JSON.stringify({ btw: { model: 3 } }));
    assert.throws(() => readBtwSettings(paths), /btw\.model/);
    writeFileSync(paths[1]!, JSON.stringify({ btw: [] }));
    assert.throws(() => readBtwSettings(paths), /must be an object/);
    writeFileSync(paths[1]!, "{ not json");
    assert.throws(() => readBtwSettings(paths), /settings\.json: SyntaxError/);
    writeFileSync(paths[1]!, JSON.stringify({ btw: { extra: true } }));
    assert.deepEqual(readBtwSettings(paths), {
      model: "gpt-6-luna",
      thinkingLevel: "medium",
    });
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("models resolve by provider/id or bare id, preferring the main model's provider", () => {
  const models = [
    { id: "main", provider: "anthropic" },
    { id: "gpt-6-luna", provider: "openai" },
    { id: "gpt-6-luna", provider: "openai-codex" },
  ] as never[];
  const source = {
    getAvailable: () => models,
    find: (provider: string, id: string) =>
      models.find(
        (model: any) => model.provider === provider && model.id === id,
      ),
  };
  const main = models[0] as any;
  assert.equal(resolveModel(undefined, source, main), main);
  assert.throws(
    () => resolveModel(undefined, source, undefined),
    /No Pi model/,
  );
  assert.equal(resolveModel("gpt-6-luna", source, main), models[1]);
  assert.equal(
    resolveModel("gpt-6-luna", source, models[2] as any),
    models[2],
    "A bare ID prefers the current provider",
  );
  assert.equal(
    resolveModel("openai-codex/gpt-6-luna", source, main),
    models[2],
  );
  assert.throws(
    () => resolveModel("openai/missing", source, main),
    /not available: openai\/missing/,
  );
  assert.throws(() => resolveModel("missing", source, main), /not available/);
});
