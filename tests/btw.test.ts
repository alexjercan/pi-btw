import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import {
  createBtw,
  registerBtwCommand,
  type AnswerBtw,
  type BtwThread,
} from "../extensions/pi-btw/btw.ts";
import type { BtwSettings } from "../extensions/pi-btw/settings.ts";

function serviceHarness() {
  const branch: any[] = [
    { type: "message", message: { role: "user", content: "Main task" } },
  ];
  const resources: any[] = [],
    options: any[] = [];
  let snapshots = 0,
    disposed = 0,
    aborted = 0;
  let error: string | undefined;
  let wait: (() => Promise<void>) | undefined;
  let renderer: Function;
  const pi = {
    registerEntryRenderer(_type: string, render: Function) {
      renderer = render;
    },
    appendEntry(customType: string, data: unknown) {
      branch.push({ type: "custom", customType, data: structuredClone(data) });
    },
    sendUserMessage() {
      assert.fail("Side questions must not steer the main agent");
    },
  };
  class Text {
    text: string;
    constructor(text: string) {
      this.text = text;
    }
  }
  const sdk = {
    getAgentDir: () => "/agent",
    buildSessionContext(snapshot: unknown) {
      snapshots++;
      assert.deepEqual(snapshot, branch);
      assert.notEqual(snapshot, branch);
      return { messages: [] };
    },
    convertToLlm: () => [],
    serializeConversation: () => "Main task snapshot",
    SettingsManager: { inMemory: () => ({}) },
    SessionManager: {
      inMemory(cwd: string, _options?: unknown, history?: any[]) {
        const entries = structuredClone(
          history ?? [{ type: "session", id: "side-session", cwd }],
        );
        return {
          appendMessage(message: any) {
            entries.push({ type: "message", message });
          },
          getHeader: () => entries[0],
          getEntries: () => entries.slice(1),
        };
      },
    },
    DefaultResourceLoader: class {
      constructor(config: unknown) {
        resources.push(config);
      }
      async reload() {}
    },
    async createAgentSession(config: any) {
      options.push(config);
      const messages: any[] = [];
      return {
        session: {
          async prompt(text: string) {
            config.sessionManager.appendMessage({
              role: "user",
              content: text,
            });
            if (wait) await wait();
            // Keep a tool result as well as the visible answer, as the real SDK does.
            config.sessionManager.appendMessage({
              role: "toolResult",
              content: "Read-only file inspection",
            });
            messages.push({
              role: "assistant",
              stopReason: error ? "error" : "stop",
              errorMessage: error,
            });
            config.sessionManager.appendMessage(messages.at(-1));
          },
          messages,
          getLastAssistantText: () => `Answer ${options.length}`,
          async abort() {
            aborted++;
          },
          dispose() {
            disposed++;
          },
        },
      };
    },
  };
  const models = [
    { id: "main", provider: "anthropic" },
    { id: "gpt-6-luna", provider: "openai" },
    { id: "gpt-6-luna", provider: "openai-codex" },
  ];
  const ctx = {
    cwd: "/project",
    model: models[0],
    modelRegistry: {
      getAvailable: () => models,
      find: (provider: string, id: string) =>
        models.find((model) => model.provider === provider && model.id === id),
    },
    sessionManager: {
      getBranch: () => branch,
      getSessionId: () => "main-session",
    },
  } as never;
  let settings: BtwSettings = {};
  const loads: string[] = [];
  const create = () =>
    createBtw(pi as never, sdk as never, Text as never, (context) => {
      loads.push((context as any).cwd);
      return settings;
    });
  return {
    ctx,
    branch,
    resources,
    options,
    create,
    loads,
    setSettings(value: BtwSettings) {
      settings = value;
    },
    get snapshots() {
      return snapshots;
    },
    get disposed() {
      return disposed;
    },
    get aborted() {
      return aborted;
    },
    setError(value: string) {
      error = value;
    },
    setWait(value: () => Promise<void>) {
      wait = value;
    },
    render(data: unknown) {
      return renderer!(
        { data },
        { expanded: false },
        { fg: (_: string, text: string) => text },
      ).text;
    },
  };
}

test("BTW persists thread IDs and full read-only history, and restores follow-ups after reload", async () => {
  const h = serviceHarness();
  const service = h.create();
  const first = await service.ask(
    "Why?\n\n/project/code.ts:4",
    h.ctx,
    new AbortController().signal,
  );
  assert.match(first.id, /^btw-[a-f0-9]{8}$/);
  assert.deepEqual(first.exchanges, [
    { question: "Why?\n\n/project/code.ts:4", answer: "Answer 1" },
  ]);
  assert.deepEqual(h.options[0].tools, ["read", "grep", "find", "ls"]);
  assert.equal(h.options[0].model, (h.ctx as any).model);
  assert.equal(h.options[0].thinkingLevel, "off");
  assert.deepEqual(h.loads, ["/project"]);
  for (const key of [
    "noExtensions",
    "noSkills",
    "noPromptTemplates",
    "noThemes",
    "noContextFiles",
  ]) {
    assert.equal(h.resources[0][key], true, key);
  }
  assert.match(
    h.resources[0].systemPromptOverride(),
    /Do not continue its task or make changes/,
  );
  assert.match(
    JSON.stringify(h.options[0].sessionManager.getEntries()),
    /Main task snapshot/,
  );
  const card = h.render(h.branch.at(-1).data);
  assert.match(card, new RegExp(`BTW ${first.id}`));
  assert.match(card, new RegExp(`/btw ${first.id}`));
  assert.match(card, /Why\?\n\n\/project\/code\.ts:4\n\nAnswer 1$/);
  assert.doesNotMatch(card, /expand/, "Cards show the full answer for copying");
  first.exchanges[0]!.answer = "Tampered";
  assert.equal(
    service.getThread(first.id, h.ctx).exchanges[0]!.answer,
    "Answer 1",
  );

  const reloaded = h.create();
  const next = await reloaded.ask(
    "How can we improve it?",
    h.ctx,
    new AbortController().signal,
    first.id,
  );
  assert.equal(next.id, first.id);
  assert.equal(next.exchanges.length, 2);
  assert.equal(
    h.snapshots,
    1,
    "Follow-ups must not take a new main-conversation snapshot",
  );
  assert.match(
    JSON.stringify(h.options[1].sessionManager.getEntries()),
    /Read-only file inspection/,
  );
  assert.equal(
    h.disposed,
    2,
    "Idle threads must not retain live SDK resources",
  );
  assert.deepEqual(reloaded.getThread(first.id, h.ctx), next);
  assert.deepEqual(reloaded.listThreads(h.ctx), [
    { id: first.id, question: "Why?\n\n/project/code.ts:4" },
  ]);

  const other = await reloaded.ask(
    "Another topic",
    h.ctx,
    new AbortController().signal,
  );
  assert.notEqual(other.id, first.id);
  assert.equal(other.exchanges.length, 1);
  h.branch.splice(1);
  assert.deepEqual(reloaded.listThreads(h.ctx), []);
  assert.throws(
    () => reloaded.getThread(first.id, h.ctx),
    /Unknown BTW thread/,
  );
  await assert.rejects(
    reloaded.ask("Follow up", h.ctx, new AbortController().signal, first.id),
    /Unknown BTW thread/,
  );
});

test("BTW applies the configured model and thinking level per question and keeps tools read-only", async () => {
  const h = serviceHarness();
  const service = h.create();
  h.setSettings({ model: "gpt-6-luna", thinkingLevel: "medium" });
  const first = await service.ask("Why?", h.ctx, new AbortController().signal);
  assert.deepEqual(h.options[0].model, {
    id: "gpt-6-luna",
    provider: "openai",
  });
  assert.equal(h.options[0].thinkingLevel, "medium");
  assert.deepEqual(h.options[0].tools, ["read", "grep", "find", "ls"]);
  assert.equal(h.resources[0].noSkills, true);

  h.setSettings({ model: "openai-codex/gpt-6-luna", thinkingLevel: "high" });
  await service.ask("Again?", h.ctx, new AbortController().signal, first.id);
  assert.deepEqual(h.options[1].model, {
    id: "gpt-6-luna",
    provider: "openai-codex",
  });
  assert.equal(h.options[1].thinkingLevel, "high");

  h.setSettings({ model: "missing-model" });
  await assert.rejects(
    service.ask("Lost?", h.ctx, new AbortController().signal),
    /BTW model is not available: missing-model/,
  );
  assert.equal(h.options.length, 2, "Unavailable models must not start work");
  assert.equal(
    h.branch.filter((entry) => entry.type === "custom").length,
    2,
    "Configuration errors are not recorded as thread exchanges",
  );

  h.setSettings({});
  await assert.rejects(
    service.ask(
      "Why?",
      { ...(h.ctx as any), model: undefined },
      new AbortController().signal,
    ),
    /No Pi model selected/,
  );
});

test("BTW rejects concurrent follow-ups and cancels without changing the saved thread", async () => {
  const h = serviceHarness();
  const service = h.create();
  const first = await service.ask("Why?", h.ctx, new AbortController().signal);
  let release: () => void;
  h.setWait(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const controller = new AbortController();
  const pending = service.ask("Follow up", h.ctx, controller.signal, first.id);
  await setImmediate();
  await assert.rejects(
    service.ask("Concurrent", h.ctx, controller.signal, first.id),
    /still answering/,
  );
  assert.throws(() => service.getThread(first.id, h.ctx), /still answering/);
  controller.abort();
  release!();
  await assert.rejects(pending, /abort/i);
  assert.equal(h.aborted, 1);
  assert.equal(h.disposed, 2);
  assert.deepEqual(service.getThread(first.id, h.ctx), first);
});

test("BTW failures remain UI-only and preserve the thread for retry", async () => {
  const h = serviceHarness();
  const service = h.create();
  h.setError("Rate limited");
  await assert.rejects(
    service.ask("Why?", h.ctx, new AbortController().signal),
    /Rate limited/,
  );
  const record = h.branch.at(-1).data;
  assert.equal(record.error, "Error: Rate limited");
  assert.match(record.thread.id, /^btw-/);
  assert.equal(
    service.getThread(record.thread.id, h.ctx).exchanges[0]!.error,
    "Error: Rate limited",
  );
  assert.equal(h.disposed, 1);
});

function commandHarness(answer: AnswerBtw) {
  let command: Parameters<ExtensionAPI["registerCommand"]>[1];
  let shutdown: (event: unknown, ctx: ExtensionCommandContext) => Promise<void>;
  const notices: string[] = [],
    statuses: Array<string | undefined> = [];
  const ctx = {
    mode: "tui",
    isIdle: () => false,
    ui: {
      notify: (text: string) => notices.push(text),
      setStatus: (_key: string, text: string | undefined) =>
        statuses.push(text),
    },
  } as unknown as ExtensionCommandContext;
  registerBtwCommand(
    {
      registerCommand(name: string, options: typeof command) {
        assert.equal(name, "btw");
        command = options;
      },
      on(name: string, handler: typeof shutdown) {
        assert.equal(name, "session_shutdown");
        shutdown = handler;
      },
      sendUserMessage() {
        assert.fail("Command must not steer the main agent");
      },
      sendMessage() {
        assert.fail("Command must not add model context");
      },
    } as never,
    {
      ask: answer,
      listThreads() {
        return [];
      },
      getThread() {
        assert.fail("Unexpected lookup");
      },
    },
  );
  return {
    ctx,
    notices,
    statuses,
    run: (args: string) => command!.handler(args, ctx),
    shutdown: () => shutdown!({}, ctx),
  };
}

test("/btw starts background questions and routes explicit thread follow-ups", async () => {
  let resolveAnswer: (thread: BtwThread) => void;
  const requests: Array<{ question: string; threadId?: string }> = [];
  const harness = commandHarness(async (question, ctx, signal, threadId) => {
    requests.push({ question, threadId });
    assert.equal(ctx, harness.ctx);
    assert.equal(signal.aborted, false);
    return new Promise<BtwThread>((resolve) => {
      resolveAnswer = resolve;
    });
  });
  try {
    await harness.run("  Why?  ");
    assert.deepEqual(requests[0], { question: "Why?", threadId: undefined });
    assert.deepEqual(harness.statuses, ["btw:1 running"]);
    resolveAnswer!({ id: "btw-12345678", exchanges: [] });
    await setImmediate();
    await harness.run("btw-12345678  And how? ");
    assert.deepEqual(requests[1], {
      question: "And how?",
      threadId: "btw-12345678",
    });
    resolveAnswer!({ id: "btw-12345678", exchanges: [] });
    await setImmediate();
    assert.equal(harness.statuses.at(-1), undefined);
    assert.deepEqual(harness.notices, []);
  } finally {
    await harness.shutdown();
  }
});

test("/btw validates input, limits concurrency, and cancels on session shutdown", async () => {
  const signals: AbortSignal[] = [];
  const harness = commandHarness(async (_question, _ctx, signal) => {
    signals.push(signal);
    return new Promise<BtwThread>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("Cancelled")), {
        once: true,
      });
    });
  });
  try {
    await harness.run("  ");
    await harness.run("btw-12345678");
    await harness.run("x".repeat(64 * 1024 + 1));
    assert.equal(signals.length, 0);
    assert.match(harness.notices[0]!, /Usage: \/btw/);
    assert.match(harness.notices[2]!, /too long/);
    for (let i = 0; i < 4; i++) await harness.run(`Question ${i}`);
    assert.equal(signals.length, 3);
    assert.match(harness.notices.at(-1)!, /Too many/);
    await harness.shutdown();
    assert.ok(signals.every((signal) => signal.aborted));
    const statusCount = harness.statuses.length,
      noticeCount = harness.notices.length;
    await setImmediate();
    assert.equal(harness.statuses.at(-1), undefined);
    assert.equal(harness.statuses.length, statusCount);
    assert.equal(harness.notices.length, noticeCount);
  } finally {
    await harness.shutdown();
  }
});

test("/btw reports failures and times out side work after two minutes", async (t) => {
  const failed = commandHarness(async () => {
    throw new Error("Unknown BTW thread");
  });
  await failed.run("btw-12345678 Why?");
  await setImmediate();
  assert.deepEqual(failed.notices, ["Error: Unknown BTW thread"]);
  assert.equal(failed.statuses.at(-1), undefined);
  await failed.shutdown();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let signal: AbortSignal;
  const harness = commandHarness(async (_question, _ctx, questionSignal) => {
    signal = questionSignal;
    return new Promise<BtwThread>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), {
        once: true,
      });
    });
  });
  try {
    await harness.run("Why?");
    t.mock.timers.tick(120000);
    await setImmediate();
    assert.equal(signal!.aborted, true);
    assert.deepEqual(harness.notices, ["BTW question timed out"]);
    assert.equal(harness.statuses.at(-1), undefined);
  } finally {
    await harness.shutdown();
  }
});
