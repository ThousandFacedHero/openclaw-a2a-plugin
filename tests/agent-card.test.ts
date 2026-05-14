/**
 * Tests for agent-card.ts — A2A AgentCard and AgentSkill builders.
 */

import { describe, it, expect } from "vitest";
import { buildAgentSkills, buildAgentCard } from "../agent-card.js";
import type { ToolRegistration } from "../agent-card.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTool(pluginId: string, names: string[], pluginName?: string): ToolRegistration {
  return {
    pluginId,
    pluginName,
    names,
    factory: () => [],
    optional: false,
    source: "test",
  };
}

// ---------------------------------------------------------------------------
// buildAgentSkills
// ---------------------------------------------------------------------------

describe("buildAgentSkills", () => {
  it("creates skills from tool registrations", () => {
    const tools = [makeTool("search-plugin", ["web_search", "web_fetch"])];
    const skills = buildAgentSkills(tools, []);
    expect(skills).toHaveLength(2);
    expect(skills.map((s) => s.id)).toEqual(["web_search", "web_fetch"]);
  });

  it("includes pluginName as a tag on tool skills", () => {
    const tools = [makeTool("my-plugin", ["do_thing"], "My Plugin")];
    const skills = buildAgentSkills(tools, []);
    expect(skills[0]?.tags).toContain("My Plugin");
  });

  it("falls back to pluginId as tag when pluginName is absent", () => {
    const tools = [makeTool("core", ["core_tool"])];
    const skills = buildAgentSkills(tools, []);
    expect(skills[0]?.tags).toContain("core");
  });

  it("creates subagent skills with 'subagent' tag", () => {
    const skills = buildAgentSkills([], ["research", "coder"]);
    expect(skills).toHaveLength(2);
    expect(skills[0]?.id).toBe("subagent:research");
    expect(skills[1]?.id).toBe("subagent:coder");
    for (const s of skills) {
      expect(s.tags).toContain("subagent");
    }
  });

  it("deduplicates tool names from multiple registrations", () => {
    const tools = [
      makeTool("p1", ["shared_tool"]),
      makeTool("p2", ["shared_tool", "unique_tool"]),
    ];
    const skills = buildAgentSkills(tools, []);
    const ids = skills.map((s) => s.id);
    expect(ids.filter((id) => id === "shared_tool")).toHaveLength(1);
    expect(ids).toContain("unique_tool");
  });

  it("returns empty array for empty inputs", () => {
    expect(buildAgentSkills([], [])).toEqual([]);
  });

  it("combines tool skills and subagent skills", () => {
    const tools = [makeTool("p", ["tool_a"])];
    const skills = buildAgentSkills(tools, ["agent1"]);
    expect(skills).toHaveLength(2);
    const ids = skills.map((s) => s.id);
    expect(ids).toContain("tool_a");
    expect(ids).toContain("subagent:agent1");
  });
});

// ---------------------------------------------------------------------------
// buildAgentCard
// ---------------------------------------------------------------------------

describe("buildAgentCard", () => {
  const baseOpts = {
    gatewayUrl: "https://example.com",
    gatewayName: "OpenClaw Gateway",
    toolRegistrations: [] as ToolRegistration[],
    agentIds: [] as string[],
  };

  it("has all required spec fields", () => {
    const card = buildAgentCard(baseOpts);
    expect(card.name).toBe("OpenClaw Gateway");
    expect(typeof card.description).toBe("string");
    expect(typeof card.version).toBe("string");
    expect(Array.isArray(card.supported_interfaces)).toBe(true);
    expect(card.capabilities).toBeDefined();
    expect(Array.isArray(card.default_input_modes)).toBe(true);
    expect(Array.isArray(card.default_output_modes)).toBe(true);
    expect(Array.isArray(card.skills)).toBe(true);
  });

  it("supported_interfaces has correct structure", () => {
    const card = buildAgentCard(baseOpts);
    expect(card.supported_interfaces).toHaveLength(1);
    const iface = card.supported_interfaces[0];
    expect(iface.url).toBe("https://example.com/a2a");
    expect(iface.protocol_binding).toBe("JSONRPC");
    expect(iface.protocol_version).toBe("1.0");
  });

  it("sets streaming capability to true", () => {
    const card = buildAgentCard(baseOpts);
    expect(card.capabilities.streaming).toBe(true);
  });

  it("strips trailing slash from gateway URL", () => {
    const card = buildAgentCard({ ...baseOpts, gatewayUrl: "https://example.com/" });
    expect(card.supported_interfaces[0].url).toBe("https://example.com/a2a");
  });

  it("includes skills derived from tool registrations", () => {
    const tools = [makeTool("p", ["my_tool"])];
    const card = buildAgentCard({ ...baseOpts, toolRegistrations: tools });
    const ids = card.skills.map((s) => s.id);
    expect(ids).toContain("my_tool");
  });

  it("includes subagent skills from agentIds", () => {
    const card = buildAgentCard({ ...baseOpts, agentIds: ["alpha"] });
    const ids = card.skills.map((s) => s.id);
    expect(ids).toContain("subagent:alpha");
  });

  it("does not include non-spec fields (url, protocolVersion, preferredTransport)", () => {
    const card = buildAgentCard(baseOpts) as Record<string, unknown>;
    expect(card).not.toHaveProperty("url");
    expect(card).not.toHaveProperty("protocolVersion");
    expect(card).not.toHaveProperty("preferredTransport");
  });
});
