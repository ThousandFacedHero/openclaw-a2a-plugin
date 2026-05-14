/**
 * Tests for task-store.ts — in-memory A2A task store with TTL expiry.
 * Run with: npx vitest run tests/task-store.test.ts
 */

import { describe, it, expect, vi } from "vitest";
import {
  TaskStore,
  TASK_STATE_SUBMITTED,
  TASK_STATE_WORKING,
  TASK_STATE_COMPLETED,
  TASK_STATE_FAILED,
  TASK_STATE_CANCELED,
  TASK_STATE_REJECTED,
  ROLE_USER,
  ROLE_AGENT,
} from "../task-store.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStore(opts?: { ttlMs?: number; maxEntries?: number }): TaskStore {
  return new TaskStore({ ttlMs: opts?.ttlMs ?? 3_600_000, maxEntries: opts?.maxEntries });
}

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

describe("TaskStore.create", () => {
  it("returns a task object", () => {
    const store = makeStore();
    const task = store.create("ctx-1", "hello");
    expect(typeof task).toBe("object");
    expect(task).not.toBeNull();
  });

  it("assigns a UUID id (36 chars)", () => {
    const store = makeStore();
    const task = store.create("ctx-1", "hello");
    expect(typeof task.id).toBe("string");
    expect(task.id).toHaveLength(36);
  });

  it("stores the context_id", () => {
    const store = makeStore();
    const task = store.create("ctx-abc", "hello");
    expect(task.context_id).toBe("ctx-abc");
  });

  it("sets initial state to TASK_STATE_SUBMITTED", () => {
    const store = makeStore();
    const task = store.create("ctx-1", "hello");
    expect(task.status.state).toBe(TASK_STATE_SUBMITTED);
  });

  it("status has an ISO 8601 timestamp", () => {
    const store = makeStore();
    const task = store.create("ctx-1", "hello");
    expect(typeof task.status.timestamp).toBe("string");
    expect(task.status.timestamp).toContain("T");
  });

  it("starts with empty artifacts array", () => {
    const store = makeStore();
    const task = store.create("ctx-1", "hello");
    expect(task.artifacts).toEqual([]);
  });

  it("starts with empty metadata object", () => {
    const store = makeStore();
    const task = store.create("ctx-1", "hello");
    expect(task.metadata).toEqual({});
  });

  it("places a user message in history", () => {
    const store = makeStore();
    const task = store.create("ctx-1", "hello world");
    expect(task.history).toHaveLength(1);
    const msg = task.history[0];
    expect(msg.role).toBe(ROLE_USER);
    expect(msg.parts).toEqual([{ text: "hello world" }]);
  });

  it("user message has a UUID message_id (36 chars)", () => {
    const store = makeStore();
    const task = store.create("ctx-1", "hello");
    const msg = task.history[0];
    expect(typeof msg.message_id).toBe("string");
    expect(msg.message_id).toHaveLength(36);
  });

  it("two tasks get different ids", () => {
    const store = makeStore();
    const t1 = store.create("ctx-1", "a");
    const t2 = store.create("ctx-1", "b");
    expect(t1.id).not.toBe(t2.id);
  });

  it("task is retrievable after create", () => {
    const store = makeStore();
    const task = store.create("ctx-1", "hello");
    const retrieved = store.get(task.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe(task.id);
  });
});

// ---------------------------------------------------------------------------
// get
// ---------------------------------------------------------------------------

describe("TaskStore.get", () => {
  it("returns an existing task", () => {
    const store = makeStore();
    const task = store.create("ctx-1", "hi");
    const result = store.get(task.id);
    expect(result).not.toBeNull();
    expect(result!.id).toBe(task.id);
  });

  it("returns null for a nonexistent id", () => {
    const store = makeStore();
    expect(store.get("no-such-id")).toBeNull();
  });

  it("returns null for an expired task (ttlMs=0)", () => {
    const store = makeStore({ ttlMs: 0 });
    const task = store.create("ctx-1", "hi");
    // TTL=0 means expired immediately
    expect(store.get(task.id)).toBeNull();
  });

  it("returns task within TTL", () => {
    const store = makeStore({ ttlMs: 3_600_000 });
    const task = store.create("ctx-1", "hi");
    expect(store.get(task.id)).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// updateStatus
// ---------------------------------------------------------------------------

describe("TaskStore.updateStatus", () => {
  it("changes the task state", () => {
    const store = makeStore();
    const task = store.create("ctx-1", "hi");
    const updated = store.updateStatus(task.id, TASK_STATE_WORKING);
    expect(updated.status.state).toBe(TASK_STATE_WORKING);
  });

  it("updates the timestamp", () => {
    const store = makeStore();
    const task = store.create("ctx-1", "hi");
    const oldTs = task.status.timestamp;
    const updated = store.updateStatus(task.id, TASK_STATE_WORKING);
    expect(updated.status.timestamp >= oldTs).toBe(true);
  });

  it("adds an agent message to history", () => {
    const store = makeStore();
    const task = store.create("ctx-1", "hi");
    const updated = store.updateStatus(task.id, TASK_STATE_WORKING, "working on it");
    const agentMsgs = updated.history.filter((m) => m.role === ROLE_AGENT);
    expect(agentMsgs).toHaveLength(1);
    expect(agentMsgs[0].parts).toEqual([{ text: "working on it" }]);
  });

  it("agent message has a UUID message_id", () => {
    const store = makeStore();
    const task = store.create("ctx-1", "hi");
    const updated = store.updateStatus(task.id, TASK_STATE_WORKING, "ok");
    const agentMsgs = updated.history.filter((m) => m.role === ROLE_AGENT);
    expect(agentMsgs[0].message_id).toHaveLength(36);
  });

  it("no history addition when no agent message provided", () => {
    const store = makeStore();
    const task = store.create("ctx-1", "hi");
    const updated = store.updateStatus(task.id, TASK_STATE_WORKING);
    expect(updated.history).toHaveLength(1); // only the original user message
  });

  it("adds an artifact on COMPLETED with agent message", () => {
    const store = makeStore();
    const task = store.create("ctx-1", "hi");
    const updated = store.updateStatus(task.id, TASK_STATE_COMPLETED, "done!");
    expect(updated.artifacts).toHaveLength(1);
    const artifact = updated.artifacts[0];
    expect(artifact.artifact_id).toHaveLength(36);
    expect(artifact.parts).toEqual([{ text: "done!" }]);
  });

  it("no artifact on COMPLETED without agent message", () => {
    const store = makeStore();
    const task = store.create("ctx-1", "hi");
    const updated = store.updateStatus(task.id, TASK_STATE_COMPLETED);
    expect(updated.artifacts).toEqual([]);
  });

  it("no artifact on WORKING with agent message", () => {
    const store = makeStore();
    const task = store.create("ctx-1", "hi");
    const updated = store.updateStatus(task.id, TASK_STATE_WORKING, "in progress");
    expect(updated.artifacts).toEqual([]);
  });

  it("throws for nonexistent task id", () => {
    const store = makeStore();
    expect(() => store.updateStatus("no-such-id", TASK_STATE_WORKING)).toThrow();
  });

  it("get reflects updated state", () => {
    const store = makeStore();
    const task = store.create("ctx-1", "hi");
    store.updateStatus(task.id, TASK_STATE_COMPLETED, "done");
    const retrieved = store.get(task.id);
    expect(retrieved!.status.state).toBe(TASK_STATE_COMPLETED);
  });
});

// ---------------------------------------------------------------------------
// cancel
// ---------------------------------------------------------------------------

describe("TaskStore.cancel", () => {
  it("sets state to TASK_STATE_CANCELED", () => {
    const store = makeStore();
    const task = store.create("ctx-1", "hi");
    const result = store.cancel(task.id);
    expect(result.status.state).toBe(TASK_STATE_CANCELED);
  });

  it("throws for nonexistent task id", () => {
    const store = makeStore();
    expect(() => store.cancel("no-such-id")).toThrow();
  });

  it("throws for task already in COMPLETED state", () => {
    const store = makeStore();
    const task = store.create("ctx-1", "hi");
    store.updateStatus(task.id, TASK_STATE_COMPLETED, "done");
    expect(() => store.cancel(task.id)).toThrow();
  });

  it("throws for task already in FAILED state", () => {
    const store = makeStore();
    const task = store.create("ctx-1", "hi");
    store.updateStatus(task.id, TASK_STATE_FAILED);
    expect(() => store.cancel(task.id)).toThrow();
  });

  it("throws for task already in REJECTED state", () => {
    const store = makeStore();
    const task = store.create("ctx-1", "hi");
    store.updateStatus(task.id, TASK_STATE_REJECTED);
    expect(() => store.cancel(task.id)).toThrow();
  });

  it("throws when canceling an already-canceled task", () => {
    const store = makeStore();
    const task = store.create("ctx-1", "hi");
    store.cancel(task.id);
    expect(() => store.cancel(task.id)).toThrow();
  });

  it("cancel is reflected in get", () => {
    const store = makeStore();
    const task = store.create("ctx-1", "hi");
    store.cancel(task.id);
    const retrieved = store.get(task.id);
    expect(retrieved!.status.state).toBe(TASK_STATE_CANCELED);
  });
});

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

describe("TaskStore.list", () => {
  it("returns all tasks", () => {
    const store = makeStore();
    store.create("ctx-1", "a");
    store.create("ctx-1", "b");
    store.create("ctx-1", "c");
    const result = store.list();
    expect(result.tasks).toHaveLength(3);
  });

  it("returns object with tasks and next_page_token", () => {
    const store = makeStore();
    const result = store.list();
    expect(result).toHaveProperty("tasks");
    expect(result).toHaveProperty("next_page_token");
  });

  it("empty store returns empty tasks and empty next_page_token", () => {
    const store = makeStore();
    const result = store.list();
    expect(result.tasks).toEqual([]);
    expect(result.next_page_token).toBe("");
  });

  it("filters by contextId", () => {
    const store = makeStore();
    store.create("ctx-A", "a");
    store.create("ctx-A", "b");
    store.create("ctx-B", "c");
    const result = store.list({ contextId: "ctx-A" });
    expect(result.tasks).toHaveLength(2);
    for (const t of result.tasks) {
      expect(t.context_id).toBe("ctx-A");
    }
  });

  it("filters by status", () => {
    const store = makeStore();
    const t1 = store.create("ctx-1", "a");
    const t2 = store.create("ctx-1", "b");
    store.create("ctx-1", "c");
    store.updateStatus(t1.id, TASK_STATE_COMPLETED, "done");
    store.updateStatus(t2.id, TASK_STATE_COMPLETED, "done");
    const result = store.list({ status: TASK_STATE_COMPLETED });
    expect(result.tasks).toHaveLength(2);
    for (const t of result.tasks) {
      expect(t.status.state).toBe(TASK_STATE_COMPLETED);
    }
  });

  it("paginates across three pages", () => {
    const store = makeStore();
    for (let i = 0; i < 5; i++) store.create("ctx-1", `msg-${i}`);

    const page1 = store.list({ pageSize: 2 });
    expect(page1.tasks).toHaveLength(2);
    expect(page1.next_page_token).not.toBe("");

    const page2 = store.list({ pageSize: 2, pageToken: page1.next_page_token });
    expect(page2.tasks).toHaveLength(2);
    expect(page2.next_page_token).not.toBe("");

    const page3 = store.list({ pageSize: 2, pageToken: page2.next_page_token });
    expect(page3.tasks).toHaveLength(1);
    expect(page3.next_page_token).toBe("");
  });

  it("no duplicates across paginated pages", () => {
    const store = makeStore();
    for (let i = 0; i < 5; i++) store.create("ctx-1", `msg-${i}`);

    const seen = new Set<string>();
    let token = "";
    do {
      const result = store.list({ pageSize: 2, pageToken: token });
      for (const t of result.tasks) {
        expect(seen.has(t.id)).toBe(false);
        seen.add(t.id);
      }
      token = result.next_page_token;
    } while (token);

    expect(seen.size).toBe(5);
  });

  it("default page size returns 50 tasks when 60 exist", () => {
    const store = makeStore();
    for (let i = 0; i < 60; i++) store.create("ctx-1", `msg-${i}`);
    const result = store.list();
    expect(result.tasks).toHaveLength(50);
    expect(result.next_page_token).not.toBe("");
  });
});

// ---------------------------------------------------------------------------
// maxEntries
// ---------------------------------------------------------------------------

describe("TaskStore maxEntries", () => {
  it("evicts oldest task when at capacity", () => {
    const store = makeStore({ maxEntries: 3 });
    const t1 = store.create("ctx-1", "first");
    store.create("ctx-1", "second");
    store.create("ctx-1", "third");
    // adding 4th should evict t1
    store.create("ctx-1", "fourth");
    expect(store.get(t1.id)).toBeNull();
  });

  it("newer tasks remain after eviction", () => {
    const store = makeStore({ maxEntries: 3 });
    store.create("ctx-1", "first");
    const t2 = store.create("ctx-1", "second");
    const t3 = store.create("ctx-1", "third");
    const t4 = store.create("ctx-1", "fourth");
    expect(store.get(t2.id)).not.toBeNull();
    expect(store.get(t3.id)).not.toBeNull();
    expect(store.get(t4.id)).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// cleanup
// ---------------------------------------------------------------------------

describe("TaskStore.cleanup", () => {
  it("removes expired tasks", () => {
    const store = makeStore({ ttlMs: 0 });
    store.create("ctx-1", "a");
    store.create("ctx-1", "b");
    store.cleanup();
    expect(store.list().tasks).toEqual([]);
  });

  it("keeps non-expired tasks", () => {
    const store = makeStore({ ttlMs: 3_600_000 });
    store.create("ctx-1", "a");
    store.create("ctx-1", "b");
    store.cleanup();
    expect(store.list().tasks).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// subscribe
// ---------------------------------------------------------------------------

describe("TaskStore.subscribe", () => {
  it("callback is called on status update", async () => {
    const store = makeStore();
    const task = store.create("ctx-1", "hi");

    const events: unknown[] = [];
    const unsub = store.subscribe(task.id, (e) => events.push(e));

    store.updateStatus(task.id, TASK_STATE_WORKING);

    expect(events).toHaveLength(1);
    const event = events[0] as { task_id: string; context_id: string; status: { state: string } };
    expect(event.task_id).toBe(task.id);
    expect(event.context_id).toBe(task.context_id);
    expect(event.status.state).toBe(TASK_STATE_WORKING);

    unsub();
  });

  it("unsubscribe stops further callbacks", () => {
    const store = makeStore();
    const task = store.create("ctx-1", "hi");

    const events: unknown[] = [];
    const unsub = store.subscribe(task.id, (e) => events.push(e));

    store.updateStatus(task.id, TASK_STATE_WORKING);
    unsub();
    store.updateStatus(task.id, TASK_STATE_COMPLETED, "done");

    expect(events).toHaveLength(1);
  });

  it("throws when subscribing to a terminal task", () => {
    const store = makeStore();
    const task = store.create("ctx-1", "hi");
    store.updateStatus(task.id, TASK_STATE_COMPLETED, "done");

    expect(() => store.subscribe(task.id, () => {})).toThrow();
  });

  it("cancel sends event to subscriber", () => {
    const store = makeStore();
    const task = store.create("ctx-1", "hi");

    const events: unknown[] = [];
    store.subscribe(task.id, (e) => events.push(e));

    store.cancel(task.id);

    expect(events).toHaveLength(1);
    const event = events[0] as { status: { state: string } };
    expect(event.status.state).toBe(TASK_STATE_CANCELED);
  });

  it("throws when subscribing to a nonexistent task", () => {
    const store = makeStore();
    expect(() => store.subscribe("no-such-id", () => {})).toThrow();
  });
});
