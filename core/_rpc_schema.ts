import { z } from "zod";
import {
  type AgentConfig,
  AgentConfigSchema,
  type ToolSchema,
  ToolSchemaSchema,
  type Transport,
  TransportSchema,
} from "@aai/sdk/schema";

export type AgentMetadata = {
  slug: string;
  env: Record<string, string>;
  transport: Transport[];
  owner_hash?: string;
  config?: AgentConfig;
  toolSchemas?: ToolSchema[];
};

export const AgentMetadataSchema: z.ZodType<AgentMetadata> = z.object({
  slug: z.string(),
  env: z.record(z.string(), z.string()).default({}),
  transport: z.array(TransportSchema).default(["websocket"]),
  owner_hash: z.string().optional(),
  config: AgentConfigSchema.optional(),
  toolSchemas: z.array(ToolSchemaSchema).optional(),
});

export type RpcRequest =
  | {
    id: number;
    type: "executeTool";
    name: string;
    args: Record<string, unknown>;
    sessionId?: string;
    env?: Record<string, string>;
  }
  | {
    id: number;
    type: "invokeHook";
    hook: "onConnect" | "onDisconnect" | "onError" | "onTurn";
    sessionId: string;
    text?: string;
    error?: string;
    env?: Record<string, string>;
  }
  | { id: number; type: "execute"; code: string }
  | {
    id: number;
    type: "fetch";
    url: string;
    method: string;
    headers: Record<string, string>;
    body: string | null;
  }
  | {
    id: number;
    type: "kv";
    op: "get" | "set" | "del" | "list";
    key?: string;
    value?: string;
    ttl?: number;
    prefix?: string;
    limit?: number;
    reverse?: boolean;
  };

export const RpcRequestSchema: z.ZodType<RpcRequest> = z.discriminatedUnion(
  "type",
  [
    z.object({
      id: z.number(),
      type: z.literal("executeTool"),
      name: z.string(),
      args: z.record(z.string(), z.unknown()),
      sessionId: z.string().optional(),
      env: z.record(z.string(), z.string()).optional(),
    }),
    z.object({
      id: z.number(),
      type: z.literal("invokeHook"),
      hook: z.enum(["onConnect", "onDisconnect", "onError", "onTurn"]),
      sessionId: z.string(),
      text: z.string().optional(),
      error: z.string().optional(),
      env: z.record(z.string(), z.string()).optional(),
    }),
    z.object({
      id: z.number(),
      type: z.literal("execute"),
      code: z.string(),
    }),
    z.object({
      id: z.number(),
      type: z.literal("fetch"),
      url: z.string(),
      method: z.string(),
      headers: z.record(z.string(), z.string()),
      body: z.string().nullable(),
    }),
    z.object({
      id: z.number(),
      type: z.literal("kv"),
      op: z.enum(["get", "set", "del", "list"]),
      key: z.string().optional(),
      value: z.string().optional(),
      ttl: z.number().optional(),
      prefix: z.string().optional(),
      limit: z.number().optional(),
      reverse: z.boolean().optional(),
    }),
  ],
);

export type RpcResponse = {
  id: number;
  result?: unknown;
  error?: string;
};

export const RpcResponseSchema: z.ZodType<RpcResponse> = z.object({
  id: z.number(),
  result: z.unknown().optional(),
  error: z.string().optional(),
});
