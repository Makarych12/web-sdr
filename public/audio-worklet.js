class PCMPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.pos = 0;
    this.buffered = 0;
    this.started = false;
    this.rate = 12000;
    this.playedFrames = 0;
    this.underflowFrames = 0;
    this.everStarted = false;
    this.telemetryFrames = 0;
    this.targetSeconds = 0.2;
    this.port.onmessage = ({ data }) => {
      if (data.reset) {
        this.queue = [];
        this.pos = 0;
        this.buffered = 0;
        this.started = false;
        this.everStarted = false;
        return;
      }
      if (data.rate) this.rate = data.rate;
      if (data.samples) {
        if (this.buffered > this.rate * 0.75) {
          // Catch up to live audio without discarding the entire queue.
          while (this.buffered > this.rate * 0.3 && this.queue.length > 1) {
            this.buffered -= this.queue.shift().length - this.pos;
            this.pos = 0;
          }
        }
        this.queue.push(data.samples);
        this.buffered += data.samples.length;
      }
    };
  }
  process(_, outputs) {
    const out = outputs[0][0];
    this.telemetryFrames += out.length;
    if (this.telemetryFrames >= sampleRate) {
      this.telemetryFrames = 0;
      this.port.postMessage({
        type: "playback",
        playedFrames: this.playedFrames,
        underflowFrames: this.underflowFrames,
        buffered: this.buffered,
      });
    }
    if (!this.started && this.buffered > this.rate * this.targetSeconds) {
      this.started = true;
      this.everStarted = true;
    }
    if (!this.started) {
      if (this.everStarted) this.underflowFrames += out.length;
      return true;
    }
    const step = this.rate / sampleRate;
    for (let i = 0; i < out.length; i++) {
      const q = this.queue[0];
      if (!q) {
        this.started = false;
        this.underflowFrames += out.length - i;
        this.targetSeconds = Math.min(0.35, this.targetSeconds + 0.05);
        break;
      }
      const p = Math.floor(this.pos),
        next = p + 1 < q.length ? q[p + 1] : (this.queue[1]?.[0] ?? q[p]);
      out[i] = q[p] + (next - q[p]) * (this.pos - p);
      this.playedFrames++;
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
