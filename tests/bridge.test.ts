import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { connect } from "node:net";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { createBridge } from "../extensions/pi-btw/index.ts";

function tmux(...args: string[]) {
  return execFileSync("tmux", args, { encoding: "utf8" }).trim();
}

function readLine(
  socket: ReturnType<typeof connect>,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let text = "";
    socket.on("data", (chunk: Buffer) => {
      text += chunk.toString();
      const newline = text.indexOf("\n");
      if (newline >= 0) resolve(JSON.parse(text.slice(0, newline)));
    });
    socket.once("error", reject);
  });
}

test("routes user messages through the registered Pi pane and reports completion", async () => {
  const session = `pi-nvim-test-${process.pid}`;
  const oldPane = process.env.TMUX_PANE;
  const handlers = new Map<
    string,
    (event: unknown, ctx?: unknown) => unknown
  >();
  const calls: Array<{ message: string; options: unknown }> = [];
  const statuses: Array<{ key: string; text: string | undefined }> = [];
  let idle = true;
  const pi = {
    on(name: string, handler: (event: unknown, ctx?: unknown) => unknown) {
      handlers.set(name, handler);
    },
    sendUserMessage(message: string, options: unknown) {
      calls.push({ message, options });
    },
  };
  const nvimPane = tmux(
    "new-session",
    "-d",
    "-s",
    session,
    "-P",
    "-F",
    "#{pane_id}",
  );
  tmux("new-window", "-d", "-t", `=${session}:7`);
  const pane = tmux(
    "display-message",
    "-p",
    "-t",
    `=${session}:7`,
    "#{pane_id}",
  );
  process.env.TMUX_PANE = pane;
  const ctx = {
    mode: "tui",
    cwd: "/test/project",
    sessionManager: { getSessionId: () => "test-pi-session" },
    isIdle: () => idle,
    ui: {
      setStatus: (key: string, text: string | undefined) =>
        statuses.push({ key, text }),
    },
  };

  try {
    let resolveAnswer: (answer: string) => void;
    let questionSignal: AbortSignal | undefined;
    const thread = (answer: string) => ({
      id: "btw-12345678",
      exchanges: [{ question: "Why?", answer }],
    });
    let followupId: string | undefined;
    createBridge(pi as never, {
      async ask(question, _ctx, signal, threadId) {
        followupId = threadId;
        if (question === "Why example?")
          return thread("A separate read-only answer.");
        questionSignal = signal;
        const answer = await new Promise<string>(
          (resolveAnswerPromise, reject) => {
            resolveAnswer = resolveAnswerPromise;
            signal.addEventListener(
              "abort",
              () => reject(new Error("Cancelled")),
              { once: true },
            );
          },
        );
        return thread(answer);
      },
      listThreads() {
        return [{ id: "btw-12345678", question: "Why?" }];
      },
      getThread(id) {
        if (id !== "btw-12345678") throw new Error("Unknown BTW thread");
        return thread("Complete discussion");
      },
    });
    await handlers.get("session_start")!({}, ctx);
    const path = tmux(
      "show-options",
      "-p",
      "-v",
      "-t",
      pane,
      "@pi_nvim_socket",
    );
    assert.ok(existsSync(path));
    assert.deepEqual(statuses.at(-1), {
      key: "btw-bridge",
      text: "btw:ready",
    });

    for (const kind of ["info", "btw-list"]) {
      const socket = connect(path);
      socket.write(
        JSON.stringify({ id: kind, kind, message: "Inspect" }) + "\n",
      );
      const response = await readLine(socket);
      assert.equal(response.status, "done");
      if (kind === "info")
        assert.deepEqual(response.info, {
          pane,
          cwd: "/test/project",
          sessionId: "test-pi-session",
        });
      else
        assert.deepEqual(response.threads, [
          { id: "btw-12345678", question: "Why?" },
        ]);
      socket.destroy();
    }
    assert.equal(
      Number(calls.length),
      0,
      "Inspection must not prompt the main agent",
    );

    const first = connect(path);
    first.write(
      JSON.stringify({ id: "1", message: "Check file\n\n/tmp/code.lua:4" }) +
        "\n",
    );
    assert.deepEqual(await readLine(first), { id: "1", status: "running" });
    assert.deepEqual(calls[0], {
      message: "Check file\n\n/tmp/code.lua:4",
      options: undefined,
    });
    const completed = readLine(first);
    handlers.get("agent_settled")!({});
    assert.deepEqual(await completed, { status: "done" });
    first.destroy();

    idle = false;
    const second = connect(path);
    second.write(JSON.stringify({ id: "2", message: "Next prompt" }) + "\n");
    assert.deepEqual(await readLine(second), { id: "2", status: "queued" });
    assert.deepEqual(calls[1], {
      message: "Next prompt",
      options: { deliverAs: "followUp" },
    });
    const started = readLine(second);
    handlers.get("before_agent_start")!({ prompt: "Next prompt" });
    assert.deepEqual(await started, { id: "2", status: "running" });
    const queuedDone = readLine(second);
    handlers.get("agent_settled")!({});
    assert.deepEqual(await queuedDone, { status: "done" });
    second.destroy();

    idle = true;
    const temp = mkdtempSync(join(tmpdir(), "pi-nvim-bridge-test-"));
    const script = join(temp, "test.lua");
    writeFileSync(
      script,
      `
      vim.opt.rtp:append(${JSON.stringify(resolve("nvim"))})
      vim.notify = function(message)
        if message == "Pi finished" then vim.g.pi_finished = true else vim.g.pi_error = message end
      end
      local accepted, finished = 0, 0
      require("pi_btw.bridge").send("Review\\n\\n/tmp/example.lua:4", function()
        accepted = accepted + 1
      end, function()
        finished = finished + 1
      end)
      assert(vim.wait(3000, function() return vim.g.pi_finished == true end), vim.g.pi_error or "Pi did not finish")
      assert(accepted == 1, "Acceptance must be reported exactly once")
      assert(finished == 1, "Completion must be reported exactly once")
      local answer
      require("pi_btw.bridge").ask("Why example?", function(thread) answer = thread.exchanges[1].answer end)
      assert(vim.wait(3000, function() return answer ~= nil end), "BTW answer did not arrive")
      assert(answer == "A separate read-only answer.")
      local threads
      require("pi_btw.bridge").list_threads(function(items) threads = items end)
      assert(vim.wait(3000, function() return threads ~= nil end))
      assert(threads[1].id == "btw-12345678")
      local status
      vim.notify = function(message) status = message end
      require("pi_btw.bridge").status()
      assert(vim.wait(3000, function() return status ~= nil end))
      assert(status:find("test-pi-session", 1, true) and status:find("/test/project", 1, true))
    `,
    );
    try {
      const result = new Promise<{ code: number | null; output: string }>(
        (resolveExit) => {
          const child = spawn(
            "nvim",
            [
              "--headless",
              "-u",
              "NONE",
              "-c",
              `luafile ${script}`,
              "-c",
              "qa!",
            ],
            {
              env: { ...process.env, TMUX_PANE: nvimPane },
            },
          );
          let output = "";
          child.stdout.on("data", (data: Buffer) => {
            output += data.toString();
          });
          child.stderr.on("data", (data: Buffer) => {
            output += data.toString();
          });
          child.on("exit", (code) => resolveExit({ code, output }));
        },
      );
      for (let tries = 0; calls.length < 3 && tries < 300; tries++) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
      }
      if (calls.length !== 3) assert.fail((await result).output);
      assert.equal(calls[2]!.message, "Review\n\n/tmp/example.lua:4");
      handlers.get("agent_settled")!({});
      const { code, output } = await result;
      assert.equal(code, 0, output);
      assert.doesNotMatch(
        output,
        /E5113|Pi did not finish|Error in command line/,
      );
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }

    idle = false;
    const question = connect(path);
    question.write(
      JSON.stringify({ id: "btw", kind: "btw", message: "Why this code?" }) +
        "\n",
    );
    assert.deepEqual(await readLine(question), {
      id: "btw",
      status: "running",
    });
    const answered = readLine(question);
    handlers.get("agent_settled")!({});
    assert.equal(
      calls.length,
      3,
      "BTW must not enqueue or steer the main agent",
    );
    resolveAnswer!("Because it is read-only.");
    assert.deepEqual(await answered, {
      id: "btw",
      status: "done",
      thread: thread("Because it is read-only."),
    });
    question.destroy();

    const followup = connect(path);
    followup.write(
      JSON.stringify({
        id: "follow",
        kind: "btw",
        message: "Follow up",
        threadId: "btw-12345678",
      }) + "\n",
    );
    assert.deepEqual(await readLine(followup), {
      id: "follow",
      status: "running",
    });
    assert.equal(followupId, "btw-12345678");
    const followed = readLine(followup);
    resolveAnswer!("More detail");
    assert.deepEqual(await followed, {
      id: "follow",
      status: "done",
      thread: thread("More detail"),
    });
    followup.destroy();

    const reopened = connect(path);
    reopened.write(
      JSON.stringify({
        id: "open",
        kind: "btw-open",
        message: "Open",
        threadId: "btw-12345678",
      }) + "\n",
    );
    assert.deepEqual(await readLine(reopened), {
      id: "open",
      status: "done",
      thread: thread("Complete discussion"),
    });
    reopened.destroy();
    assert.equal(
      calls.length,
      3,
      "Opening and following up must not contact the main agent",
    );

    const cancelled = connect(path);
    cancelled.write(
      JSON.stringify({
        id: "cancel",
        kind: "btw",
        message: "Another question",
      }) + "\n",
    );
    assert.deepEqual(await readLine(cancelled), {
      id: "cancel",
      status: "running",
    });
    await handlers.get("session_shutdown")!({}, ctx);
    assert.equal(
      questionSignal!.aborted,
      true,
      "Shutdown must abort side work",
    );
    cancelled.destroy();
    assert.equal(existsSync(path), false);
    assert.deepEqual(statuses.at(-1), { key: "btw-bridge", text: undefined });
  } finally {
    await handlers.get("session_shutdown")?.({}, ctx);
    tmux("kill-session", "-t", `=${session}`);
    if (oldPane === undefined) delete process.env.TMUX_PANE;
    else process.env.TMUX_PANE = oldPane;
  }
});
