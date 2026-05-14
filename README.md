# openclaw-a2a 🦞

A2A v1 protocol plugin for [OpenClaw](https://github.com/openclaw/openclaw) — lets other agents discover and talk to your OpenClaw instance via the [A2A protocol](https://github.com/a2aproject/A2A). Drop-in plugin, no core changes.

Full A2A v1 spec coverage: Agent Card, SendMessage, streaming, task management. 96 tests.

## Quick Start

Copy into your OpenClaw extensions directory and enable:

```bash
cp -r openclaw-a2a /path/to/openclaw/extensions/a2a
```

```json
{
  "plugins": {
    "entries": {
      "a2a": { "enabled": true }
    }
  }
}
```

Set `OPENCLAW_A2A_ENABLED=1` and restart. Agent card appears at `/.well-known/agent-card.json`.

### Docker

Build into the stock image using the `OPENCLAW_EXTENSIONS` build arg:

```bash
mkdir -p extensions/a2a
cp openclaw-a2a/*.ts openclaw-a2a/openclaw.plugin.json extensions/a2a/
# Create a package.json with openclaw.extensions entry (see package.json in this repo)
docker build --build-arg OPENCLAW_EXTENSIONS="a2a" -t openclaw-a2a:latest .
```

Requires Node.js 22+.

## Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPENCLAW_A2A_ENABLED` | yes | — | `1` or `true` to activate |
| `OPENCLAW_A2A_GATEWAY_URL` | no | auto-detected | External URL for Agent Card |

## How It Works

Uses the OpenClaw [plugin SDK](https://docs.openclaw.ai/plugins/sdk-overview) — registers HTTP routes through the gateway's plugin system with standard gateway auth.

- `definePluginEntry` with synchronous `register(api)` callback
- Routes via `api.registerHttpRoute()` — Agent Card at `/.well-known/agent-card.json`, JSON-RPC at `/a2a`
- Agent invocation through `agentCommandFromIngress` (same code path as `/v1/chat/completions`)
- Registered tools and sub-agents populate as A2A skills in the Agent Card

```
Other agent → GET /.well-known/agent-card.json → discovers skills
Other agent → POST /a2a { "method": "SendMessage", ... } → OpenClaw processes → response
```

## Endpoints

| Path | Method | Description |
|------|--------|-------------|
| `/.well-known/agent-card.json` | GET | Agent Card discovery |
| `/a2a` | POST | JSON-RPC 2.0 dispatch |

## Supported Methods

| Method | HTTP Alias | Description |
|--------|------------|-------------|
| `SendMessage` | `message/send` | Synchronous message → task response |
| `SendStreamingMessage` | `message/stream` | SSE streaming response |
| `GetTask` | `tasks/get` | Retrieve task by ID |
| `ListTasks` | `tasks/list` | Filter and paginate tasks |
| `CancelTask` | `tasks/cancel` | Cancel an in-progress task |
| `SubscribeToTask` | `tasks/subscribe` | SSE stream of status updates |

## Testing

```bash
pnpm install
pnpm test
```

## When to Use This vs openclaw-a2a-gateway

[openclaw-a2a-gateway](https://github.com/win4r/openclaw-a2a-gateway) is a full multi-agent gateway — routing between peers, mDNS discovery, gRPC/REST/JSON-RPC transports, persistent task store, circuit breakers, file transfer. Use it when you're orchestrating multiple agents across servers.

This plugin is a **minimal A2A endpoint** — it makes a single OpenClaw instance discoverable and callable via the A2A protocol. Zero dependencies, zero config beyond the env var, ~1200 lines. Use it when you just want another agent to be able to find and talk to your OpenClaw instance without the overhead of a full gateway.

## Known Limitations

- **Skills list may be empty** — the plugin reads `api.runtime.tools` to build the skills list, but this isn't part of the documented `PluginRuntime` API. The Agent Card still works fine without skills; they're informational only.
- **Text parts only** — no FilePart or DataPart handling. Responses are plain text.
- **No persistence** — task store is in-memory. Tasks are lost on restart.

## Spec Compliance

Audited against `a2a.proto` (the normative A2A v1 spec):

- All 8 task states (SUBMITTED → WORKING → COMPLETED/FAILED/CANCELED/REJECTED + INPUT_REQUIRED, AUTH_REQUIRED)
- `supported_interfaces` with protocol binding and version
- Messages use `message_id`, `ROLE_USER`/`ROLE_AGENT`, Part OneOf
- Artifacts include `artifact_id`, SSE events include timestamps
- JSON-RPC error codes: -32700, -32600, -32601, -32602

## License

MIT
