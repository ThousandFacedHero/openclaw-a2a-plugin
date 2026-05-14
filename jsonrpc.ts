/**
 * JSON-RPC 2.0 dispatcher for A2A protocol.
 *
 * TypeScript equivalent of the Hermes jsonrpc.py — same semantics,
 * handles method resolution, request parsing, and response formatting.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const METHOD_ALIASES: Record<string, string> = {
  "message/send": "SendMessage",
  "message/stream": "SendStreamingMessage",
  "tasks/get": "GetTask",
  "tasks/list": "ListTasks",
  "tasks/cancel": "CancelTask",
  "tasks/subscribe": "SubscribeToTask",
};

const KNOWN_METHODS = new Set([
  "SendMessage",
  "SendStreamingMessage",
  "GetTask",
  "ListTasks",
  "CancelTask",
  "SubscribeToTask",
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ParsedRequest = {
  method: string | null;
  id: unknown;
  params: Record<string, unknown>;
  error: { code: number; message: string } | null;
};

export type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: unknown;
  result?: unknown;
  error?: { code: number; message: string };
};

// ---------------------------------------------------------------------------
// Request parsing
// ---------------------------------------------------------------------------

/**
 * Parse a JSON-RPC 2.0 request body.
 *
 * Returns an object with method, id, params, and error fields.
 * On parse error, error is set and method is null.
 */
export function parseRequest(body: Record<string, unknown>): ParsedRequest {
  const reqId = body["id"] ?? null;

  if (body["jsonrpc"] !== "2.0") {
    return {
      method: null,
      id: reqId,
      params: {},
      error: { code: -32600, message: "Invalid Request: missing jsonrpc 2.0" },
    };
  }

  const method = body["method"];
  if (method === undefined || method === null || typeof method !== "string") {
    return {
      method: null,
      id: reqId,
      params: {},
      error: { code: -32600, message: "Invalid Request: missing method" },
    };
  }

  let params = body["params"];
  if (params === undefined || params === null || typeof params !== "object" || Array.isArray(params)) {
    params = {};
  }

  return {
    method,
    id: reqId,
    params: params as Record<string, unknown>,
    error: null,
  };
}

// ---------------------------------------------------------------------------
// Method resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a method name to a canonical KNOWN_METHODS entry.
 *
 * Returns the canonical name if found, or null if unknown.
 */
export function resolveMethod(method: string): string | null {
  if (KNOWN_METHODS.has(method)) return method;
  if (method in METHOD_ALIASES) return METHOD_ALIASES[method];
  return null;
}

// ---------------------------------------------------------------------------
// Response builders
// ---------------------------------------------------------------------------

/**
 * Build a JSON-RPC 2.0 error response.
 */
export function makeErrorResponse(id: unknown, code: number, message: string): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message },
  };
}

/**
 * Build a JSON-RPC 2.0 success response.
 */
export function makeResultResponse(id: unknown, result: unknown): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    result,
  };
}

// ---------------------------------------------------------------------------
// Parameter extraction
// ---------------------------------------------------------------------------

/**
 * Extract user text, context_id, and task_id from A2A message params.
 *
 * Returns [userText, contextId, taskId].
 */
export function extractUserText(
  params: Record<string, unknown>,
): [string, string | null, string | null] {
  const message = params["message"] as Record<string, unknown> | undefined;
  if (!message) {
    return ["", null, null];
  }

  // Extract text from parts
  const parts = message["parts"] as Array<Record<string, unknown>> | undefined;
  let userText = "";

  if (parts !== undefined) {
    const textPieces: string[] = [];
    for (const p of parts) {
      if (p && typeof p === "object" && typeof p["text"] === "string") {
        textPieces.push(p["text"] as string);
      }
    }
    userText = textPieces.join("");
    if (!userText) {
      // Fall back to message-level text field if parts had no text
      userText = typeof message["text"] === "string" ? (message["text"] as string) : "";
    }
  } else {
    // No parts key at all — fall back to text field
    userText = typeof message["text"] === "string" ? (message["text"] as string) : "";
  }

  // Extract context_id: message field takes priority over top-level params
  const contextId =
    (typeof message["context_id"] === "string" ? message["context_id"] : null) ||
    (typeof params["context_id"] === "string" ? params["context_id"] : null) ||
    null;

  // Extract task_id: message field takes priority over top-level params
  const taskId =
    (typeof message["task_id"] === "string" ? message["task_id"] : null) ||
    (typeof params["task_id"] === "string" ? params["task_id"] : null) ||
    null;

  return [userText, contextId as string | null, taskId as string | null];
}
