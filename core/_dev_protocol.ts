import { z } from "zod";

// ── Dev control WebSocket protocol ──────────────────────────────
//
// The CLI opens a control WebSocket to the production server.
// After a one-time registration handshake, the WebSocket becomes
// a transparent RPC channel using the same protocol as Worker
// postMessage (core/_rpc.ts). The server calls executeTool /
// invokeHook / getConfig over this channel exactly as it would
// call a local Worker.

// ── Registration handshake (before RPC starts) ──────────────────

export const DevRegisterSchema = z.object({
  type: z.literal("dev_register"),
  config: z.object({
    name: z.string().optional(),
    instructions: z.string(),
    greeting: z.string(),
    voice: z.string(),
    prompt: z.string().optional(),
    builtinTools: z.array(z.string()).optional(),
  }),
  toolSchemas: z.array(z.object({
    name: z.string(),
    description: z.string(),
    parameters: z.record(z.string(), z.unknown()),
  })),
  env: z.record(z.string(), z.string()),
  transport: z.array(z.enum(["websocket", "twilio"])),
  client: z.string(),
});
export type DevRegister = z.infer<typeof DevRegisterSchema>;

export const DevRegisteredSchema = z.object({
  type: z.literal("dev_registered"),
  slug: z.string(),
});
export type DevRegistered = z.infer<typeof DevRegisteredSchema>;
