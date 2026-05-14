/**
 * A2A JSON-RPC request handlers.
 *
 * TypeScript equivalent of the Hermes handlers.py — each handler is a
 * standalone function that receives (reqId, params, taskStore, ...) and
 * returns a JSON-RPC response object.
 */

import { randomUUID } from "node:crypto";

import { extractUserText, makeErrorResponse, makeResultResponse } from "./jsonrpc.js";
import type { JsonRpcResponse } from "./jsonrpc.js";
import {
  TaskStore,
  TASK_STATE_WORKING,
  TASK_STATE_COMPLETED,
  TASK_STATE_FAILED,
} from "./task-store.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Agent invocation callable.
 * Takes (userText, contextId) and returns agent response text or null.
 */
export type InvokeAgent = (text: string, contextId: string) => Promise<string | null>;

// ---------------------------------------------------------------------------
// handleSendMessage
// ---------------------------------------------------------------------------

/**
 * Handle a SendMessage / message/send request.
 *
 * - Extracts user text from params.
 * - Returns -32602 error if no text found.
 * - Creates a task, transitions it to WORKING, invokes the agent.
 * - On success sets COMPLETED with the agent response.
 * - On empty/null response sets FAILED.
 * - On exception sets FAILED with the error message.
 */
export async function handleSendMessage(
  reqId: unknown,
  params: Record<string, unknown>,
  taskStore: TaskStore,
  invokeAgent: InvokeAgent,
): Promise<JsonRpcResponse> {
  const [userText, contextId] = extractUserText(params);

  if (!userText) {
    return makeErrorResponse(reqId, -32602, "Invalid params: no user text");
  }

  // Generate context_id if not supplied
  const resolvedContextId = contextId || randomUUID();

  const task = taskStore.create(resolvedContextId, userText);
  const taskId = task.id;
  taskStore.updateStatus(taskId, TASK_STATE_WORKING);

  try {
    const responseText = await invokeAgent(userText, resolvedContextId);

    if (!responseText) {
      const failedTask = taskStore.updateStatus(taskId, TASK_STATE_FAILED);
      failedTask.status.message = "Empty response";
      return makeResultResponse(reqId, { task: failedTask });
    }

    const completedTask = taskStore.updateStatus(taskId, TASK_STATE_COMPLETED, responseText);
    return makeResultResponse(reqId, { task: completedTask });
  } catch (exc) {
    const errorMessage = exc instanceof Error ? exc.message : String(exc);
    const failedTask = taskStore.updateStatus(taskId, TASK_STATE_FAILED, errorMessage);
    return makeResultResponse(reqId, { task: failedTask });
  }
}

// ---------------------------------------------------------------------------
// handleGetTask
// ---------------------------------------------------------------------------

/**
 * Handle a GetTask / tasks/get request.
 */
export function handleGetTask(
  reqId: unknown,
  params: Record<string, unknown>,
  taskStore: TaskStore,
): JsonRpcResponse {
  const taskId = params["id"] as string | undefined;
  if (!taskId) {
    return makeErrorResponse(reqId, -32602, "Invalid params: missing id");
  }

  const task = taskStore.get(taskId);
  if (task === null) {
    return makeErrorResponse(reqId, -32602, `Task not found: ${taskId}`);
  }

  return makeResultResponse(reqId, task);
}

// ---------------------------------------------------------------------------
// handleListTasks
// ---------------------------------------------------------------------------

/**
 * Handle a ListTasks / tasks/list request.
 */
export function handleListTasks(
  reqId: unknown,
  params: Record<string, unknown>,
  taskStore: TaskStore,
): JsonRpcResponse {
  const contextId = params["context_id"] as string | undefined;
  const status = params["status"] as string | undefined;
  const pageSize = (params["page_size"] as number) ?? 50;
  const pageToken = (params["page_token"] as string) ?? "";

  const result = taskStore.list({
    contextId,
    status,
    pageSize,
    pageToken,
  });
  return makeResultResponse(reqId, result);
}

// ---------------------------------------------------------------------------
// handleCancelTask
// ---------------------------------------------------------------------------

/**
 * Handle a CancelTask / tasks/cancel request.
 */
export function handleCancelTask(
  reqId: unknown,
  params: Record<string, unknown>,
  taskStore: TaskStore,
): JsonRpcResponse {
  const taskId = params["id"] as string | undefined;
  if (!taskId) {
    return makeErrorResponse(reqId, -32602, "Invalid params: missing id");
  }

  try {
    const task = taskStore.cancel(taskId);
    return makeResultResponse(reqId, task);
  } catch (exc) {
    const errorMessage = exc instanceof Error ? exc.message : String(exc);
    return makeErrorResponse(reqId, -32602, errorMessage);
  }
}
