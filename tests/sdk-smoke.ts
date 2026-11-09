import assert from "node:assert/strict";
import * as sdk from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { createBtw } from "../extensions/pi-btw/btw.ts";

export default function (pi: sdk.ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    try {
      let turn = 0;
      const model = ctx.modelRegistry.find("anthropic", "claude-sonnet-4-5");
      assert.ok(model, "Smoke model must be present in Pi's built-in catalog");
      const service = createBtw(
        pi,
        {
          ...sdk,
          createAgentSession: async (options) => {
            const result = await sdk.createAgentSession(options);
            const session = result.session;
            assert.deepEqual(session.getActiveToolNames().sort(), [
              "find",
              "grep",
              "ls",
              "read",
            ]);
            assert.equal(session.sessionManager.getSessionFile(), undefined);
            if (turn)
              assert.match(JSON.stringify(session.messages), /Smoke answer 1/);
            session.prompt = async (question) => {
              turn++;
              session.sessionManager.appendMessage({
                role: "user",
                content: question,
                timestamp: Date.now(),
              });
              session.sessionManager.appendMessage({
                role: "assistant",
                content: [{ type: "text", text: `Smoke answer ${turn}` }],
                api: model.api,
                provider: model.provider,
                model: model.id,
                stopReason: "stop",
                timestamp: Date.now(),
                usage: {
                  input: 0,
                  output: 0,
                  cacheRead: 0,
                  cacheWrite: 0,
                  totalTokens: 0,
                  cost: {
                    input: 0,
                    output: 0,
                    cacheRead: 0,
                    cacheWrite: 0,
                    total: 0,
                  },
                },
              });
            };
            session.getLastAssistantText = () => `Smoke answer ${turn}`;
            return result;
          },
        },
        Text,
      );
      const context = { ...ctx, model };
      const first = await service.ask(
        "Smoke question",
        context,
        new AbortController().signal,
      );
      const second = await service.ask(
        "Smoke follow-up",
        context,
        new AbortController().signal,
        first.id,
      );
      assert.equal(second.exchanges.length, 2);
      assert.deepEqual(service.getThread(first.id, context), second);
      assert.equal(
        sdk.buildSessionContext(ctx.sessionManager.getBranch()).messages.length,
        0,
      );
      console.log("BTW_THREAD_SDK_SMOKE_OK");
    } catch (error) {
      console.error("BTW_THREAD_SDK_SMOKE_FAILED", error);
      process.exitCode = 1;
    } finally {
      ctx.shutdown();
    }
  });
}
