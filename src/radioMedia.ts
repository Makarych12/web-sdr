/** The persistent media element plays the real worklet PCM, never silent audio. */
export class RadioMedia {
  private output: MediaStreamAudioDestinationNode | null = null;
  constructor(
    readonly audio: HTMLAudioElement = new Audio(),
    private session: MediaSession | undefined = navigator.mediaSession,
  ) {
    audio.preload = "auto";
    audio.setAttribute("playsinline", "");
    audio.addEventListener("playing", this.playing);
    audio.addEventListener("pause", this.paused);
  }
  private playing = () => this.setState("playing");
  private paused = () => this.setState("paused");
  setState(state: MediaSessionPlaybackState) {
    if (this.session) this.session.playbackState = state;
  }
  attach(context: AudioContext, source: AudioNode) {
    this.releaseStream();
    this.output = context.createMediaStreamDestination();
    source.connect(this.output);
    this.audio.srcObject = this.output.stream;
  }
  async play() {
    await this.audio.play();
    this.setState("playing");
  }
  pause() {
    this.audio.pause();
    this.setState("paused");
  }
  metadata(receiver: string, frequencyHz: number, mode: string) {
    if (!this.session || typeof MediaMetadata === "undefined") return;
    this.session.metadata = new MediaMetadata({
      title: "UR4MTN WEB SDR",
      artist: receiver,
      album: `${(frequencyHz / 1000000).toFixed(6)} MHz · ${mode}`,
      artwork: [
        { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      ],
    });
  }
  actions(play: (() => void) | null, pause: (() => void) | null) {
    for (const [action, handler] of [
      ["play", play],
      ["pause", pause],
      ["stop", pause],
    ] as const) {
      try {
        this.session?.setActionHandler(action, handler);
      } catch {
        // Older browsers may expose only part of Media Session.
      }
    }
  }
  private releaseStream() {
    this.output?.stream.getTracks().forEach((track) => track.stop());
    this.output?.disconnect();
    this.output = null;
    this.audio.srcObject = null;
  }
  dispose() {
    this.actions(null, null);
    this.pause();
    this.audio.removeEventListener("playing", this.playing);
    this.audio.removeEventListener("pause", this.paused);
    this.releaseStream();
    if (this.session) {
      this.session.metadata = null;
      this.session.playbackState = "none";
    }
  }
}
