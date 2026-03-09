import { createKv, defineAgent, z } from "@aai/sdk";

export default defineAgent({
  name: "Memory Agent",
  instructions: `You are a helpful assistant with persistent memory. You can \
remember facts, preferences, and notes across conversations.

When the user tells you something worth remembering, save it with a descriptive \
key. When they ask about something you might have saved, look it up.

Use save_memory for storing information and recall_memory for retrieving it. \
Use list_memories to see what you have stored. Be proactive about saving \
important details the user shares — names, preferences, ongoing projects, etc.

Keep responses concise and conversational. Never say "I saved that to my \
database" — just confirm naturally, like "Got it, I'll remember that."`,
  greeting:
    "Hey there. I'm an assistant with a long-term memory. Tell me things you want me to remember, and I'll recall them in future conversations.",
  builtinTools: ["web_search"],
  tools: {
    save_memory: {
      description:
        "Save a piece of information to persistent memory. Use a descriptive key like 'user:name' or 'project:status'.",
      parameters: z.object({
        key: z.string().describe(
          "A descriptive key for this memory (e.g. 'user:name', 'preference:color')",
        ),
        value: z.string().describe("The information to remember"),
      }),
      execute: async (args, ctx) => {
        const { key, value } = args as { key: string; value: string };
        const kv = createKv(ctx);
        await kv.set(key, value);
        return { saved: key };
      },
    },
    recall_memory: {
      description: "Retrieve a previously saved memory by its key.",
      parameters: z.object({
        key: z.string().describe("The key to look up"),
      }),
      execute: async (args, ctx) => {
        const { key } = args as { key: string };
        const kv = createKv(ctx);
        const value = await kv.get(key);
        if (value === null) return { found: false, key };
        return { found: true, key, value };
      },
    },
    list_memories: {
      description:
        "List all saved memory keys, optionally filtered by a pattern (e.g. 'user:*').",
      parameters: z.object({
        pattern: z.string().describe(
          "Glob pattern to filter keys (e.g. 'user:*'). Use '*' for all.",
        ).optional(),
      }),
      execute: async (args, ctx) => {
        const { pattern } = args as { pattern?: string };
        const kv = createKv(ctx);
        const keys = await kv.keys(pattern ?? "*");
        return { count: keys.length, keys };
      },
    },
    forget_memory: {
      description: "Delete a previously saved memory by its key.",
      parameters: z.object({
        key: z.string().describe("The key to delete"),
      }),
      execute: async (args, ctx) => {
        const { key } = args as { key: string };
        const kv = createKv(ctx);
        await kv.del(key);
        return { deleted: key };
      },
    },
  },
});
