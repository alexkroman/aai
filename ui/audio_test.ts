import { expect } from "@std/expect";
import { createAudioPlayer, startMicCapture } from "./audio.ts";

class MockMediaStreamTrack {
  stopped = false;
  stop() {
    this.stopped = true;
  }
}

class MockMediaStream {
  private tracks = [new MockMediaStreamTrack()];
  getTracks() {
    return this.tracks;
  }
}

class MockMessagePort {
  onmessage: ((e: MessageEvent) => void) | null = null;
  posted: unknown[] = [];
  postMessage(data: unknown, _transfer?: Transferable[]) {
    this.posted.push(data);
  }
  simulateMessage(data: unknown) {
    this.onmessage?.(new MessageEvent("message", { data }));
  }
}

class MockAudioWorkletNode {
  port = new MockMessagePort();
  connected: MockAudioNode[] = [];
  name: string;
  options: unknown;
  constructor(
    _ctx: MockAudioContext,
    name: string,
    options?: unknown,
  ) {
    this.name = name;
    this.options = options;
  }
  connect(dest: MockAudioNode) {
    this.connected.push(dest);
  }
}

class MockAudioNode {
  connected: (MockAudioNode | MockAudioWorkletNode)[] = [];
  connect(dest: MockAudioNode | MockAudioWorkletNode) {
    this.connected.push(dest);
  }
}

class MockGainNode extends MockAudioNode {
  gain = { value: 1 };
}

class MockAudioContext {
  sampleRate: number;
  state: AudioContextState = "running";
  destination = new MockAudioNode();
  audioWorklet = {
    modules: [] as string[],
    addModule(url: string) {
      this.modules.push(url);
      return Promise.resolve();
    },
  };
  closed = false;

  constructor(opts?: { sampleRate?: number }) {
    this.sampleRate = opts?.sampleRate ?? 44100;
  }
  resume() {
    return Promise.resolve();
  }
  createMediaStreamSource(_stream: MockMediaStream) {
    return new MockAudioNode();
  }
  createGain() {
    return new MockGainNode();
  }
  close() {
    this.closed = true;
    this.state = "closed";
    return Promise.resolve();
  }
}

class MockWebSocket {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  readyState: number;
  sent: unknown[] = [];

  constructor(readyState = MockWebSocket.OPEN) {
    this.readyState = readyState;
  }
  send(data: unknown) {
    this.sent.push(data);
  }
}

function withAudioMocks(
  fn: (
    ctx: {
      lastContext: () => MockAudioContext;
      lastWorkletNode: () => MockAudioWorkletNode;
    },
  ) => void | Promise<void>,
) {
  return async () => {
    const origAudioContext = globalThis.AudioContext;
    const origAudioWorkletNode = globalThis.AudioWorkletNode;
    const origWebSocket = globalThis.WebSocket;
    const origCreateObjectURL = URL.createObjectURL;
    const origRevokeObjectURL = URL.revokeObjectURL;
    // deno-lint-ignore no-explicit-any
    const nav = globalThis.navigator as any;
    const origGetUserMedia = nav?.mediaDevices?.getUserMedia;

    let _lastContext: MockAudioContext;
    let _lastWorkletNode: MockAudioWorkletNode;

    // Mock AudioContext
    // deno-lint-ignore no-explicit-any
    (globalThis as any).AudioContext = class extends MockAudioContext {
      constructor(opts?: { sampleRate?: number }) {
        super(opts);
        _lastContext = this;
      }
    };

    // Mock AudioWorkletNode
    // deno-lint-ignore no-explicit-any
    (globalThis as any).AudioWorkletNode = class extends MockAudioWorkletNode {
      constructor(ctx: MockAudioContext, name: string, options?: unknown) {
        super(ctx, name, options);
        _lastWorkletNode = this;
      }
    };

    // Mock WebSocket constants
    // deno-lint-ignore no-explicit-any
    (globalThis as any).WebSocket = MockWebSocket;

    // Mock getUserMedia
    if (!nav.mediaDevices) nav.mediaDevices = {};
    nav.mediaDevices.getUserMedia = () =>
      Promise.resolve(new MockMediaStream());

    // Mock URL blob methods
    URL.createObjectURL = () => "blob:mock";
    URL.revokeObjectURL = () => {};

    try {
      await fn({
        lastContext: () => _lastContext,
        lastWorkletNode: () => _lastWorkletNode,
      });
    } finally {
      globalThis.AudioContext = origAudioContext;
      globalThis.AudioWorkletNode = origAudioWorkletNode;
      globalThis.WebSocket = origWebSocket;
      URL.createObjectURL = origCreateObjectURL;
      URL.revokeObjectURL = origRevokeObjectURL;
      if (origGetUserMedia) {
        nav.mediaDevices.getUserMedia = origGetUserMedia;
      }
    }
  };
}

Deno.test("startMicCapture", async (t) => {
  await t.step(
    "returns a MicCapture with close()",
    withAudioMocks(async () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      const mic = await startMicCapture(ws, 16000, "mock-worklet-source");
      expect(typeof mic.close).toBe("function");
      mic.close();
    }),
  );

  await t.step(
    "loads the capture worklet module",
    withAudioMocks(async ({ lastContext }) => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      await startMicCapture(ws, 16000, "mock-worklet-source");
      expect(lastContext().audioWorklet.modules).toHaveLength(1);
    }),
  );

  await t.step(
    "creates AudioWorkletNode named 'pcm16'",
    withAudioMocks(async ({ lastWorkletNode }) => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      await startMicCapture(ws, 16000, "mock-worklet-source");
      expect(lastWorkletNode().name).toBe("pcm16");
    }),
  );

  await t.step(
    "sends worklet audio frames to WebSocket when open",
    withAudioMocks(async ({ lastWorkletNode }) => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      await startMicCapture(ws, 16000, "mock-worklet-source");

      const frame = new ArrayBuffer(3200);
      lastWorkletNode().port.simulateMessage(frame);

      expect((ws as unknown as MockWebSocket).sent).toHaveLength(1);
      expect((ws as unknown as MockWebSocket).sent[0]).toBe(frame);
    }),
  );

  await t.step(
    "does not send when WebSocket is closed",
    withAudioMocks(async ({ lastWorkletNode }) => {
      const ws = new MockWebSocket(
        MockWebSocket.CLOSED,
      ) as unknown as WebSocket;
      await startMicCapture(ws, 16000, "mock-worklet-source");

      lastWorkletNode().port.simulateMessage(new ArrayBuffer(3200));
      expect((ws as unknown as MockWebSocket).sent).toHaveLength(0);
    }),
  );

  await t.step(
    "close() stops media tracks and closes AudioContext",
    withAudioMocks(async ({ lastContext }) => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      const mic = await startMicCapture(ws, 16000, "mock-worklet-source");

      mic.close();

      expect(lastContext().closed).toBe(true);
    }),
  );

  await t.step(
    "cleans up stream and context on worklet load error",
    withAudioMocks(async () => {
      let _lastContext: MockAudioContext;
      // deno-lint-ignore no-explicit-any
      (globalThis as any).AudioContext = class extends MockAudioContext {
        constructor(opts?: { sampleRate?: number }) {
          super(opts);
          _lastContext = this;
          this.audioWorklet.addModule = () => Promise.reject(new Error("fail"));
        }
      };

      const ws = new MockWebSocket() as unknown as WebSocket;
      let caught = false;
      try {
        await startMicCapture(ws, 16000, "mock-worklet-source");
      } catch {
        caught = true;
      }
      expect(caught).toBe(true);
      expect(_lastContext!.closed).toBe(true);
    }),
  );

  await t.step(
    "connects source → worklet → destination",
    withAudioMocks(async ({ lastContext, lastWorkletNode }) => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      await startMicCapture(ws, 16000, "mock-worklet-source");

      expect(lastWorkletNode().connected).toContain(lastContext().destination);
    }),
  );
});

Deno.test("createAudioPlayer", async (t) => {
  await t.step(
    "returns an AudioPlayer with enqueue, flush, close",
    withAudioMocks(async () => {
      const player = await createAudioPlayer(24000, "mock-worklet-source");
      expect(typeof player.enqueue).toBe("function");
      expect(typeof player.flush).toBe("function");
      expect(typeof player.close).toBe("function");
      player.close();
    }),
  );

  await t.step(
    "creates AudioWorkletNode named 'pcm16-playback'",
    withAudioMocks(async ({ lastWorkletNode }) => {
      const player = await createAudioPlayer(24000, "mock-worklet-source");
      expect(lastWorkletNode().name).toBe("pcm16-playback");
      player.close();
    }),
  );

  await t.step(
    "enqueue() posts Float32Array converted from PCM16 to worklet port",
    withAudioMocks(async ({ lastWorkletNode }) => {
      const player = await createAudioPlayer(24000, "mock-worklet-source");

      const pcm16 = new Int16Array([100, -200, 300]).buffer;
      player.enqueue(pcm16);

      expect(lastWorkletNode().port.posted).toHaveLength(1);
      const posted = lastWorkletNode().port.posted[0] as Float32Array;
      expect(posted).toBeInstanceOf(Float32Array);
      expect(posted.length).toBe(3);
      player.close();
    }),
  );

  await t.step(
    "enqueue() is a no-op when context is closed",
    withAudioMocks(async ({ lastWorkletNode }) => {
      const player = await createAudioPlayer(24000, "mock-worklet-source");
      player.close(); // Closes context

      player.enqueue(new ArrayBuffer(64));
      expect(lastWorkletNode().port.posted).toHaveLength(0);
    }),
  );

  await t.step(
    "flush() posts 'flush' string to worklet port",
    withAudioMocks(async ({ lastWorkletNode }) => {
      const player = await createAudioPlayer(24000, "mock-worklet-source");

      player.flush();

      expect(lastWorkletNode().port.posted).toHaveLength(1);
      expect(lastWorkletNode().port.posted[0]).toBe("flush");
      player.close();
    }),
  );

  await t.step(
    "close() closes the AudioContext",
    withAudioMocks(async ({ lastContext }) => {
      const player = await createAudioPlayer(24000, "mock-worklet-source");
      player.close();
      expect(lastContext().closed).toBe(true);
    }),
  );

  await t.step(
    "connects worklet through gain to destination",
    withAudioMocks(async ({ lastContext, lastWorkletNode }) => {
      const player = await createAudioPlayer(24000, "mock-worklet-source");
      const gainNode = lastWorkletNode().connected[0] as MockGainNode;
      expect(gainNode).toBeInstanceOf(MockGainNode);
      expect(gainNode.connected).toContain(lastContext().destination);
      player.close();
    }),
  );
});
