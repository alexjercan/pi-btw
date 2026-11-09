import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { formatBtwRequest, type BtwService } from "./btw.ts";

const OPTION = "@pi_nvim_socket";
const MAX_MESSAGE = 64 * 1024;

type Request = {
  id: string;
  message: string;
  kind?: "prompt" | "btw" | "btw-open" | "btw-promote" | "info" | "btw-list";
  threadId?: string;
};

function tmux(...args: string[]): string {
  return execFileSync("tmux", args, { encoding: "utf8" }).trim();
}

export function createBridge(pi: ExtensionAPI, btw: BtwService) {
  let server: Server | undefined;
  let directory: string | undefined;
  let pane: string | undefined;
  let socketPath: string | undefined;
  const clients = new Set<Socket>();
  const pending = new Map<Socket, Request & { queued: boolean }>();
  const questions = new Map<Socket, AbortController>();

  function reply(socket: Socket, data: object) {
    if (!socket.destroyed) socket.write(JSON.stringify(data) + "\n");
  }

  async function stop(ctx: ExtensionContext) {
    if (ctx.mode === "tui") ctx.ui.setStatus("btw-bridge", undefined);
    for (const controller of questions.values()) controller.abort();
    questions.clear();
    for (const socket of clients) socket.destroy();
    clients.clear();
    pending.clear();
    if (pane && socketPath) {
      try {
        if (
          tmux("show-options", "-p", "-v", "-t", pane, OPTION) === socketPath
        ) {
          tmux("set-option", "-p", "-u", "-t", pane, OPTION);
        }
      } catch {
        // The pane may have closed already.
      }
    }
    if (server)
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    if (directory) rmSync(directory, { recursive: true, force: true });
    server = undefined;
    directory = undefined;
    socketPath = undefined;
    pane = undefined;
  }

  pi.on("session_start", async (_event, ctx) => {
    if (ctx.mode !== "tui" || !process.env.TMUX_PANE) return;
    await stop(ctx);
    try {
      pane = process.env.TMUX_PANE;
      if (tmux("display-message", "-p", "-t", pane, "#{pane_id}") !== pane) {
        throw new Error("Pi's tmux pane is unavailable");
      }
      if (!process.env.XDG_RUNTIME_DIR)
        throw new Error("XDG_RUNTIME_DIR is required");
      if (!process.getuid)
        throw new Error("The Neovim bridge requires a Unix host");
      const root = join(
        process.env.XDG_RUNTIME_DIR,
        `pi-nvim-${process.getuid()}`,
      );
      mkdirSync(root, { recursive: true, mode: 0o700 });
      directory = mkdtempSync(join(root, "bridge-"));
      chmodSync(directory, 0o700);
      socketPath = join(directory, "socket");

      server = createServer((socket) => {
        clients.add(socket);
        let buffer = "";
        socket.setTimeout(10000, () => {
          if (!pending.has(socket) && !questions.has(socket)) socket.destroy();
        });
        socket.on("data", (chunk: Buffer) => {
          if (pending.has(socket) || questions.has(socket)) return;
          buffer += chunk.toString("utf8");
          if (Buffer.byteLength(buffer) > MAX_MESSAGE) {
            reply(socket, { status: "error", error: "Message is too long" });
            socket.end();
            return;
          }
          const newline = buffer.indexOf("\n");
          if (newline < 0) return;
          try {
            const request = JSON.parse(buffer.slice(0, newline)) as Request;
            if (
              typeof request.id !== "string" ||
              !request.id ||
              typeof request.message !== "string" ||
              !request.message.trim() ||
              Buffer.byteLength(request.message) > MAX_MESSAGE ||
              (request.kind !== undefined &&
                ![
                  "prompt",
                  "btw",
                  "btw-open",
                  "btw-promote",
                  "info",
                  "btw-list",
                ].includes(request.kind)) ||
              (request.threadId !== undefined &&
                (typeof request.threadId !== "string" ||
                  !/^btw-[a-f0-9]{8}$/.test(request.threadId)))
            ) {
              throw new Error("Invalid prompt");
            }
            if (request.kind === "info" || request.kind === "btw-list") {
              reply(socket, {
                id: request.id,
                status: "done",
                ...(request.kind === "info"
                  ? {
                      info: {
                        pane,
                        cwd: ctx.cwd,
                        sessionId: ctx.sessionManager.getSessionId(),
                      },
                    }
                  : { threads: btw.listThreads(ctx) }),
              });
              socket.end();
              return;
            }
            if (request.kind === "btw-open" || request.kind === "btw-promote") {
              if (!request.threadId)
                throw new Error("BTW thread ID is required");
              const thread = btw.getThread(request.threadId, ctx);
              if (request.kind === "btw-open") {
                reply(socket, { id: request.id, status: "done", thread });
                socket.end();
                return;
              }
              request.message = formatBtwRequest(thread);
            }
            if (request.kind === "btw") {
              if (questions.size >= 3)
                throw new Error("Too many BTW questions in progress");
              const controller = new AbortController();
              questions.set(socket, controller);
              socket.setTimeout(0);
              reply(socket, { id: request.id, status: "running" });
              const timeout = setTimeout(
                () => controller.abort(new Error("BTW question timed out")),
                120000,
              );
              void btw
                .ask(request.message, ctx, controller.signal, request.threadId)
                .then((thread) => {
                  reply(socket, { id: request.id, status: "done", thread });
                })
                .catch((error) => {
                  reply(socket, {
                    id: request.id,
                    status: "error",
                    error: String(error),
                  });
                })
                .finally(() => {
                  clearTimeout(timeout);
                  questions.delete(socket);
                  socket.end();
                });
              return;
            }
            const busy = !ctx.isIdle();
            pi.sendUserMessage(
              request.message,
              busy ? { deliverAs: "followUp" } : undefined,
            );
            pending.set(socket, { ...request, queued: busy });
            socket.setTimeout(0);
            reply(socket, {
              id: request.id,
              status: busy ? "queued" : "running",
            });
          } catch (error) {
            reply(socket, { status: "error", error: String(error) });
            socket.end();
          }
        });
        socket.on("close", () => {
          clients.delete(socket);
          pending.delete(socket);
          questions.get(socket)?.abort();
          questions.delete(socket);
        });
        socket.on("error", () => {});
      });
      await new Promise<void>((resolve, reject) => {
        server!.once("error", reject);
        server!.listen(socketPath, () => {
          server!.removeListener("error", reject);
          resolve();
        });
      });
      chmodSync(socketPath, 0o600);
      tmux("set-option", "-p", "-t", pane, OPTION, socketPath);
      ctx.ui.setStatus("btw-bridge", "btw:ready");
    } catch (error) {
      console.error("Pi Neovim bridge:", error);
      await stop(ctx);
    }
  });

  pi.on("before_agent_start", (event) => {
    for (const [socket, request] of pending) {
      if (request.queued && request.message === event.prompt) {
        request.queued = false;
        reply(socket, { id: request.id, status: "running" });
        break;
      }
    }
  });

  pi.on("agent_settled", () => {
    for (const socket of pending.keys()) {
      reply(socket, { status: "done" });
      socket.end();
    }
    pending.clear();
  });

  pi.on("session_shutdown", async (_event, ctx) => stop(ctx));
}

export default async function (pi: ExtensionAPI) {
  const { default: registerBtw } = await import("./btw.ts");
  createBridge(pi, await registerBtw(pi));
}
