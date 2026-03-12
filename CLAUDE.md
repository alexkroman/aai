# CLAUDE.md

## Overview

AAI is a voice agent development kit. Users define agents via `defineAgent()`
in `agent.ts`, and the CLI bundles and deploys them to a server that
orchestrates STT (AssemblyAI) → LLM (Claude) → TTS (Rime) in real-time over
WebSocket or Twilio.

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
- `session.ts` — per-connection session: wires STT → turn handler → TTS,
  manages interruptions
- `turn_handler.ts` — agentic loop: LLM + tool calls (up to 5 iterations),
  forces `final_answer` on last
- `worker_pool.ts` — spawns agent code in sandboxed Deno Workers (all
  permissions false), idle eviction, hosts fetch proxy handler
- `_sandbox_worker.ts` — sandboxed Deno Worker for `run_code` tool
- `builtin_tools.ts` — web_search, visit_webpage, fetch_json, run_code,
  user_input, final_answer
- `llm.ts` — Claude API calls (OpenAI-compatible format)
- `stt.ts` — AssemblyAI streaming STT
- `tts.ts` — Rime streaming TTS
- `transport_websocket.ts` / `transport_twilio.ts` — transport handlers

#### ui/

- `session.ts` — WebSocket session management, audio capture/playback
- `audio.ts` — PCM encoding/decoding, AudioWorklet management
- `mod.ts` — default Preact UI component

### Data Flow

1. User speaks → browser captures PCM audio → WebSocket → server
1. Server forwards audio to AssemblyAI STT → receives transcript
1. STT fires `onTurn` → `turn_handler.ts` runs agentic loop (LLM + tools)
1. LLM response text → Rime TTS → audio chunks → WebSocket → browser
1. Browser plays audio; user can interrupt at any time (cancels in-flight turn)

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
- **Testing**: `Deno.test()` with `t.step()` + `@std/assert`. Test files
  are co-located: `foo.ts` → `foo_test.ts`
- **Browser behavior**: CLI opens the browser only when scaffolding a new agent
- **Agent API docs**: `cli/claude.md` is copied into user agent directories as
  their CLAUDE.md. When modifying the agent API surface (`sdk/types.ts`), update
  `cli/claude.md` to match.
- **Templates**: `templates/` contains agent scaffolding templates
- **Scripts**: `scripts/check_boundaries.ts` enforces the workspace dependency
  rule; `scripts/bump_versions.ts` handles version bumps
