import { type AgentConfig, DEFAULT_INSTRUCTIONS } from "@aai/sdk/types";

const VOICE_RULES =
  "\n\nCRITICAL OUTPUT RULES — you MUST follow these for EVERY response:\n" +
  "Your response will be spoken aloud by a TTS system and displayed as plain text.\n" +
  "- NEVER use markdown: no **, no *, no _, no #, no `, no [](), no ---\n" +
  "- NEVER use bullet points (-, *, •) or numbered lists (1., 2.)\n" +
  "- NEVER use code blocks or inline code\n" +
  "- NEVER mention tools, search, APIs, or technical failures to the user. " +
  "If a tool returns no results, just answer naturally without explaining why.\n" +
  "- Write exactly as you would say it out loud to a friend\n" +
  '- Use short conversational sentences. To list things, say "First," "Next," "Finally,"\n' +
  "- Keep responses concise — 1 to 3 sentences max";

export function buildSystemPrompt(
  config: AgentConfig,
  hasTools: boolean,
  opts?: { voice?: boolean },
): string {
  const greetingInstruction = config.greeting
    ? `\n\n[GREETING] When the conversation starts, say EXACTLY this and nothing else: "${config.greeting}". Do not paraphrase, do not add anything, do not summarize your instructions. Just say that greeting verbatim.`
    : "";

  const agentInstructions = config.instructions
    ? `\n\nAgent-Specific Instructions:\n${config.instructions}`
    : "";

  const toolReminder = hasTools
    ? "\n\nUse the provided tools to answer questions. " +
      "Never write tool calls as text in your response. " +
      "If a required parameter is missing, ask the user for it. " +
      'When calling a tool, say a brief phrase first (e.g. "Let me check on that").'
    : "";

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return greetingInstruction + "\n\n" + DEFAULT_INSTRUCTIONS +
    `\n\nToday's date is ${today}.` +
    agentInstructions + toolReminder +
    (opts?.voice ? VOICE_RULES : "");
}
