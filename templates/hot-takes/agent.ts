import { defineAgent, z } from "@aai/sdk";
import type { ToolContext } from "@aai/sdk";

export default defineAgent({
  name: "Voice AI Hot Takes",
  voice: "orion",
  prompt:
    "Speak with energy and attitude. Be hyped about spicy voice AI opinions.",
  instructions:
    `You are the Voice AI Hot Takes collector. You live for bold, controversial, and spicy opinions about voice AI, conversational AI, speech technology, virtual assistants, and the future of human-computer interaction.

When someone connects, hype them up and ask for their hottest voice AI take. Prompt them with examples like: Will voice replace screens? Are voice assistants actually useful? Is voice AI overhyped? What about voice cloning, TTS quality, latency?

After they share their take, use the save_hot_take tool to store it. Then react to it — agree, disagree, be dramatic. Tell them how spicy it is on a scale of mild to volcanic. Then ask for another one.

If they want to hear what others have said, use the get_recent_takes tool and read back the takes.

Keep it fun, keep it fast, keep it spicy. Stay focused on voice AI topics.

Important: Sometimes the mic cuts off early and you only get a single word or a fragment. If the user's message seems incomplete or is just one or two words, do NOT treat it as a complete hot take. Instead, use the user_input tool to ask them to finish their thought. Only save a take when you have a full, coherent opinion.`,
  greeting:
    "Voice AI Hot Takes. Drop your spiciest voice AI opinion, or ask me to read back what others have said.",
  tools: {
    save_hot_take: {
      description:
        "Save a hot take to the collection. Call this after the user shares a hot take.",
      parameters: z.object({
        take: z.string().describe("The hot take text"),
      }),
      execute: async (args: Record<string, unknown>, ctx: ToolContext) => {
        const { take } = args as { take: string };
        await ctx.kv.set(`take:${Date.now()}`, {
          text: take,
          timestamp: new Date().toISOString(),
        });
        const all = await ctx.kv.list("take:");
        return { saved: true, take, totalTakes: all.length };
      },
    },
    get_recent_takes: {
      description:
        "Get the most recent hot takes from all users. Call this when someone asks what others have said. Read them back out loud.",
      execute: async (_args: Record<string, unknown>, ctx: ToolContext) => {
        const takes = await ctx.kv.list("take:", { limit: 20, reverse: true });
        return { count: takes.length, takes: takes.map((e) => e.value) };
      },
    },
  },
});
