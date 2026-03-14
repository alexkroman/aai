// Copyright 2025 the AAI authors. MIT license.
import { assertEquals, assertStrictEquals } from "@std/assert";
import { signal } from "@preact/signals";
import { ClientRpcTarget } from "./session.ts";
import type { AgentState, Message, SessionError } from "./types.ts";

function createTarget() {
  const state = signal<AgentState>("connecting");
  const messages = signal<Message[]>([]);
  const transcript = signal<string>("");
  const error = signal<SessionError | null>(null);
  let flushed = false;

  const target = new ClientRpcTarget({
    state,
    messages,
    transcript,
    error,
    voiceIO: () => ({
      enqueue() {},
      done() {},
      flush() {
        flushed = true;
      },
      close() {
        return Promise.resolve();
      },
      async [Symbol.asyncDispose]() {},
    }),
  });

  return {
    target,
    state,
    messages,
    transcript,
    error,
    wasFlushed: () => flushed,
  };
}

Deno.test("ClientRpcTarget event handling", async (t) => {
  await t.step("transcript partial updates transcript signal", () => {
    const { target, transcript, state } = createTarget();
    state.value = "listening";
    target.event({ type: "transcript", text: "hello wor", isFinal: false });
    assertStrictEquals(transcript.value, "hello wor");
    assertStrictEquals(state.value, "listening");
  });

  await t.step("transcript final updates transcript signal", () => {
    const { target, transcript } = createTarget();
    target.event({
      type: "transcript",
      text: "hello world",
      isFinal: true,
      turnOrder: 1,
    });
    assertStrictEquals(transcript.value, "hello world");
  });

  await t.step("turn adds user message and sets thinking", () => {
    const { target, state, messages, transcript } = createTarget();
    transcript.value = "partial text";
    target.event({ type: "turn", text: "What is the weather?" });
    assertStrictEquals(state.value, "thinking");
    assertStrictEquals(transcript.value, "");
    assertEquals(messages.value, [{
      role: "user",
      text: "What is the weather?",
    }]);
  });

  await t.step("chat adds assistant message and sets speaking", () => {
    const { target, state, messages } = createTarget();
    target.event({ type: "chat", text: "It's sunny today" });
    assertStrictEquals(state.value, "speaking");
    assertEquals(messages.value, [{
      role: "assistant",
      text: "It's sunny today",
    }]);
  });

  await t.step("tts_done sets state to listening", () => {
    const { target, state } = createTarget();
    state.value = "speaking";
    target.event({ type: "tts_done" });
    assertStrictEquals(state.value, "listening");
  });

  await t.step("cancelled flushes audio and sets listening", () => {
    const { target, state, wasFlushed } = createTarget();
    state.value = "speaking";
    target.event({ type: "cancelled" });
    assertStrictEquals(state.value, "listening");
    assertStrictEquals(wasFlushed(), true);
  });

  await t.step("reset clears all state and sets listening", () => {
    const { target, state, messages, transcript, error } = createTarget();
    // Simulate a mid-conversation state
    state.value = "thinking";
    messages.value = [
      { role: "user", text: "Hi" },
      { role: "assistant", text: "Hello!" },
    ];
    transcript.value = "some partial";
    error.value = { code: "stt", message: "old error" };

    target.event({ type: "reset" });

    assertStrictEquals(state.value, "listening");
    assertEquals(messages.value, []);
    assertStrictEquals(transcript.value, "");
    assertStrictEquals(error.value, null);
  });

  await t.step("reset from error state transitions to listening", () => {
    const { target, state, error } = createTarget();
    state.value = "error";
    error.value = { code: "llm", message: "bad" };
    target.event({ type: "reset" });
    assertStrictEquals(state.value, "listening");
    assertStrictEquals(error.value, null);
  });

  await t.step("error sets error signal and state", () => {
    const { target, state, error } = createTarget();
    state.value = "listening";
    target.event({ type: "error", code: "stt", message: "Connection lost" });
    assertStrictEquals(state.value, "error");
    assertEquals(error.value, { code: "stt", message: "Connection lost" });
  });

  await t.step("error codes are preserved", () => {
    const { target, error } = createTarget();
    for (
      const code of [
        "stt",
        "llm",
        "tts",
        "tool",
        "protocol",
        "connection",
        "audio",
        "internal",
      ] as const
    ) {
      target.event({ type: "error", code, message: `${code} error` });
      assertStrictEquals(error.value!.code, code);
    }
  });

  await t.step(
    "full turn lifecycle: transcript → turn → chat → listening",
    () => {
      const { target, state, messages, transcript } = createTarget();
      state.value = "listening";

      // User starts speaking — partial transcripts arrive
      target.event({ type: "transcript", text: "What", isFinal: false });
      assertStrictEquals(transcript.value, "What");
      assertStrictEquals(state.value, "listening");

      target.event({ type: "transcript", text: "What is", isFinal: false });
      assertStrictEquals(transcript.value, "What is");

      // STT finalizes the turn
      target.event({
        type: "turn",
        text: "What is the weather?",
        turnOrder: 1,
      });
      assertStrictEquals(state.value, "thinking");
      assertStrictEquals(transcript.value, "");
      assertStrictEquals(messages.value.length, 1);

      // LLM responds
      target.event({ type: "chat", text: "It's 72°F and sunny." });
      assertStrictEquals(state.value, "speaking");
      assertStrictEquals(messages.value.length, 2);

      // TTS finishes (no-audio path)
      target.event({ type: "tts_done" });
      assertStrictEquals(state.value, "listening");
    },
  );

  await t.step(
    "playAudioStream delivers audio and transitions to listening",
    async () => {
      const { state } = createTarget();
      state.value = "speaking";

      const chunks: ArrayBuffer[] = [];
      const target = new ClientRpcTarget({
        state,
        messages: signal<Message[]>([]),
        transcript: signal(""),
        error: signal<SessionError | null>(null),
        voiceIO: () => ({
          enqueue(buf: ArrayBuffer) {
            chunks.push(buf);
          },
          done() {},
          flush() {},
          close() {
            return Promise.resolve();
          },
          async [Symbol.asyncDispose]() {},
        }),
      });

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3, 4]));
          controller.close();
        },
      });

      target.playAudioStream(stream);
      // Wait for async reader to complete
      await new Promise((r) => setTimeout(r, 10));

      assertStrictEquals(chunks.length, 1);
      assertStrictEquals(state.value, "listening");
    },
  );
});
