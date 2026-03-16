# aai

## aai deploy

One command that scaffolds and deploys a voice agent for you.

```bash
aai deploy
```

## aai/agent

Write a custom agent in a few lines of code:

```typescript
import { defineAgent } from "@aai/sdk";

export default defineAgent({
  name: "My Agent",
  instructions: "You are a helpful assistant.",
  greeting: "Hey, how can I help?",
});
```

## aai/agent/tools

Give your agent some built-in tools:

```typescript
export default defineAgent({
  name: "Research Agent",
  builtinTools: ["web_search", "visit_webpage", "fetch_json", "run_code"],
});
```

## aai/agent/tools/custom

Give your agent a custom tool:

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

## aai/ui

Make a UI for your voice agent in just a few lines of code:

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

## aai/ui/custom

Or build a completely custom UI using Preact:

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

## aai/state

Keep track of memory and state for your agent:

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

## aai/kv

A durable key-value store that persists across sessions:

```typescript
// Inside any tool's execute function:
await ctx.kv.set("user:name", "Alice");
await ctx.kv.set("temp:code", "1234", { expireIn: 60_000 }); // TTL in ms

const name = await ctx.kv.get("user:name"); // "Alice"
const entries = await ctx.kv.list("user:"); // all keys starting with "user:"
await ctx.kv.delete("temp:code");
```

## aai/vector

Vector search for building a RAG agent:

```typescript
export default defineAgent({
  name: "Docs Agent",
  instructions: "Answer questions using the knowledge base.",
  builtinTools: ["vector_search"],
});
```

## aai rag

One command to crawl, chunk, and upload your site's content to the vector store:

```bash
aai rag https://docs.example.com/llms-full.txt
```

## aai env

One command to store secrets on the server -- never in code:

```bash
aai env add MY_API_KEY        # prompts for the value
aai env add OPENAI_KEY        # add as many as you need
aai env ls                    # list what's set
aai env rm MY_API_KEY         # remove one
aai env pull                  # sync names into .env for local dev
```

Access secrets in any tool call:

```typescript
execute: async ({ query }, ctx) => {
  const res = await fetch("https://api.example.com/search", {
    headers: { Authorization: `Bearer ${ctx.env.MY_API_KEY}` },
  });
  return await res.json();
},
```
