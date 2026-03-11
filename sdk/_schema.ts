export type Transport = "websocket" | "twilio";

export function normalizeTransport(
  value: Transport | Transport[] | undefined,
): Transport[] {
  if (value === undefined) return ["websocket"];
  if (typeof value === "string") return [value];
  return value;
}

export type BuiltinTool =
  | "web_search"
  | "visit_webpage"
  | "fetch_json"
  | "run_code"
  | "user_input"
  | "final_answer";

export type AgentConfig = {
  name?: string;
  instructions: string;
  greeting: string;
  voice: string;
  sttPrompt?: string;
  stopWhen?: number;
  builtinTools?: BuiltinTool[];
};

export type ToolSchema = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type DeployBody = {
  env: Record<string, string>;
  worker: string;
  client: string;
  transport?: Transport | Transport[];
  config: AgentConfig;
  toolSchemas?: ToolSchema[];
};

export type AgentEnv = {
  ASSEMBLYAI_API_KEY: string;
  LLM_MODEL?: string;
  [key: string]: unknown;
};
