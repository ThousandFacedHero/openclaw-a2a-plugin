/**
 * Tests for jsonrpc.ts — JSON-RPC 2.0 parsing, method resolution, response builders.
 */

import { describe, it, expect } from "vitest";
import {
  parseRequest,
  resolveMethod,
  makeErrorResponse,
  makeResultResponse,
  extractUserText,
} from "../jsonrpc.js";

// ---------------------------------------------------------------------------
// parseRequest
// ---------------------------------------------------------------------------

describe("parseRequest", () => {
  it("parses a valid JSON-RPC 2.0 request", () => {
    const result = parseRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "SendMessage",
      params: { message: { parts: [{ text: "hello" }] } },
    });
    expect(result.error).toBeNull();
    expect(result.method).toBe("SendMessage");
    expect(result.id).toBe(1);
    expect(result.params).toEqual({ message: { parts: [{ text: "hello" }] } });
  });

  it("returns error for missing jsonrpc field", () => {
    const result = parseRequest({ id: 1, method: "SendMessage" });
    expect(result.error).not.toBeNull();
    expect(result.error!.code).toBe(-32600);
    expect(result.method).toBeNull();
  });

  it("returns error for missing method field", () => {
    const result = parseRequest({ jsonrpc: "2.0", id: 1 });
    expect(result.error).not.toBeNull();
    expect(result.error!.code).toBe(-32600);
    expect(result.method).toBeNull();
  });

  it("defaults params to empty object when absent", () => {
    const result = parseRequest({ jsonrpc: "2.0", id: 1, method: "GetTask" });
    expect(result.params).toEqual({});
    expect(result.error).toBeNull();
  });

  it("defaults params to empty object when not a dict", () => {
    const result = parseRequest({ jsonrpc: "2.0", id: 1, method: "GetTask", params: "invalid" });
    expect(result.params).toEqual({});
    expect(result.error).toBeNull();
  });

  it("preserves request id even on error", () => {
    const result = parseRequest({ id: 42 });
    expect(result.id).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// resolveMethod
// ---------------------------------------------------------------------------

describe("resolveMethod", () => {
  it("resolves primary method names", () => {
    expect(resolveMethod("SendMessage")).toBe("SendMessage");
    expect(resolveMethod("SendStreamingMessage")).toBe("SendStreamingMessage");
    expect(resolveMethod("GetTask")).toBe("GetTask");
    expect(resolveMethod("ListTasks")).toBe("ListTasks");
    expect(resolveMethod("CancelTask")).toBe("CancelTask");
    expect(resolveMethod("SubscribeToTask")).toBe("SubscribeToTask");
  });

  it("resolves HTTP aliases to canonical names", () => {
    expect(resolveMethod("message/send")).toBe("SendMessage");
    expect(resolveMethod("message/stream")).toBe("SendStreamingMessage");
    expect(resolveMethod("tasks/get")).toBe("GetTask");
    expect(resolveMethod("tasks/list")).toBe("ListTasks");
    expect(resolveMethod("tasks/cancel")).toBe("CancelTask");
    expect(resolveMethod("tasks/subscribe")).toBe("SubscribeToTask");
  });

  it("returns null for unknown methods", () => {
    expect(resolveMethod("Unknown")).toBeNull();
    expect(resolveMethod("foo/bar")).toBeNull();
    expect(resolveMethod("")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// makeErrorResponse / makeResultResponse
// ---------------------------------------------------------------------------

describe("makeErrorResponse", () => {
  it("builds a JSON-RPC 2.0 error response", () => {
    const resp = makeErrorResponse(1, -32600, "Invalid Request");
    expect(resp).toEqual({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32600, message: "Invalid Request" },
    });
  });
});

describe("makeResultResponse", () => {
  it("builds a JSON-RPC 2.0 success response", () => {
    const resp = makeResultResponse(1, { task: { id: "abc" } });
    expect(resp).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: { task: { id: "abc" } },
    });
  });
});

// ---------------------------------------------------------------------------
// extractUserText
// ---------------------------------------------------------------------------

describe("extractUserText", () => {
  it("extracts text from parts array", () => {
    const [text, contextId, taskId] = extractUserText({
      message: { parts: [{ text: "hello" }] },
    });
    expect(text).toBe("hello");
    expect(contextId).toBeNull();
    expect(taskId).toBeNull();
  });

  it("joins text from multiple parts", () => {
    const [text] = extractUserText({
      message: { parts: [{ text: "hello " }, { text: "world" }] },
    });
    expect(text).toBe("hello world");
  });

  it("falls back to message.text when parts has no text", () => {
    const [text] = extractUserText({
      message: { parts: [{ image: "data:..." }], text: "fallback" },
    });
    expect(text).toBe("fallback");
  });

  it("falls back to message.text when no parts key", () => {
    const [text] = extractUserText({
      message: { text: "direct text" },
    });
    expect(text).toBe("direct text");
  });

  it("returns empty text for empty message", () => {
    const [text] = extractUserText({});
    expect(text).toBe("");
  });

  it("extracts context_id from message", () => {
    const [, contextId] = extractUserText({
      message: { parts: [{ text: "hi" }], context_id: "ctx-1" },
    });
    expect(contextId).toBe("ctx-1");
  });

  it("extracts context_id from top-level params as fallback", () => {
    const [, contextId] = extractUserText({
      message: { parts: [{ text: "hi" }] },
      context_id: "ctx-top",
    });
    expect(contextId).toBe("ctx-top");
  });

  it("extracts task_id from message", () => {
    const [, , taskId] = extractUserText({
      message: { parts: [{ text: "hi" }], task_id: "task-1" },
    });
    expect(taskId).toBe("task-1");
  });
});
