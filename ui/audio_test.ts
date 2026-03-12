// Copyright 2025 the AAI authors. MIT license.
import { assert, assertEquals, assertStrictEquals } from "@std/assert";
import { spy } from "@std/testing/mock";
import { createVoiceIO } from "./audio.ts";
import {
  findWorkletNode,
  MockAudioContext,
  withAudioMocks,
} from "./_test_utils.ts";

function noop() {}

function voiceOpts(
  overrides?: Partial<Parameters<typeof createVoiceIO>[0]>,
) {
  return {
    sttSampleRate: 16000,
    ttsSampleRate: 24000,
    captureWorkletSrc: "cap",
    playbackWorkletSrc: "play",
    onMicData: noop,
    ...overrides,
  };
}

Deno.test("createVoiceIO", async (t) => {
  await t.step(
    "returns a VoiceIO with enqueue, flush, close",
    withAudioMocks(async () => {
      const io = await createVoiceIO(voiceOpts());
      assertStrictEquals(typeof io.enqueue, "function");
      assertStrictEquals(typeof io.flush, "function");
      assertStrictEquals(typeof io.close, "function");
      await io.close();
    }),
  );

  await t.step(
    "uses TTS sample rate for the AudioContext",
    withAudioMocks(async ({ lastContext }) => {
      const io = await createVoiceIO(voiceOpts());
      assertStrictEquals(lastContext().sampleRate, 24000);
      await io.close();
    }),
  );

  await t.step(
    "loads both worklet modules in parallel",
    withAudioMocks(async ({ lastContext }) => {
      const io = await createVoiceIO(voiceOpts());
      assertStrictEquals(lastContext().audioWorklet.modules.length, 2);
      await io.close();
    }),
  );

  await t.step(
    "creates capture node with channelCount: 1",
    withAudioMocks(async ({ workletNodes }) => {
      const io = await createVoiceIO(voiceOpts());
      const capNode = findWorkletNode(workletNodes(), "capture-processor");
      const opts = capNode.options as Record<string, unknown>;
      assertStrictEquals(opts.channelCount, 1);
      assertStrictEquals(opts.channelCountMode, "explicit");
      await io.close();
    }),
  );

  await t.step(
    "capture sends start event on init",
    withAudioMocks(async ({ workletNodes }) => {
      const io = await createVoiceIO(voiceOpts());
      const capNode = findWorkletNode(workletNodes(), "capture-processor");
      assert(capNode.port.posted.some((p: unknown) => {
        try {
          assertEquals(p, { event: "start" });
          return true;
        } catch {
          return false;
        }
      }));
      await io.close();
    }),
  );

  await t.step(
    "capture calls onMicData when worklet sends chunks",
    withAudioMocks(async ({ workletNodes }) => {
      const onMicData = spy((_buf: ArrayBuffer) => {});
      const io = await createVoiceIO(voiceOpts({
        sttSampleRate: 16000,
        ttsSampleRate: 16000,
        onMicData,
      }));
      const capNode = findWorkletNode(workletNodes(), "capture-processor");

      // Each worklet chunk is 128 samples * 2 bytes = 256 bytes
      // bufferSamples = 16000 * 0.1 = 1600 samples = 3200 bytes
      // Need ~13 chunks to fill the buffer
      for (let i = 0; i < 13; i++) {
        const buf = new ArrayBuffer(256);
        const view = new Int16Array(buf);
        view.fill(16384); // 0.5 in int16
        capNode.port.simulateMessage({ event: "chunk", buffer: buf });
      }

      assert(onMicData.calls.length >= 1);
      const pcm16 = new Int16Array(onMicData.calls[0]!.args[0]);
      assertStrictEquals(pcm16[0], 16384);
      await io.close();
    }),
  );

  await t.step(
    "enqueue posts write event to playback worklet",
    withAudioMocks(async ({ workletNodes }) => {
      const io = await createVoiceIO(voiceOpts());

      io.enqueue(new Int16Array([100, -200, 300]).buffer);

      const playNode = findWorkletNode(workletNodes(), "playback-processor");
      const writes = playNode.port.posted.filter(
        (p) => (p as { event: string }).event === "write",
      );
      assertStrictEquals(writes.length, 1);
      await io.close();
    }),
  );

  await t.step(
    "enqueue is a no-op after close",
    withAudioMocks(async ({ workletNodes }) => {
      const io = await createVoiceIO(voiceOpts());

      await io.close();
      const countBefore = workletNodes().length;
      io.enqueue(new Int16Array([100]).buffer);
      // No new playback node should be created after close
      assertStrictEquals(workletNodes().length, countBefore);
    }),
  );

  await t.step(
    "flush sends interrupt to playback worklet",
    withAudioMocks(async ({ workletNodes }) => {
      const io = await createVoiceIO(voiceOpts());

      io.enqueue(new Int16Array([1, 2, 3]).buffer);
      const playNode = findWorkletNode(workletNodes(), "playback-processor");
      io.flush();

      assert(playNode.port.posted.some((p: unknown) => {
        try {
          assertEquals(p, { event: "interrupt" });
          return true;
        } catch {
          return false;
        }
      }));
      await io.close();
    }),
  );

  await t.step(
    "close stops media tracks and closes AudioContext",
    withAudioMocks(async ({ lastContext }) => {
      const io = await createVoiceIO(voiceOpts());
      await io.close();
      assertStrictEquals(lastContext().closed, true);
    }),
  );

  await t.step(
    "close is idempotent",
    withAudioMocks(async () => {
      const io = await createVoiceIO(voiceOpts());
      await io.close();
      await io.close(); // should not throw
    }),
  );

  await t.step(
    "cleans up on worklet load error",
    withAudioMocks(async () => {
      let _lastContext: MockAudioContext;
      // Override AudioContext to inject worklet failure
      const g = globalThis as unknown as Record<string, unknown>;
      g.AudioContext = class extends MockAudioContext {
        constructor(opts?: { sampleRate?: number }) {
          super(opts);
          _lastContext = this;
          this.audioWorklet.addModule = () => Promise.reject(new Error("fail"));
        }
      };

      let caught = false;
      try {
        await createVoiceIO(voiceOpts());
      } catch {
        caught = true;
      }
      assertStrictEquals(caught, true);
      assertStrictEquals(_lastContext!.closed, true);
    }),
  );
});
