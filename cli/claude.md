# Build a voice agent with `aai`

You are helping a user build a voice agent using the **aai** framework. Generate
or update files based on the user's description in `$ARGUMENTS`.

## Workflow

1. **Understand** — Restate what the user wants to build. If the request is
   vague, ask a clarifying question before writing code.
2. **Check existing work** — Look for a template or built-in tool that already
   does what the user needs before writing custom code.
3. **Start minimal** — Scaffold from the closest template, then layer on
   customizations. Don't over-engineer the first version.
4. **Iterate** — Make small, focused changes. Verify each change works before
   moving on.

## Getting started

### Use the `aai` CLI

Always use the `aai` CLI to scaffold and deploy agents:

```sh
aai new                  # Scaffold a new agent (interactive)
aai new -t <template>    # Scaffold from a specific template
aai deploy               # Bundle and deploy to production
aai deploy --dry-run     # Validate and bundle without deploying
```

Install: `curl -fsSL https://aai-agent.fly.dev/install | sh`

### Start from a template

Before writing an agent from scratch, **choose the closest template** and
scaffold with `aai new -t <template_name>`. Ask the user which template fits, or
recommend one based on their description. Fall back to `simple` if nothing else
fits.

Templates are in `../templates/` relative to the `aai` binary:

| Template            | Description                                                                        |
| ------------------- | ---------------------------------------------------------------------------------- |
| `simple`            | Minimal starter with web_search, visit_webpage, fetch_json, run_code. **Default.** |
| `web-researcher`    | Research assistant — web search + page visits for detailed answers                 |
| `smart-research`    | Phase-based research (gather → analyze → respond) with dynamic tool filtering      |
| `memory-agent`      | Persistent KV storage — remembers facts and preferences across conversations       |
| `code-interpreter`  | Writes and runs JavaScript for math, calculations, data processing                 |
| `math-buddy`        | Calculations, unit conversions, dice rolls via run_code                            |
| `health-assistant`  | Medication lookup, drug interactions, BMI, symptom guidance                        |
| `personal-finance`  | Currency conversion, crypto prices, loan calculations, savings projections         |
| `travel-concierge`  | Trip planning, weather, flights, hotels, currency conversion                       |
| `night-owl`         | Movie/music/book recs by mood, sleep calculator. **Has custom UI.**                |
| `dispatch-center`   | 911 dispatch with incident triage and resource assignment. **Has custom UI.**      |
| `infocom-adventure` | Zork-style text adventure with state, puzzles, inventory. **Has custom UI.**       |
| `embedded-assets`   | FAQ bot using embedded JSON knowledge (no web search)                              |
| `twilio-phone`      | Phone assistant with WebSocket + Twilio transports                                 |
| `terminal`          | STT-only mode for voice-driven kubectl commands                                    |

### Minimal agent

Every agent lives in `agent.ts` and exports a default `defineAgent()` call:

```ts
import { defineAgent } from "@aai/sdk";

export default defineAgent({
  name: "My Agent",
  instructions: "You are a helpful assistant that...",
  greeting: "Hey there. What can I help you with?",
  voice: "luna",
});
```

### Imports

```ts
import { defineAgent } from "@aai/sdk"; // Always needed
import { defineAgent, z } from "@aai/sdk"; // Tools with typed params
import { defineAgent, kvTools } from "@aai/sdk"; // Persistent memory helpers
import type { BeforeStepResult, HookContext, ToolContext } from "@aai/sdk"; // Type annotations
```

## Agent configuration

```ts
defineAgent({
  // Core
  name: string;              // Required: display name
  instructions?: string;     // System prompt (voice-first default provided)
  greeting?: string;         // Spoken on connect
  voice?: Voice;             // Rime TTS voice (default: "luna")

  // Speech
  sttPrompt?: string;        // STT guidance for jargon, names, acronyms

  // Tools
  builtinTools?: BuiltinTool[];
  tools?: Record<string, ToolDef>;
  toolChoice?: ToolChoice;   // "auto" | "required" | "none" | { type: "tool", toolName }
  maxSteps?: number | ((ctx: HookContext) => number);

  // Environment
  env?: string[];            // Env var names from .env (default: ["ASSEMBLYAI_API_KEY"])
  transport?: Transport[];   // "websocket" | "twilio" (default: ["websocket"])

  // State
  state?: () => S;           // Factory for per-session state

  // Lifecycle hooks
  onConnect?: (ctx: HookContext) => void | Promise<void>;
  onDisconnect?: (ctx: HookContext) => void | Promise<void>;
  onError?: (error: Error, ctx?: HookContext) => void;
  onTurn?: (text: string, ctx: HookContext) => void | Promise<void>;
  onStep?: (step: StepInfo, ctx: HookContext) => void | Promise<void>;
  onBeforeStep?: (stepNumber: number, ctx: HookContext) =>
    BeforeStepResult | Promise<BeforeStepResult>;
});
```

### Voices

Available voices: `luna` (default), `andromeda`, `celeste`, `orion`, `sirius`,
`lyra`, `estelle`, `esther`, `kima`, `bond`, `thalassa`, `vespera`, `moss`,
`fern`, `astra`, `tauro`, `walnut`, `arcana`, or any Rime speaker ID.

Use `sttPrompt` for domain-specific vocabulary:

```ts
export default defineAgent({
  voice: "orion",
  sttPrompt: "Transcribe technical terms: Kubernetes, gRPC, PostgreSQL",
});
```

### Writing good `instructions`

Optimize for spoken conversation:

- Short, punchy sentences — optimize for speech, not text
- Never mention "search results" or "sources" — speak as if knowledge is your
  own
- No visual formatting ("bullet point", "bold") — use "First", "Next", "Finally"
- Lead with the most important information
- Be concise and confident — no hedging ("It seems that", "I believe")
- No exclamation points — calm, conversational tone
- Define personality, tone, and specialty
- Include when and how to use each tool

### Environment variables

Variables in `env` are loaded from `.env` and passed as `ctx.env`. They are
**not** available via `Deno.env` inside agent code. `ASSEMBLYAI_API_KEY` is in
the global aai config — no need to add it to `.env`.

```ts
export default defineAgent({
  env: ["ASSEMBLYAI_API_KEY", "MY_API_KEY"],
  tools: {
    call_api: {
      description: "Call an external API",
      parameters: z.object({ query: z.string() }),
      execute: async (args, ctx) => {
        const res = await fetch(`https://api.example.com?q=${args.query}`, {
          headers: { Authorization: `Bearer ${ctx.env.MY_API_KEY}` },
        });
        return res.json();
      },
    },
  },
});
```

## Tools

### Custom tools

Define tools as plain objects in the `tools` record. The `parameters` field
takes a Zod schema for type-safe argument inference:

```ts
import { defineAgent, z } from "@aai/sdk";

export default defineAgent({
  name: "Weather Agent",
  tools: {
    get_weather: {
      description: "Get current weather for a city",
      parameters: z.object({
        city: z.string().describe("City name"),
      }),
      execute: async (args, ctx) => {
        const data = await fetch(
          `https://api.example.com/weather?q=${args.city}`,
        );
        return data.json();
      },
    },

    // No-parameter tools — omit `parameters`
    list_items: {
      description: "List all items",
      execute: () => items,
    },
  },
});
```

Zod schema patterns:

```ts
parameters: z.object({
  query: z.string().describe("Search query"),
  category: z.enum(["a", "b", "c"]),
  count: z.number().describe("How many"),
  label: z.string().describe("Optional label").optional(),
}),
```

### Built-in tools

Enable via `builtinTools`. `user_input` and `final_answer` are always
auto-included.

| Tool            | Description                                     | Params                              |
| --------------- | ----------------------------------------------- | ----------------------------------- |
| `web_search`    | Search the web (Brave Search)                   | `query`, `max_results?` (default 5) |
| `visit_webpage` | Fetch URL → Markdown                            | `url`                               |
| `fetch_json`    | HTTP GET a JSON API                             | `url`, `headers?`                   |
| `run_code`      | Execute JS in sandbox (no net/fs, 30s timeout)  | `code`                              |
| `user_input`    | Ask user a follow-up (auto-included)            | `question`                          |
| `final_answer`  | Deliver spoken response via TTS (auto-included) | `answer`                            |

The framework forces `final_answer` after `maxSteps - 1` iterations (default 4).

### Tool context

Every `execute` function and lifecycle hook receives a context object:

```ts
ctx.sessionId; // string — unique per connection
ctx.env; // Record<string, string> — env vars from .env
ctx.abortSignal; // AbortSignal — cancelled on interruption (tools only)
ctx.state; // per-session state
ctx.kv; // persistent KV store
ctx.messages; // readonly Message[] — conversation history (tools only)
```

Hooks get `HookContext` (same but without `abortSignal` and `messages`).

### Fetching external APIs

Use `fetch` directly in tool execute functions:

```ts
execute: async (args, ctx) => {
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${ctx.env.API_KEY}` },
  });
  if (!resp.ok) return { error: `${resp.status} ${resp.statusText}` };
  return resp.json();
},
```

## State and storage

### Per-session state

For data that lasts only one connection (games, workflows, multi-step
processes). Fresh state is created per session and cleaned up on disconnect:

```ts
export default defineAgent({
  state: () => ({ score: 0, question: 0 }),
  tools: {
    answer: {
      description: "Submit an answer",
      parameters: z.object({ answer: z.string() }),
      execute: (args, ctx) => {
        const state = ctx.state as { score: number; question: number };
        state.question++;
        return state;
      },
    },
  },
});
```

### Persistent storage (KV)

`ctx.kv` is a persistent key-value store scoped per agent. Values are
auto-serialized as JSON.

```ts
await ctx.kv.set("user:123", { name: "Alice" }); // save
await ctx.kv.set("temp:x", value, { expireIn: 60_000 }); // save with TTL
const user = await ctx.kv.get<User>("user:123"); // read (or null)
const notes = await ctx.kv.list("note:", { limit: 10, reverse: true }); // list
await ctx.kv.delete("user:123"); // delete
```

Keys are strings; use colon-separated prefixes (`"user:123"`). Max value: 64 KB.

#### `kvTools()` — drop-in persistent memory

Spreads four tools: `save_memory`, `recall_memory`, `list_memories`,
`forget_memory`:

```ts
import { defineAgent, kvTools } from "@aai/sdk";

export default defineAgent({
  name: "Memory Agent",
  tools: {
    ...kvTools(),
    // optionally customize: kvTools({ names: { save: "store_note" } })
  },
});
```

## Advanced patterns

### Step hooks

`onStep` — called after each LLM step (logging, analytics):

```ts
onStep: (step, ctx) => {
  console.log(`Step ${step.stepNumber}: ${step.toolCalls.length} tool calls`);
},
```

`onBeforeStep` — return `{ activeTools: [...] }` to filter tools per step:

```ts
state: () => ({ phase: "gather" }),
onBeforeStep: (stepNumber, ctx) => {
  const state = ctx.state as { phase: string };
  if (state.phase === "gather") {
    return { activeTools: ["search", "lookup", "final_answer"] };
  }
  return { activeTools: ["summarize", "final_answer"] };
},
```

### Dynamic `maxSteps`

```ts
maxSteps: (ctx) => {
  const state = ctx.state as { complexity: string };
  return state.complexity === "complex" ? 10 : 5;
},
```

### Conversation history in tools

```ts
execute: (args, ctx) => {
  const userMessages = ctx.messages.filter(m => m.role === "user");
  return { turns: userMessages.length };
},
```

### Phone agents (Twilio)

```ts
export default defineAgent({
  transport: ["websocket", "twilio"],
});
```

### Embedded knowledge

```ts
import knowledge from "./knowledge.json" with { type: "json" };

export default defineAgent({
  tools: {
    search_faq: {
      description: "Search the knowledge base",
      parameters: z.object({ query: z.string() }),
      execute: (args) =>
        knowledge.faqs.filter((f: { question: string }) =>
          f.question.toLowerCase().includes(args.query.toLowerCase())
        ),
    },
  },
});
```

### Using npm/jsr packages

```sh
npm install some-package
```

For JSR packages, add `.npmrc` with `@jsr:registry=https://npm.jsr.io`, then
`npm install @jsr/scope__package-name`. Import as bare specifiers — the bundler
resolves from `node_modules`.

## Custom UI (`client.ts`)

Add `client.ts` alongside `agent.ts`. Export a default Preact component — the
framework auto-mounts it. Use `htm` tagged templates instead of JSX:

```ts
import { html, useSession } from "@aai/ui";

export default function App() {
  const session = useSession();
  const msgs = session.messages.value;
  const tx = session.transcript.value;
  return html`
    <div>
      ${msgs.map((m, i) =>
        html`
          <p key="${i}">${m.text}</p>
        `
      )} ${tx && html`
        <p>${tx}</p>
      `}
      <button onClick="${() => session.toggle()}">Toggle</button>
      <button onClick="${() => session.reset()}">Reset</button>
    </div>
  `;
}
```

**Rules:**

- Export a default function component — do not call `mount()` yourself
- Import `html` from `@aai/ui` for tagged template rendering (no JSX)
- Import hooks from `preact/hooks` (`useEffect`, `useRef`, `useState`, etc.)
- Style with `style=${{ color: "red" }}` or inject `<style>` for selectors,
  keyframes, media queries

**Built-in components from `@aai/ui`:** `ErrorBanner`, `StateIndicator`,
`Transcript`, `ChatView`, `MessageBubble`, `ThinkingIndicator`

**Session signals (`useSession()`):**

| Signal                     | Type                   | Description                                                         |
| -------------------------- | ---------------------- | ------------------------------------------------------------------- |
| `session.state.value`      | `AgentState`           | "connecting", "ready", "listening", "thinking", "speaking", "error" |
| `session.messages.value`   | `Message[]`            | `{ role, text }` objects                                            |
| `session.transcript.value` | `string`               | Live speech-to-text                                                 |
| `session.error.value`      | `SessionError \| null` | `{ code, message }`                                                 |
| `session.started.value`    | `boolean`              | Whether session has started                                         |
| `session.running.value`    | `boolean`              | Whether session is active                                           |

**Methods:** `session.start()`, `session.toggle()`, `session.reset()`,
`session.dispose()`

## Common pitfalls

- **Writing `instructions` with visual formatting** — Bullets, bold, numbered
  lists sound terrible when spoken. Use natural transitions: "First", "Next",
  "Finally". Write instructions as if you're coaching a human phone operator.
- **Returning huge payloads from tools** — Everything a tool returns goes into
  the LLM context. Filter, summarize, or truncate API responses before
  returning. Return only what the agent needs to formulate a spoken answer.
- **Forgetting sandbox constraints** — Agent code runs in a Deno Worker with
  _all permissions disabled_ (no net, no fs, no env). Use `fetch` (proxied
  through the host) for HTTP. Use `ctx.env` for secrets. `Deno.readFile`,
  `Deno.env.get`, and direct network access will fail silently or throw.
- **Ignoring `ctx.abortSignal`** — When the user interrupts, in-flight tool
  calls are cancelled via `ctx.abortSignal`. Long-running tools (polling,
  multi-step fetches) should check `ctx.abortSignal.aborted` or pass the signal
  to `fetch`.
- **Hardcoding secrets** — Never put API keys in `agent.ts`. Add them to `.env`,
  list the key name in `env: [...]`, and access via `ctx.env.MY_KEY`.
- **Telling the agent to be verbose** — Voice responses should be 1-3 sentences.
  If your `instructions` say "provide detailed explanations", the agent will
  monologue. Instruct it to be brief and let the user ask follow-ups.

## Troubleshooting

- **"no agent found"** — Ensure `agent.ts` exists in the current directory
- **"bundle failed"** — TypeScript syntax error — check imports, brackets
