// minSamples passed via processorOptions at construction.
class PCM16Processor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this._min = options.processorOptions?.minSamples || 1600;
    this._buf = new Int16Array(this._min);
    this._len = 0;
  }
  process(inputs) {
    const input = inputs[0][0];
    if (input) {
      for (let i = 0; i < input.length; i++) {
        this._buf[this._len++] = Math.max(
          -32768,
          Math.min(32767, input[i] * 32768),
        );
      }
      if (this._len >= this._min) {
        const out = this._buf.slice(0, this._len);
        this.port.postMessage(out.buffer, [out.buffer]);
        this._buf = new Int16Array(this._min);
        this._len = 0;
      }
    }
    return true;
  }
}
registerProcessor("pcm16", PCM16Processor);
