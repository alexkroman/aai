# CLAUDE.md

## Overview

AAI is a voice agent development kit. Users define agents via `defineAgent()`
in `agent.ts`, and the CLI bundles and deploys them to a server that relays
audio between the browser/Twilio client and AssemblyAI's Speech-to-Speech (S2S)
API, which handles STT, LLM, and TTS in a single WebSocket connection. The
server intercepts `tool.call` events to execute tools locally.

## Commands

```sh
deno task setup          # Configure git hooks (run after clone)
deno task check          # Full CI: type-check, lint, fmt, tests
deno task test           # Run all tests
deno task serve          # Run the orchestrator server directly
deno task deploy         # Production deploy
deno task new            # Scaffold a new agent from templates/
deno task bump           # Auto-bump versions for changed packages
deno lint                # Lint only
deno fmt                 # Format only
```

Run a single test file: `deno test --allow-all server/session_test.ts`

## Git Hooks

Hooks live in `.githooks/` (activated via `deno task setup`).

- **pre-commit**: blocks direct commits to `main`, auto-bumps versions
  (`deno task bump`), then runs `deno task check`
- **pre-push**: blocks direct pushes to `main`, verifies binary compiles via
  `deno compile`

## Architecture

### Workspaces

Five packages in `deno.json` workspace: `sdk/`, `core/`, `server/`, `ui/`,
`cli/`.

Dependency rule: `cli/`, `server/`, and `ui/` depend on `sdk/` and `core/` but
never on each other.

- `sdk/` — Public agent SDK (JSR `@aai/sdk`): types,
  `defineAgent`, `fetchJSON`
- `core/` — Internal plumbing: worker entry, protocol, RPC,
  JSON schemas
- `cli/` — The `aai` CLI tool (`cli/cli.ts`)
- `server/` — Orchestrator server (`server/main.ts`)
- `ui/` — Browser client library (Preact), bundled as
  `client.js` (`ui/mod.ts`)

### Key Files

#### cli/

- `cli.ts` — arg parsing, subcommands: new, build, deploy, types
- `new.ts` / `deploy.ts` — Cliffy command definitions for subcommands
- `_new.ts` / `_deploy.ts` — internal logic for new/deploy
- `_bundler.ts` — esbuild bundling of `agent.ts`/`client.tsx` into
  `worker.js`/`client.js`
- `_discover.ts` — imports `agent.ts` to extract config from `defineAgent()`
- `_validate.ts` — build-time agent config validation

#### server/

- `orchestrator.ts` — deploy, health, WebSocket, Twilio, landing
  page routes
- `s2s.ts` — AssemblyAI Speech-to-Speech WebSocket client
- `session.ts` — per-connection session: connects to S2S, relays audio,
  intercepts tool calls for local execution
- `worker_pool.ts` — spawns agent code in sandboxed Deno Workers (all
  permissions false), idle eviction, hosts fetch proxy handler
- `_sandbox_worker.ts` — sandboxed Deno Worker for `run_code` tool
- `builtin_tools.ts` — web_search, visit_webpage, fetch_json, run_code
- `transport_websocket.ts` / `transport_twilio.ts` — transport handlers

#### ui/

- `session.ts` — WebSocket session management, audio capture/playback
- `audio.ts` — PCM encoding/decoding, AudioWorklet management
- `mod.ts` — default Preact UI component

### Data Flow

1. User speaks → browser captures PCM audio → WebSocket → server
1. Server forwards audio to AssemblyAI S2S API
1. S2S handles STT → LLM → TTS internally
1. On `tool.call`: server executes tool locally, sends result back to S2S
1. S2S streams response audio → server relays to browser
1. Browser plays audio; barge-in handled natively by S2S

### Agent Isolation

Agent code runs in Deno Workers with **all permissions false** (including
`net: false`). The worker communicates with the host via Comlink over
`MessagePort`. Custom tool `execute` functions run inside the worker; built-in
tools run on the host.

**Fetch proxy**: Since workers have no network access, `globalThis.fetch` is
monkeypatched in the worker entry (`core/_worker_entry.ts`) to proxy HTTP
requests through Comlink to the host process. The host handler
(`server/worker_pool.ts`) validates each URL via `assertPublicUrl()`
(`server/builtin_tools.ts`) to block requests to private/internal addresses
(SSRF protection) before executing the real fetch.

**Comlink architecture**: All worker ↔ host communication uses Comlink
(`npm:comlink`) over `MessagePort` (structured clone), producing a `WorkerApi`
interface via `createWorkerApi`.

The `HostApi` type (fetch + kv proxy) is exposed to workers via a dedicated
`MessageChannel` — the host calls `Comlink.expose(hostApi, port1)` and transfers
`port2` to the worker.

## Conventions

- **Runtime**: Deno (not Node). Use `@std/*` for standard library.
- **Frameworks**: Preact (client UI)
- **Testing**: `@std/testing/bdd` (`describe`/`it`) + `@std/expect`. Test files
  are co-located: `foo.ts` → `foo_test.ts`
- **Browser behavior**: CLI opens the browser only when scaffolding a new agent
- **Agent API docs**: `cli/claude.md` is copied into user agent directories as
  their CLAUDE.md. When modifying the agent API surface (`sdk/types.ts`), update
  `cli/claude.md` to match.
- **Templates**: `templates/` contains agent scaffolding templates
- **Scripts**: `scripts/check_boundaries.ts` enforces the workspace dependency
  rule; `scripts/bump_versions.ts` handles version bumps
