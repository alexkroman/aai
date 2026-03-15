// Copyright 2025 the AAI authors. MIT license.
import { MIC_BUFFER_SECONDS } from "./types.ts";
import { resample } from "./resample.ts";

/** Configuration for creating a {@linkcode VoiceIO} instance. */
export type VoiceIOOptions = {
  /** Sample rate in Hz expected by the STT engine (e.g. 16000). */
  sttSampleRate: number;
  /** Sample rate in Hz used by the TTS engine (e.g. 22050). */
  ttsSampleRate: number;
  /** Source URL or data URI for the capture AudioWorklet processor. */
  captureWorkletSrc: string;
  /** Source URL or data URI for the playback AudioWorklet processor. */
  playbackWorkletSrc: string;
  /** Callback invoked with buffered PCM16 microphone data to send to the server. */
  onMicData: (pcm16: ArrayBuffer) => void;
};

/**
 * Audio I/O interface for voice capture and playback.
 *
 * Manages microphone capture via an AudioWorklet, resampling to the STT
 * sample rate, and TTS audio playback through a second AudioWorklet. Implements
 * {@linkcode AsyncDisposable} for resource cleanup.
 */
export type VoiceIO = AsyncDisposable & {
  /** Enqueue a PCM16 audio buffer for playback through the TTS pipeline. */
  enqueue(pcm16Buffer: ArrayBuffer): void;
  /** Signal that all TTS audio for the current turn has been enqueued.
   *  Resolves when the worklet has finished playing all buffered audio. */
  done(): Promise<void>;
  /** Immediately stop playback and discard any buffered TTS audio. */
  flush(): void;
  /** Release all audio resources (microphone, AudioContext, worklets). */
  close(): Promise<void>;
};

async function loadWorklet(
  ctx: AudioContext,
  source: string,
): Promise<void> {
  await ctx.audioWorklet.addModule(source);
}

/**
 * Create a {@linkcode VoiceIO} instance that captures microphone audio and
 * plays back TTS audio using the Web Audio API.
 *
 * The AudioContext runs at the TTS sample rate for playback fidelity.
 * Captured audio is resampled to the STT rate when the rates differ.
 *
 * @param opts - Voice I/O configuration options.
 * @returns A promise that resolves to a {@linkcode VoiceIO} handle.
 * @throws If microphone access is denied or AudioWorklet registration fails.
 */
export async function createVoiceIO(
  opts: VoiceIOOptions,
): Promise<VoiceIO> {
  const {
    sttSampleRate,
    ttsSampleRate,
    captureWorkletSrc,
    playbackWorkletSrc,
    onMicData,
  } = opts;

  // Use TTS rate for the context — playback fidelity is more perceptible.
  // Capture path resamples to STT rate if they differ.
  const contextRate = ttsSampleRate;
  const ctx = new AudioContext({
    sampleRate: contextRate,
    latencyHint: "playback",
  });
  await ctx.resume();

  // Single AudioContext owns both capture and playback — required for AEC.
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      sampleRate: contextRate,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  try {
    await Promise.all([
      loadWorklet(ctx, captureWorkletSrc),
      loadWorklet(ctx, playbackWorkletSrc),
    ]);
  } catch (err: unknown) {
    for (const t of stream.getTracks()) t.stop();
    await ctx.close().catch(() => {});
    throw err;
  }

  const mic = ctx.createMediaStreamSource(stream);
  const capNode = new AudioWorkletNode(ctx, "capture-processor", {
    channelCount: 1,
    channelCountMode: "explicit",
  });
  mic.connect(capNode);

  const chunkSizeBytes = Math.floor(sttSampleRate * MIC_BUFFER_SECONDS) * 2;
  let capBuffer = new ArrayBuffer(0);

  capNode.port.postMessage({ event: "start" });

  capNode.port.onmessage = (e: MessageEvent) => {
    if (e.data.event !== "chunk") return;
    const chunk = e.data.buffer as ArrayBuffer;

    let pcm16: ArrayBuffer;
    if (contextRate !== sttSampleRate) {
      const int16 = new Int16Array(chunk);
      const floats = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) floats[i] = int16[i]! / 32768;
      const resampled = resample(floats, {
        fromRate: contextRate,
        toRate: sttSampleRate,
      });
      const out = new Int16Array(resampled.length);
      for (let i = 0; i < resampled.length; i++) {
        const s = resampled[i]! * 32768;
        out[i] = s > 32767 ? 32767 : s < -32768 ? -32768 : s;
      }
      pcm16 = out.buffer as ArrayBuffer;
    } else {
      pcm16 = chunk;
    }

    const merged = new ArrayBuffer(capBuffer.byteLength + pcm16.byteLength);
    const mergedView = new Uint8Array(merged);
    mergedView.set(new Uint8Array(capBuffer), 0);
    mergedView.set(new Uint8Array(pcm16), capBuffer.byteLength);
    capBuffer = merged;

    if (capBuffer.byteLength >= chunkSizeBytes) {
      onMicData(capBuffer);
      capBuffer = new ArrayBuffer(0);
    }
  };

  let playNode: AudioWorkletNode | null = null;
  let onPlaybackStop: (() => void) | null = null;
  const lifecycle = new AbortController();

  function ensurePlayNode(): AudioWorkletNode {
    if (playNode) return playNode;
    const node = new AudioWorkletNode(ctx, "playback-processor", {
      processorOptions: { sampleRate: contextRate },
    });
    node.connect(ctx.destination);
    node.port.onmessage = (e: MessageEvent) => {
      if (e.data.event === "stop") {
        node.disconnect();
        if (playNode === node) playNode = null;
        onPlaybackStop?.();
        onPlaybackStop = null;
      }
    };
    playNode = node;
    return node;
  }

  const io: VoiceIO = {
    enqueue(pcm16Buffer: ArrayBuffer) {
      if (lifecycle.signal.aborted) return;
      if (pcm16Buffer.byteLength === 0) return;
      const node = ensurePlayNode();
      node.port.postMessage(
        { event: "write", buffer: new Uint8Array(pcm16Buffer) },
        [pcm16Buffer],
      );
    },

    done() {
      if (!playNode) return Promise.resolve();
      return new Promise<void>((resolve) => {
        onPlaybackStop = resolve;
        playNode!.port.postMessage({ event: "done" });
      });
    },

    flush() {
      if (playNode) playNode.port.postMessage({ event: "interrupt" });
    },

    async close() {
      if (lifecycle.signal.aborted) return;
      lifecycle.abort();
      capNode.port.postMessage({ event: "stop" });
      for (const t of stream.getTracks()) t.stop();
      await ctx.close().catch(() => {});
    },

    async [Symbol.asyncDispose]() {
      await io.close();
    },
  };
  return io;
}
