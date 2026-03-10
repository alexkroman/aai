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
