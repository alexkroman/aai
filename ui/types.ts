/** Interval between WebSocket ping frames in milliseconds. */
export const PING_INTERVAL_MS = 30_000;
/** Maximum number of automatic reconnection attempts. */
export const MAX_RECONNECT_ATTEMPTS = 5;
/** Maximum backoff delay between reconnection attempts in milliseconds. */
export const MAX_BACKOFF_MS = 16_000;
/** Initial backoff delay between reconnection attempts in milliseconds. */
export const INITIAL_BACKOFF_MS = 1_000;
/** Microphone buffer duration in seconds before sending to the server. */
export const MIC_BUFFER_SECONDS = 0.1;

/** Current state of the voice agent session. */
export type AgentState =
  | "connecting"
  | "ready"
  | "listening"
  | "thinking"
  | "speaking"
  | "error";

/** A chat message exchanged between user and assistant. */
export type Message = {
  role: "user" | "assistant";
  text: string;
};

/** Category of session error. */
export type SessionErrorCode = "connection" | "audio" | "protocol";

/** Error reported by the voice session. */
export type SessionError = {
  readonly code: SessionErrorCode;
  readonly message: string;
};

/** Options for creating a voice session. */
export type SessionOptions = {
  /** Base URL of the AAI platform server. */
  platformUrl: string;
};
