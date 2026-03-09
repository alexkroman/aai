// Keep in sync with sdk/types.ts, sdk/fetch_json.ts, sdk/multi_tool.ts.

declare module "@aai/sdk" {
  import { z } from "zod";

  export { z } from "zod";

  export type Transport = "websocket" | "twilio";

  export type BuiltinTool =
    | "web_search"
    | "visit_webpage"
    | "fetch_json"
    | "run_code"
    | "user_input"
    | "final_answer";

  export type ToolContext<S = Record<string, unknown>> = {
    sessionId: string;
    env: Record<string, string>;
    signal?: AbortSignal;
    state: S;
  };

  export type HookContext<S = Record<string, unknown>> = {
    sessionId: string;
    env: Record<string, string>;
    state: S;
  };

  export type ToolDef = {
    description: string;
    parameters?: z.ZodObject<z.ZodRawShape>;
    execute: (
      args: Record<string, unknown>,
      ctx: ToolContext,
    ) => Promise<unknown> | unknown;
  };

  /** Helper that infers typed args from a Zod schema. */
  export function tool<P extends z.ZodObject<z.ZodRawShape>>(def: {
    description: string;
    parameters: P;
    execute: (
      args: z.infer<P>,
      ctx: ToolContext,
    ) => Promise<unknown> | unknown;
  }): ToolDef;
  export function tool(def: {
    description: string;
    execute: (
      args: Record<string, unknown>,
      ctx: ToolContext,
    ) => Promise<unknown> | unknown;
  }): ToolDef;

  export type ToolTuple =
    | [
      description: string,
      schema: z.ZodObject<z.ZodRawShape>,
      execute: ToolDef["execute"],
    ]
    | [description: string, execute: ToolDef["execute"]];

  export type ToolInput = ToolDef | ToolTuple;

  export type Voice =
    | "luna"
    | "andromeda"
    | "celeste"
    | "orion"
    | "sirius"
    | "lyra"
    | "estelle"
    | "esther"
    | "kima"
    | "bond"
    | "thalassa"
    | "vespera"
    | "moss"
    | "fern"
    | "astra"
    | "tauro"
    | "walnut"
    | "arcana"
    | (string & Record<never, never>);

  // deno-lint-ignore no-explicit-any
  export type AgentOptions<S = any> = {
    name: string;
    env?: string[];
    transport?: Transport | Transport[];
    instructions?: string;
    greeting?: string;
    voice?: Voice;
    prompt?: string;
    builtinTools?: BuiltinTool[];
    tools?: Record<string, ToolInput>;
    state?: () => S;
    onConnect?: (ctx: HookContext<S>) => void | Promise<void>;
    onDisconnect?: (ctx: HookContext<S>) => void | Promise<void>;
    onError?: (error: Error, ctx?: HookContext<S>) => void;
    onTurn?: (text: string, ctx: HookContext<S>) => void | Promise<void>;
  };

  export type AgentDef = {
    readonly name: string;
    readonly env: readonly string[];
    readonly transport: readonly Transport[];
    readonly instructions: string;
    readonly greeting: string;
    readonly voice: string;
    readonly prompt?: string;
    readonly builtinTools?: readonly BuiltinTool[];
    readonly tools: Readonly<Record<string, ToolDef>>;
    readonly state?: () => unknown;
    readonly onConnect?: AgentOptions["onConnect"];
    readonly onDisconnect?: AgentOptions["onDisconnect"];
    readonly onError?: AgentOptions["onError"];
    readonly onTurn?: AgentOptions["onTurn"];
  };

  export function defineAgent(options: AgentOptions): AgentDef;

  export function fetchJSON<T = unknown>(
    url: string,
    init?: RequestInit & { fetch?: typeof globalThis.fetch; fallback?: T },
  ): Promise<T>;

  export function httpError(status: number, statusText: string): Error;

  type ActionDef = {
    schema?: z.ZodObject<z.ZodRawShape>;
    execute: (
      args: Record<string, unknown>,
      ctx: ToolContext,
    ) => Promise<unknown> | unknown;
  };

  export function multiTool(opts: {
    description: string;
    actions: Record<string, ActionDef>;
  }): ToolDef;
}
