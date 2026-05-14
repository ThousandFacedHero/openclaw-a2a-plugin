/**
 * A2A Protocol plugin entry point for OpenClaw.
 *
 * Exposes the gateway's tools and sub-agents via the A2A protocol so that
 * external orchestrators (e.g. Hermes) can discover and invoke them through
 * a standard Agent Card and JSON-RPC transport.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { definePluginEntry, type OpenClawPluginApi } from "./api.js";

import { buildAgentCard } from "./agent-card.js";
import {
  parseRequest,
  resolveMethod,
  makeErrorResponse,
} from "./jsonrpc.js";
import {
  handleSendMessage,
  handleGetTask,
  handleListTasks,
  handleCancelTask,
} from "./handlers.js";
import type { InvokeAgent } from "./handlers.js";
import {
  handleSendStreamingMessage,
  handleSubscribeToTask,
} from "./streaming.js";
import { TaskStore } from "./task-store.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Read the raw request body from an IncomingMessage and parse it as JSON.
 */
async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Agent runtime bridge
// ---------------------------------------------------------------------------

/**
 * Try to import agentCommandFromIngress from the OpenClaw agent runtime.
 * This will fail in test environments where the SDK is not built —
 * that's fine, the plugin simply won't have a real agent backend.
 */
let agentCommandFromIngress: ((opts: unknown) => Promise<unknown>) | null = null;
try {
  // Dynamic require — SDK may not be available in test/CI
  const mod = require("openclaw/plugin-sdk/agent-runtime");
  agentCommandFromIngress = mod.agentCommandFromIngress ?? null;
} catch {
  // Expected in test environments
}

// ---------------------------------------------------------------------------
// Plugin entry
// ---------------------------------------------------------------------------

export default definePluginEntry({
  id: "a2a",
  name: "A2A Protocol",
  description: "A2A v1 protocol support — exposes OpenClaw as a discoverable A2A agent via JSON-RPC 2.0",
  register(api: OpenClawPluginApi) {
    // Only activate when env var is set
    if (!process.env["OPENCLAW_A2A_ENABLED"]) {
      api.logger.info("[a2a] OPENCLAW_A2A_ENABLED not set, skipping activation");
      return;
    }

    const taskStore = new TaskStore({ ttlMs: 3_600_000 }); // 1 hour TTL

    // Build invokeAgent function using the runtime bridge
    const invokeAgent: InvokeAgent = async (text: string, contextId: string) => {
      if (!agentCommandFromIngress) {
        throw new Error("Agent runtime not available");
      }
      const result = await agentCommandFromIngress({
        message: text,
        sessionKey: contextId,
        runId: `a2a-run-${Date.now()}`,
        deliver: false,
        messageChannel: "a2a",
        bestEffortDeliver: false,
        senderIsOwner: false,
        allowModelOverride: false,
      });

      // Extract text from result payload
      if (!result) return null;
      const r = result as { payloads?: Array<{ text?: string }>; text?: string; error?: string };
      if (Array.isArray(r.payloads)) {
        return r.payloads
          .map((p) => (typeof p.text === "string" ? p.text : ""))
          .filter(Boolean)
          .join("\n\n") || null;
      }
      if (typeof r.text === "string" && r.text) return r.text;
      if (typeof r.error === "string" && r.error) throw new Error(r.error);
      return null;
    };

    // ---- Route 1: agent card discovery ------------------------------------

    api.registerHttpRoute({
      path: "/.well-known/agent-card.json",
      match: "exact",
      auth: "gateway",
      handler: (_req: IncomingMessage, res: ServerResponse) => {
        const gatewayUrl = process.env["OPENCLAW_GATEWAY_URL"] ?? "http://localhost:3000";
        const gatewayName = process.env["OPENCLAW_GATEWAY_NAME"] ?? "OpenClaw Gateway";

        // Collect tool registrations and agent IDs from the runtime
        const toolRegistrations = (api.runtime as Record<string, unknown>)["tools"] as Array<{
          pluginId: string;
          pluginName?: string;
          names: string[];
          factory: () => unknown[];
          optional: boolean;
          source: string;
        }> ?? [];
        const agentIds = (api.runtime as Record<string, unknown>)["agentIds"] as string[] ?? [];

        const card = buildAgentCard({
          gatewayUrl,
          gatewayName,
          toolRegistrations,
          agentIds,
        });

        const body = JSON.stringify(card);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(body);
        return true;
      },
    });

    // ---- Route 2: JSON-RPC endpoint ---------------------------------------

    api.registerHttpRoute({
      path: "/a2a",
      match: "prefix",
      auth: "gateway",
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== "POST") {
          res.writeHead(405, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Method Not Allowed" }));
          return true;
        }

        let body: unknown;
        try {
          body = await readJsonBody(req);
        } catch {
          const errResp = makeErrorResponse(null, -32700, "Parse error");
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(errResp));
          return true;
        }

        const parsed = parseRequest(body as Record<string, unknown>);

        if (parsed.error) {
          const errResp = makeErrorResponse(parsed.id, parsed.error.code, parsed.error.message);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(errResp));
          return true;
        }

        const method = resolveMethod(parsed.method!);
        if (!method) {
          const errResp = makeErrorResponse(parsed.id, -32601, `Unknown method: ${parsed.method}`);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(errResp));
          return true;
        }

        // Dispatch to handlers
        switch (method) {
          case "SendMessage": {
            const resp = await handleSendMessage(parsed.id, parsed.params, taskStore, invokeAgent);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(resp));
            return true;
          }
          case "SendStreamingMessage": {
            await handleSendStreamingMessage(parsed.id, parsed.params, taskStore, invokeAgent, res);
            return true;
          }
          case "GetTask": {
            const resp = handleGetTask(parsed.id, parsed.params, taskStore);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(resp));
            return true;
          }
          case "ListTasks": {
            const resp = handleListTasks(parsed.id, parsed.params, taskStore);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(resp));
            return true;
          }
          case "CancelTask": {
            const resp = handleCancelTask(parsed.id, parsed.params, taskStore);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(resp));
            return true;
          }
          case "SubscribeToTask": {
            handleSubscribeToTask(parsed.id, parsed.params, taskStore, res);
            return true;
          }
          default: {
            const errResp = makeErrorResponse(parsed.id, -32601, `Unknown method: ${method}`);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(errResp));
            return true;
          }
        }
      },
    });

    api.logger.info("[a2a] A2A protocol plugin activated");
  },
});
