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
    this.targetSeconds = 0.12;
    this.lastSample = 0;
    this.fade = 0;
    this.stableFrames = 0;
    this.port.onmessage = ({ data }) => {
      if (data.reset) {
        this.queue = [];
        this.pos = 0;
        this.buffered = 0;
        this.started = false;
        this.everStarted = false;
        this.targetSeconds = 0.12;
        this.lastSample = 0;
        this.fade = 0;
        this.stableFrames = 0;
        return;
      }
      if (data.rate) this.rate = data.rate;
      if (data.samples) {
        this.queue.push(data.samples);
        this.buffered += data.samples.length;
        if (this.buffered > this.rate * 0.45) {
          this.fade = 128;
          // Catch up to live audio without discarding the entire queue.
          while (
            this.buffered > this.rate * Math.max(0.18, this.targetSeconds) &&
            this.queue.length > 1
          ) {
            this.buffered -= this.queue.shift().length - this.pos;
            this.pos = 0;
          }
        }
        // Bound even a single oversized delivery to the latest live samples.
        if (this.buffered > this.rate * 0.45) {
          const tail = this.queue[0].subarray(
            -Math.floor(this.rate * Math.max(0.18, this.targetSeconds)),
          );
          this.queue = [tail];
          this.pos = 0;
          this.buffered = tail.length;
        }
      }
    };
  }
  process(_, outputs) {
    const out = outputs[0]?.[0];
    if (!out) return true;
    this.telemetryFrames += out.length;
    if (this.telemetryFrames >= sampleRate) {
      this.telemetryFrames = 0;
      this.port.postMessage({
        type: "playback",
        playedFrames: this.playedFrames,
        underflowFrames: this.underflowFrames,
        buffered: this.buffered,
        queueMs: (this.buffered / this.rate) * 1000,
        targetMs: this.targetSeconds * 1000,
      });
    }
    if (!this.started && this.buffered > this.rate * this.targetSeconds) {
      this.started = true;
      this.everStarted = true;
    }
    if (!this.started) {
      if (this.everStarted) this.underflowFrames += out.length;
      out.fill(0);
      return true;
    }
    const step = this.rate / sampleRate;
    for (let i = 0; i < out.length; i++) {
      const q = this.queue[0];
      if (!q) {
        // Fade the final sample into silence instead of a hard discontinuity.
        const fadeFrames = Math.min(64, out.length - i);
        for (let j = 0; j < fadeFrames; j++) {
          const s = Number.isFinite(this.lastSample) ? this.lastSample * (1 - (j + 1) / fadeFrames) : 0;
          out[i + j] = Number.isFinite(s) ? s : 0;
        }
        for (let j = i + fadeFrames; j < out.length; j++) {
          out[j] = 0;
        }
        this.lastSample = 0;
        this.started = false;
        this.pos = 0;
        this.buffered = 0;
        this.queue = [];
        this.underflowFrames += out.length - i;
        this.targetSeconds = Math.min(0.3, this.targetSeconds + 0.04);
        this.stableFrames = 0;
        this.fade = 128;
        break;
      }
      const p = Math.floor(this.pos);
      if (p >= q.length) {
        this.pos -= q.length;
        this.queue.shift();
        i--;
        continue;
      }
      const s0 = q[p];
      const s1 = p + 1 < q.length ? q[p + 1] : (this.queue[1]?.[0] ?? s0);
      let sample = s0 + (s1 - s0) * (this.pos - p);
      if (!Number.isFinite(sample)) sample = 0;

      if (this.fade > 0) {
        sample = this.lastSample + (sample - this.lastSample) * (1 - this.fade / 128);
        this.fade--;
      }
      this.lastSample = Number.isFinite(sample) ? sample : 0;
      out[i] = this.lastSample;
      this.stableFrames++;
      if (this.stableFrames > sampleRate * 60) {
        this.targetSeconds = Math.max(0.12, this.targetSeconds - 0.01);
        this.stableFrames = 0;
      }
      this.playedFrames++;
      this.pos += step;
      this.buffered = Math.max(0, this.buffered - step);
      while (this.queue[0] && this.pos >= this.queue[0].length) {
        this.pos -= this.queue[0].length;
        this.queue.shift();
      }
      if (!this.queue.length) {
        this.pos = 0;
        this.buffered = 0;
      }
    }
    return true;
  }
}
registerProcessor("pcm-player", PCMPlayer);
