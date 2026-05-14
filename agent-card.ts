/**
 * A2A spec-compliant AgentCard and AgentSkill builders for the OpenClaw plugin.
 *
 * TypeScript equivalent of the Hermes agent_card.py — adapted for OpenClaw's
 * ToolRegistration shape (plugin registry) instead of OpenAI-format tool dicts.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PLUGIN_VERSION = "1.0.0";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ToolRegistration = {
  pluginId: string;
  pluginName?: string;
  names: string[];
  factory: () => unknown[];
  optional: boolean;
  source: string;
};

export type AgentSkill = {
  id: string;
  name: string;
  description: string;
  tags: string[];
};

export type AgentCard = {
  name: string;
  description: string;
  version: string;
  supported_interfaces: Array<{
    url: string;
    protocol_binding: string;
    protocol_version: string;
  }>;
  capabilities: { streaming: boolean };
  default_input_modes: string[];
  default_output_modes: string[];
  skills: AgentSkill[];
};

export type BuildAgentCardOpts = {
  gatewayUrl: string;
  gatewayName: string;
  toolRegistrations: ToolRegistration[];
  agentIds: string[];
};

// ---------------------------------------------------------------------------
// buildAgentSkills
// ---------------------------------------------------------------------------

/**
 * Build an array of A2A AgentSkill objects from tool registrations and
 * configured sub-agent IDs.
 *
 * - Each unique tool name becomes one skill whose tags include the plugin name/id
 * - Each agent id becomes one skill with id `subagent:<agentId>` and tag `"subagent"`
 */
export function buildAgentSkills(
  toolRegistrations: ToolRegistration[],
  agentIds: string[],
): AgentSkill[] {
  const skills: AgentSkill[] = [];
  const seenToolNames = new Set<string>();

  for (const reg of toolRegistrations) {
    const tag = reg.pluginName ?? reg.pluginId;
    for (const name of reg.names) {
      if (seenToolNames.has(name)) {
        continue;
      }
      seenToolNames.add(name);
      skills.push({
        id: name,
        name,
        description: `Tool ${name} provided by plugin ${tag}`,
        tags: [tag],
      });
    }
  }

  for (const agentId of agentIds) {
    skills.push({
      id: `subagent:${agentId}`,
      name: agentId,
      description: `Sub-agent: ${agentId}`,
      tags: ["subagent", agentId],
    });
  }

  return skills;
}

// ---------------------------------------------------------------------------
// buildAgentCard
// ---------------------------------------------------------------------------

/**
 * Build a fully-populated A2A AgentCard for the gateway.
 *
 * Returns a spec-compliant card with `supported_interfaces` (not the
 * camelCase `url` / `protocolVersion` / `preferredTransport` shape).
 */
export function buildAgentCard(opts: BuildAgentCardOpts): AgentCard {
  const { gatewayUrl, gatewayName, toolRegistrations, agentIds } = opts;
  const skills = buildAgentSkills(toolRegistrations, agentIds);
  const baseUrl = gatewayUrl.replace(/\/+$/, "");

  return {
    name: gatewayName,
    description: "OpenClaw AI gateway — exposes tools and sub-agents via the A2A protocol",
    version: PLUGIN_VERSION,
    supported_interfaces: [
      {
        url: `${baseUrl}/a2a`,
        protocol_binding: "JSONRPC",
        protocol_version: "1.0",
      },
    ],
    capabilities: { streaming: true },
    default_input_modes: ["text/plain"],
    default_output_modes: ["text/plain"],
    skills,
  };
}
