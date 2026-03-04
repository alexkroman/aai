// PCM16 playback via ring buffer with pre-buffering.
const CAPACITY = 1440000; // ~60s at 24 kHz
const PRE_BUFFER = 4800; // 200ms at 24 kHz — absorb network jitter

class PCM16PlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._ring = new Float32Array(CAPACITY);
    this._readPos = 0;
    this._writePos = 0;
    this._count = 0;
    this._started = false;

    this.port.onmessage = (e) => {
      if (e.data === "flush") {
        this._readPos = 0;
        this._writePos = 0;
        this._count = 0;
        this._started = false;
        return;
      }
      const floats = e.data;
      const n = Math.min(floats.length, CAPACITY - this._count);
      const wp = this._writePos;
      const first = Math.min(n, CAPACITY - wp);
      this._ring.set(floats.subarray(0, first), wp);
      if (first < n) {
        this._ring.set(floats.subarray(first, n));
      }
      this._writePos = (wp + n) % CAPACITY;
      this._count += n;
    };
  }

  _readRing(output, count) {
    const rp = this._readPos;
    const first = Math.min(count, CAPACITY - rp);
    output.set(this._ring.subarray(rp, rp + first));
    if (first < count) {
      output.set(this._ring.subarray(0, count - first), first);
    }
    this._readPos = (rp + count) % CAPACITY;
  }

  process(_inputs, outputs) {
    const output = outputs[0][0];
    if (!output) return true;

    // Pre-buffer: wait until enough data before starting playback
    if (!this._started) {
      if (this._count < PRE_BUFFER) return true;
      this._started = true;
    }

    const n = Math.min(this._count, output.length);

    if (n > 0) {
      this._readRing(output, n);
      this._count -= n;
    }

    // Zero remaining samples on underrun (output is pre-zeroed, only needed after partial read)
    if (n > 0 && n < output.length) output.fill(0, n);

    return true;
  }
}
registerProcessor("pcm16-playback", PCM16PlaybackProcessor);
