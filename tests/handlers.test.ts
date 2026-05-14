/**
 * Tests for handlers.ts — A2A JSON-RPC request handlers.
 */

import { describe, it, expect, vi } from "vitest";
import {
  handleSendMessage,
  handleGetTask,
  handleListTasks,
  handleCancelTask,
} from "../handlers.js";
import type { InvokeAgent } from "../handlers.js";
import { TaskStore, TASK_STATE_WORKING, TASK_STATE_COMPLETED, TASK_STATE_CANCELED } from "../task-store.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStore(): TaskStore {
  return new TaskStore({ ttlMs: 3_600_000 });
}

function makeInvokeAgent(response: string | null = "agent response"): InvokeAgent {
  return vi.fn(async () => response);
}

function makeFailingInvokeAgent(error: string): InvokeAgent {
  return vi.fn(async () => {
    throw new Error(error);
  });
}

// ---------------------------------------------------------------------------
// handleSendMessage
// ---------------------------------------------------------------------------

describe("handleSendMessage", () => {
  it("creates a task and returns completed result", async () => {
    const store = makeStore();
    const invoke = makeInvokeAgent("done!");
    const resp = await handleSendMessage(1, {
      message: { parts: [{ text: "hello" }] },
    }, store, invoke);

    expect(resp.id).toBe(1);
    expect(resp.result).toBeDefined();
    expect(resp.result.task).toBeDefined();
    expect(resp.result.task.status.state).toBe("TASK_STATE_COMPLETED");
    expect(resp.result.task.artifacts).toHaveLength(1);
    expect(resp.result.task.artifacts[0].parts[0].text).toBe("done!");
  });

  it("returns error response for empty user text", async () => {
    const store = makeStore();
    const invoke = makeInvokeAgent();
    const resp = await handleSendMessage(1, {
      message: { parts: [] },
    }, store, invoke);

    expect(resp.error).toBeDefined();
    expect(resp.error.code).toBe(-32602);
  });

  it("handles agent invocation failure", async () => {
    const store = makeStore();
    const invoke = makeFailingInvokeAgent("agent crashed");
    const resp = await handleSendMessage(1, {
      message: { parts: [{ text: "hello" }] },
    }, store, invoke);

    expect(resp.result).toBeDefined();
    expect(resp.result.task.status.state).toBe("TASK_STATE_FAILED");
  });

  it("handles null agent response as failure", async () => {
    const store = makeStore();
    const invoke = makeInvokeAgent(null);
    const resp = await handleSendMessage(1, {
      message: { parts: [{ text: "hello" }] },
    }, store, invoke);

    expect(resp.result.task.status.state).toBe("TASK_STATE_FAILED");
  });

  it("generates a context_id when not provided", async () => {
    const store = makeStore();
    const invoke = makeInvokeAgent("ok");
    const resp = await handleSendMessage(1, {
      message: { parts: [{ text: "hello" }] },
    }, store, invoke);

    expect(resp.result.task.context_id).toBeDefined();
    expect(typeof resp.result.task.context_id).toBe("string");
    expect(resp.result.task.context_id.length).toBeGreaterThan(0);
  });

  it("passes user text and context_id to invokeAgent", async () => {
    const store = makeStore();
    const invoke = makeInvokeAgent("ok");
    await handleSendMessage(1, {
      message: { parts: [{ text: "hello world" }], context_id: "ctx-abc" },
    }, store, invoke);

    expect(invoke).toHaveBeenCalledWith("hello world", "ctx-abc");
  });
});

// ---------------------------------------------------------------------------
// handleGetTask
// ---------------------------------------------------------------------------

describe("handleGetTask", () => {
  it("returns an existing task", () => {
    const store = makeStore();
    const task = store.create("ctx-1", "hello");
    const resp = handleGetTask(1, { id: task.id }, store);

    expect(resp.result).toBeDefined();
    expect(resp.result.id).toBe(task.id);
  });

  it("returns error for missing task", () => {
    const store = makeStore();
    const resp = handleGetTask(1, { id: "no-such-id" }, store);

    expect(resp.error).toBeDefined();
    expect(resp.error.code).toBe(-32602);
  });

  it("returns error when id param is missing", () => {
    const store = makeStore();
    const resp = handleGetTask(1, {}, store);

    expect(resp.error).toBeDefined();
    expect(resp.error.code).toBe(-32602);
  });
});

// ---------------------------------------------------------------------------
// handleListTasks
// ---------------------------------------------------------------------------

describe("handleListTasks", () => {
  it("returns tasks list", () => {
    const store = makeStore();
    store.create("ctx-1", "a");
    store.create("ctx-1", "b");
    const resp = handleListTasks(1, {}, store);

    expect(resp.result).toBeDefined();
    expect(resp.result.tasks).toHaveLength(2);
  });

  it("supports filtering by context_id", () => {
    const store = makeStore();
    store.create("ctx-A", "a");
    store.create("ctx-B", "b");
    const resp = handleListTasks(1, { context_id: "ctx-A" }, store);

    expect(resp.result.tasks).toHaveLength(1);
    expect(resp.result.tasks[0].context_id).toBe("ctx-A");
  });
});

// ---------------------------------------------------------------------------
// handleCancelTask
// ---------------------------------------------------------------------------

describe("handleCancelTask", () => {
  it("cancels a working task", () => {
    const store = makeStore();
    const task = store.create("ctx-1", "hello");
    store.updateStatus(task.id, TASK_STATE_WORKING);
    const resp = handleCancelTask(1, { id: task.id }, store);

    expect(resp.result).toBeDefined();
    expect(resp.result.status.state).toBe("TASK_STATE_CANCELED");
  });

  it("returns error for missing task", () => {
    const store = makeStore();
    const resp = handleCancelTask(1, { id: "no-such-id" }, store);

    expect(resp.error).toBeDefined();
    expect(resp.error.code).toBe(-32602);
  });

  it("returns error when id param is missing", () => {
    const store = makeStore();
    const resp = handleCancelTask(1, {}, store);

    expect(resp.error).toBeDefined();
    expect(resp.error.code).toBe(-32602);
  });
});
