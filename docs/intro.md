# aai

Build and deploy a voice AI agent with one command.

```bash
aai new
aai deploy
```

## @aai/sdk

Define your agent in `agent.ts`. That's the entire backend.

```typescript
import { defineAgent } from "@aai/sdk";

export default defineAgent({
  name: "My Agent",
  instructions: "You are a helpful assistant.",
  greeting: "Hey, how can I help?",
});
```

## Built-in Tools

Give your agent superpowers with built-in tools:

```typescript
export default defineAgent({
  name: "Research Agent",
  builtinTools: ["web_search", "visit_webpage", "fetch_json", "run_code"],
});
```

| Tool | What it does |
|------|-------------|
| `web_search` | Search the web |
| `visit_webpage` | Fetch a webpage as markdown |
| `fetch_json` | Call a JSON API |
| `run_code` | Run sandboxed JavaScript |
| `vector_search` | Search your RAG knowledge base |

Add custom tools to give your agent more abilities:

```typescript
import { defineAgent } from "@aai/sdk";
import { z } from "zod";

export default defineAgent({
  name: "Weather Agent",
  instructions: "You help people check the weather.",
  builtinTools: ["web_search"],
  tools: {
    get_weather: {
      description: "Get the current weather for a city",
      parameters: z.object({
        city: z.string().describe("City name"),
      }),
      execute: async ({ city }) => {
        const res = await fetch(`https://wttr.in/${city}?format=j1`);
        return await res.json();
      },
    },
  },
});
```

## @aai/ui

Your agent gets a web UI out of the box. Customize it in `client.tsx`:

```tsx
import { App, mount } from "@aai/ui";

mount(App, {
  title: "Acme Support",
  theme: {
    primary: "#ff6b00",
    bg: "#1a1a1a",
  },
});
```

Or build something fully custom using the provided components:

```tsx
import { mount, useSession } from "@aai/ui";

function MyApp() {
  const { session, started, start, toggle } = useSession();

  if (!started.value) return <button onClick={start}>Start</button>;

  return (
    <div>
      {session.messages.value.map((m, i) => <p key={i}>{m.text}</p>)}
      <button onClick={toggle}>Stop</button>
    </div>
  );
}

mount(MyApp);
```

## @aai/state

Keep track of things during a conversation with per-session state:

```typescript
export default defineAgent({
  name: "Quiz Agent",
  state: () => ({ score: 0, question: 1 }),
  tools: {
    check_answer: {
      description: "Check if the user's answer is correct",
      parameters: z.object({ answer: z.string() }),
      execute: ({ answer }, ctx) => {
        if (answer === "correct") ctx.state.score++;
        ctx.state.question++;
        return { score: ctx.state.score, next: ctx.state.question };
      },
    },
  },
});
```

## @aai/kv

A durable key-value store that persists across sessions. Available on every tool's context.

```typescript
// Inside any tool's execute function:
await ctx.kv.set("user:name", "Alice");
await ctx.kv.set("temp:code", "1234", { expireIn: 60_000 }); // TTL in ms

const name = await ctx.kv.get("user:name"); // "Alice"
const entries = await ctx.kv.list("user:"); // all keys starting with "user:"
await ctx.kv.delete("temp:code");
```

## @aai/vector

Vector search for building RAG agents. Ingest a site, then search it at runtime.

```typescript
export default defineAgent({
  name: "Docs Agent",
  instructions: "Answer questions using the knowledge base.",
  builtinTools: ["vector_search"],
});
```

## aai rag

One command to ingest a site into your agent's knowledge base:

```bash
aai rag https://docs.example.com/llms-full.txt
```

This fetches the content, chunks it, and uploads it to the vector store. Your agent can then search it at runtime using the `vector_search` tool.

## Secure by default

Agent code runs in a sandbox with all permissions disabled — no file system, no network, no environment variables. You write normal code and aai handles the rest safely.

- `fetch` works but is proxied through the host, which blocks requests to private/internal addresses
- Secrets are stored on the server via `aai env add` and injected at runtime through `ctx.env` — never bundled into your code
- The `run_code` built-in tool executes in a second layer of sandboxing with a 30-second timeout
- Built-in tools (web search, fetch, etc.) run on the host outside the sandbox so they can access the network, while your custom tools run inside it

You don't need to configure any of this. Every agent gets the same isolation out of the box.
