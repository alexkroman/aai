# AAI — Voice Agent Development Kit

Build and deploy voice agents powered by AssemblyAI (STT) + Claude (LLM) + Rime (TTS).

## Quick Reference

### Agent Definition (`agent.ts`)

Every agent exports a default `defineAgent()` call:

```ts
export default defineAgent({
  name: "My Agent",                    // Required: display name
  instructions: "You are a ...",       // System prompt (optional, has voice-first default)
  greeting: "Hi, how can I help?",     // Spoken on connect (optional)
  voice: "luna",                       // Rime TTS voice (optional, default: "luna")
  prompt: "Speak slowly and calmly",   // TTS voice guidance (optional)
  builtinTools: [                      // Optional subset of built-in tools
    "web_search",                      //   Search via Brave Search API
    "visit_webpage",                   //   Fetch & convert webpage to markdown
    "fetch_json",                      //   GET a JSON REST API
    "run_code",                        //   Execute JS in sandboxed Deno worker
    "user_input",                      //   Ask user a follow-up question
    "final_answer",                    //   Deliver response (always auto-included)
  ],
  tools: {                             // Custom tools (optional)
    my_tool: {
      description: "What this tool does",
      parameters: {                    // JSON Schema — must be type "object"
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
        },
        required: ["query"],
      },
      execute: async (args, ctx) => {  // ctx has { secrets, fetch, signal }
        const res = await ctx.fetch(`https://api.example.com?q=${args.query}`);
        return await res.json();
      },
    },
  },
  // Lifecycle hooks (optional)
  onConnect: (ctx) => {},              // ctx: { sessionId }
  onDisconnect: (ctx) => {},
  onError: (error, ctx) => {},
  onTurn: (text, ctx) => {},
});
```

### Available Voices

TTS uses Rime's Arcana model. Popular voices: `luna` (default), `andromeda`, `celeste`,
`orion`, `sirius`, `lyra`, `estelle`, `kima`, `bond`, `thalassa`, `vespera`, `moss`,
`fern`, `astra`, `tauro`. Full catalog: https://docs.rime.ai/api-reference/voices

### Project Layout

```
agent.ts          — Agent definition (defineAgent)
agent.json        — Deploy config: { slug, env, transport? }
client.tsx        — Optional custom UI (Preact)
.env              — ASSEMBLYAI_API_KEY (required), LLM_MODEL (optional)
```

### Key Types (`server/agent_types.ts`)

- `BuiltinTool` — Union: `"web_search" | "visit_webpage" | "fetch_json" | "run_code" | "user_input" | "final_answer"`
- `Voice` — Union of popular Rime voices + `(string & {})` for any valid Rime ID
- `ToolParameters` — Must be `{ type: "object", properties: {...}, required?: [...] }`
- `ToolDef` — `{ description, parameters, execute }`
- `ToolContext` — `{ secrets, fetch, signal? }`
- `AgentOptions` — Full agent config passed to `defineAgent()`

### CLI Commands

- `aai` or `aai dev` — Run agent locally
- `aai new` — Scaffold a new agent
- `aai deploy` — Deploy to production
- `aai types` — Generate types.d.ts for IDE support
