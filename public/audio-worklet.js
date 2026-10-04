class PCMPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.pos = 0;
    this.buffered = 0;
    this.started = false;
    this.rate = 12000;
    this.port.onmessage = ({ data }) => {
      if (data.reset) {
        this.queue = [];
        this.pos = 0;
        this.buffered = 0;
        this.started = false;
        return;
      }
      if (data.rate) this.rate = data.rate;
      if (data.samples) {
        if (this.buffered > this.rate * 0.5) {
          this.queue = [];
          this.pos = 0;
          this.buffered = 0;
          this.started = false;
        }
        this.queue.push(data.samples);
        this.buffered += data.samples.length;
      }
    };
  }
  process(_, outputs) {
    const out = outputs[0][0];
    if (!this.started && this.buffered > this.rate * 0.12) this.started = true;
    if (!this.started) return true;
    const step = this.rate / sampleRate;
    for (let i = 0; i < out.length; i++) {
      const q = this.queue[0];
      if (!q) {
        this.started = false;
        break;
      }
      const p = Math.floor(this.pos),
        next = p + 1 < q.length ? q[p + 1] : (this.queue[1]?.[0] ?? q[p]);
      out[i] = q[p] + (next - q[p]) * (this.pos - p);
      this.pos += step;
      this.buffered -= step;
      while (this.queue[0] && this.pos >= this.queue[0].length) {
        this.pos -= this.queue[0].length;
        this.queue.shift();
      }
    }
    return true;
  }
}
registerProcessor("pcm-player", PCMPlayer);
