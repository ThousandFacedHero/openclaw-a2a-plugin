/**
 * SSE streaming handlers for A2A protocol.
 *
 * Uses raw Node ServerResponse for SSE output — no framework dependency.
 */

import type { ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";

import { extractUserText } from "./jsonrpc.js";
import {
  TaskStore,
  TASK_STATE_WORKING,
  TASK_STATE_COMPLETED,
  TASK_STATE_FAILED,
} from "./task-store.js";
import type { InvokeAgent } from "./handlers.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Write a single SSE event to the response.
 */
export function sseWrite(res: ServerResponse, data: unknown): void {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// ---------------------------------------------------------------------------
// handleSendStreamingMessage
// ---------------------------------------------------------------------------

/**
 * Handle a SendStreamingMessage / message/stream request via SSE.
 *
 * Emits:
 * 1. statusUpdate with WORKING
 * 2. artifactUpdate with the agent response (on success)
 * 3. statusUpdate with COMPLETED or FAILED
 */
export async function handleSendStreamingMessage(
  reqId: unknown,
  params: Record<string, unknown>,
  taskStore: TaskStore,
  invokeAgent: InvokeAgent,
  res: ServerResponse,
): Promise<void> {
  const [userText, contextId] = extractUserText(params);

  if (!userText) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      jsonrpc: "2.0",
      id: reqId,
      error: { code: -32602, message: "Invalid params: no user text" },
    }));
    return;
  }

  // Set up SSE headers (only after input validation)
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const resolvedContextId = contextId || randomUUID();
  const task = taskStore.create(resolvedContextId, userText);
  const taskId = task.id;
  const workingTask = taskStore.updateStatus(taskId, TASK_STATE_WORKING);

  sseWrite(res, {
    jsonrpc: "2.0",
    id: reqId,
    result: {
      statusUpdate: {
        task_id: taskId,
        context_id: resolvedContextId,
        status: workingTask.status,
      },
    },
  });

  let responseText: string | null = null;
  let failed = false;

  try {
    responseText = await invokeAgent(userText, resolvedContextId);
  } catch (exc) {
    const errorMessage = exc instanceof Error ? exc.message : String(exc);
    taskStore.updateStatus(taskId, TASK_STATE_FAILED, errorMessage);
    failed = true;
  }

  if (!failed && responseText) {
    const completedTask = taskStore.updateStatus(taskId, TASK_STATE_COMPLETED, responseText);
    const artifact = completedTask.artifacts.at(-1);
    const artifactId = artifact?.artifact_id ?? randomUUID();

    sseWrite(res, {
      jsonrpc: "2.0",
      id: reqId,
      result: {
        artifactUpdate: {
          task_id: taskId,
          context_id: resolvedContextId,
          artifact: {
            artifact_id: artifactId,
            parts: [{ text: responseText }],
          },
          append: false,
          last_chunk: true,
        },
      },
    });

    sseWrite(res, {
      jsonrpc: "2.0",
      id: reqId,
      result: {
        statusUpdate: {
          task_id: taskId,
          context_id: resolvedContextId,
          status: completedTask.status,
        },
      },
    });
  } else if (!failed) {
    const failedTask = taskStore.updateStatus(taskId, TASK_STATE_FAILED);

    sseWrite(res, {
      jsonrpc: "2.0",
      id: reqId,
      result: {
        statusUpdate: {
          task_id: taskId,
          context_id: resolvedContextId,
          status: failedTask.status,
        },
      },
    });
  } else {
    const failedTask = taskStore.get(taskId);
    sseWrite(res, {
      jsonrpc: "2.0",
      id: reqId,
      result: {
        statusUpdate: {
          task_id: taskId,
          context_id: resolvedContextId,
          status: failedTask?.status ?? { state: TASK_STATE_FAILED, timestamp: new Date().toISOString() },
        },
      },
    });
  }

  res.end();
}

// ---------------------------------------------------------------------------
// handleSubscribeToTask
// ---------------------------------------------------------------------------

/**
 * Handle a SubscribeToTask / tasks/subscribe request via SSE.
 *
 * Subscribes to the task's status updates and streams them as SSE events.
 * The stream ends when the task reaches a terminal state.
 */
export function handleSubscribeToTask(
  reqId: unknown,
  params: Record<string, unknown>,
  taskStore: TaskStore,
  res: ServerResponse,
): void {
  const taskId = params["id"] as string | undefined;
  if (!taskId) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: reqId,
        error: { code: -32602, message: "Invalid params: missing id" },
      }),
    );
    return;
  }

  const task = taskStore.get(taskId);
  if (!task) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: reqId,
        error: { code: -32602, message: `Task not found: ${taskId}` },
      }),
    );
    return;
  }

  // Set up SSE headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const TERMINAL_STATES = new Set([
    "TASK_STATE_COMPLETED",
    "TASK_STATE_FAILED",
    "TASK_STATE_CANCELED",
    "TASK_STATE_REJECTED",
  ]);

  try {
    const unsubscribe = taskStore.subscribe(taskId, (event) => {
      sseWrite(res, {
        jsonrpc: "2.0",
        id: reqId,
        result: {
          statusUpdate: {
            task_id: event.task_id,
            context_id: event.context_id,
            status: event.status,
          },
        },
      });

      if (TERMINAL_STATES.has(event.status.state)) {
        unsubscribe();
        res.end();
      }
    });

    // Clean up on client disconnect
    res.on("close", () => {
      unsubscribe();
    });
  } catch (exc) {
    // Task is already in terminal state or not found
    sseWrite(res, {
      jsonrpc: "2.0",
      id: reqId,
      error: { code: -32602, message: exc instanceof Error ? exc.message : String(exc) },
    });
    res.end();
  }
}
