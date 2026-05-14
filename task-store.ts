/**
 * In-memory A2A task store with TTL-based expiry.
 *
 * TypeScript equivalent of the Hermes task_store.py — same semantics,
 * synchronous subscribe callback instead of async generator.
 */

import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const TASK_STATE_SUBMITTED = "TASK_STATE_SUBMITTED";
export const TASK_STATE_WORKING = "TASK_STATE_WORKING";
export const TASK_STATE_COMPLETED = "TASK_STATE_COMPLETED";
export const TASK_STATE_FAILED = "TASK_STATE_FAILED";
export const TASK_STATE_CANCELED = "TASK_STATE_CANCELED";
export const TASK_STATE_INPUT_REQUIRED = "TASK_STATE_INPUT_REQUIRED";
export const TASK_STATE_REJECTED = "TASK_STATE_REJECTED";
export const TASK_STATE_AUTH_REQUIRED = "TASK_STATE_AUTH_REQUIRED";

export const ROLE_USER = "ROLE_USER";
export const ROLE_AGENT = "ROLE_AGENT";

const TERMINAL_STATES = new Set([
  TASK_STATE_COMPLETED,
  TASK_STATE_FAILED,
  TASK_STATE_CANCELED,
  TASK_STATE_REJECTED,
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TaskStatus = { state: string; timestamp: string; message?: string };
export type Part = { text: string };
export type Message = { message_id: string; role: string; parts: Part[] };
export type Artifact = { artifact_id: string; parts: Part[] };
export type Task = {
  id: string;
  context_id: string;
  status: TaskStatus;
  artifacts: Artifact[];
  history: Message[];
  metadata: Record<string, unknown>;
};
export type ListResult = { tasks: Task[]; next_page_token: string };
export type ListFilters = {
  contextId?: string;
  status?: string;
  pageSize?: number;
  pageToken?: string;
};
export type TaskStatusEvent = {
  task_id: string;
  context_id: string;
  status: TaskStatus;
};

// ---------------------------------------------------------------------------
// Internal store entry
// ---------------------------------------------------------------------------

interface StoreEntry {
  task: Task;
  createdAt: number; // Date.now() ms
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nowIso(): string {
  return new Date().toISOString();
}

function makeMessage(role: string, text: string): Message {
  return {
    message_id: randomUUID(),
    role,
    parts: [{ text }],
  };
}

function makeArtifact(text: string): Artifact {
  return {
    artifact_id: randomUUID(),
    parts: [{ text }],
  };
}

// ---------------------------------------------------------------------------
// TaskStore
// ---------------------------------------------------------------------------

export class TaskStore {
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  /** Map preserves insertion order in JS (ES2015+). */
  private readonly store: Map<string, StoreEntry> = new Map();
  /** Map of taskId → set of subscriber callbacks. */
  private readonly subscribers: Map<string, Set<(event: TaskStatusEvent) => void>> = new Map();

  constructor({ ttlMs, maxEntries = 1000 }: { ttlMs: number; maxEntries?: number }) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private isExpired(entry: StoreEntry): boolean {
    return Date.now() - entry.createdAt >= this.ttlMs;
  }

  private getEntry(taskId: string): StoreEntry | null {
    const entry = this.store.get(taskId);
    if (!entry) return null;
    if (this.isExpired(entry)) return null;
    return entry;
  }

  private notifySubscribers(task: Task): void {
    const cbs = this.subscribers.get(task.id);
    if (!cbs || cbs.size === 0) return;
    const event: TaskStatusEvent = {
      task_id: task.id,
      context_id: task.context_id,
      status: { ...task.status },
    };
    for (const cb of cbs) {
      try {
        cb(event);
      } catch {
        // swallow subscriber errors
      }
    }
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Create a new task with TASK_STATE_SUBMITTED and a user message in history.
   */
  create(contextId: string, messageText: string): Task {
    // Evict oldest entry if at capacity
    if (this.store.size >= this.maxEntries) {
      const oldestId = this.store.keys().next().value as string;
      this.store.delete(oldestId);
      this.subscribers.delete(oldestId);
    }

    const taskId = randomUUID();
    const task: Task = {
      id: taskId,
      context_id: contextId,
      status: {
        state: TASK_STATE_SUBMITTED,
        timestamp: nowIso(),
      },
      artifacts: [],
      history: [makeMessage(ROLE_USER, messageText)],
      metadata: {},
    };

    this.store.set(taskId, { task, createdAt: Date.now() });
    return task;
  }

  /**
   * Return the task, or null if not found or expired.
   */
  get(taskId: string): Task | null {
    const entry = this.getEntry(taskId);
    return entry ? entry.task : null;
  }

  /**
   * Update the task state. Optionally appends an agent message.
   * Adds an artifact when state is COMPLETED and agentMessage is provided.
   *
   * @throws Error if the task is not found (or expired).
   */
  updateStatus(taskId: string, state: string, agentMessage?: string): Task {
    const entry = this.getEntry(taskId);
    if (!entry) throw new Error(`Task not found: ${taskId}`);

    const task = entry.task;
    task.status = { state, timestamp: nowIso() };

    if (agentMessage !== undefined) {
      task.history.push(makeMessage(ROLE_AGENT, agentMessage));
      if (state === TASK_STATE_COMPLETED) {
        task.artifacts.push(makeArtifact(agentMessage));
      }
    }

    this.notifySubscribers(task);
    return task;
  }

  /**
   * Cancel a task. Throws if not found or already in a terminal state.
   */
  cancel(taskId: string): Task {
    const entry = this.getEntry(taskId);
    if (!entry) throw new Error(`Task not found: ${taskId}`);

    const task = entry.task;
    if (TERMINAL_STATES.has(task.status.state)) {
      throw new Error(
        `Task ${taskId} is already in terminal state ${task.status.state}`
      );
    }

    task.status = { state: TASK_STATE_CANCELED, timestamp: nowIso() };
    this.notifySubscribers(task);
    return task;
  }

  /**
   * Return a page of tasks, optionally filtered and paginated.
   *
   * Filters: contextId, status
   * Pagination: pageSize (default 50), pageToken (task id cursor, exclusive)
   */
  list(filters: ListFilters = {}): ListResult {
    const { contextId, status, pageSize = 50, pageToken = "" } = filters;

    // Build ordered list of non-expired, matching tasks
    const allTasks: Task[] = [];
    for (const [, entry] of this.store) {
      if (this.isExpired(entry)) continue;
      const task = entry.task;
      if (contextId !== undefined && task.context_id !== contextId) continue;
      if (status !== undefined && task.status.state !== status) continue;
      allTasks.push(task);
    }

    // Apply cursor: start after the task with id === pageToken
    let startIdx = 0;
    if (pageToken) {
      const cursorIdx = allTasks.findIndex((t) => t.id === pageToken);
      startIdx = cursorIdx === -1 ? 0 : cursorIdx + 1;
    }

    const sliced = allTasks.slice(startIdx);
    const page = sliced.slice(0, pageSize);
    const remaining = sliced.slice(pageSize);

    const next_page_token = remaining.length > 0 ? page[page.length - 1].id : "";

    return { tasks: page, next_page_token };
  }

  /**
   * Subscribe to status updates for a task. Returns an unsubscribe function.
   *
   * @throws Error if the task is not found (or expired), or already in a terminal state.
   */
  subscribe(taskId: string, callback: (event: TaskStatusEvent) => void): () => void {
    const entry = this.getEntry(taskId);
    if (!entry) throw new Error(`Task not found: ${taskId}`);

    const task = entry.task;
    if (TERMINAL_STATES.has(task.status.state)) {
      throw new Error(
        `Task ${taskId} is already in terminal state ${task.status.state}`
      );
    }

    if (!this.subscribers.has(taskId)) {
      this.subscribers.set(taskId, new Set());
    }
    const cbs = this.subscribers.get(taskId)!;
    cbs.add(callback);

    return () => {
      cbs.delete(callback);
      if (cbs.size === 0) this.subscribers.delete(taskId);
    };
  }

  /**
   * Remove all expired entries from the store.
   */
  cleanup(): void {
    for (const [taskId, entry] of this.store) {
      if (this.isExpired(entry)) {
        this.store.delete(taskId);
        this.subscribers.delete(taskId);
      }
    }
  }
}
