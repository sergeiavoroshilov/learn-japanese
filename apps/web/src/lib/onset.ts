/**
 * Energy-based speech-onset detector.
 *
 * The point of this spike is separating two very different numbers that the
 * ASR transcript conflates:
 *
 *   - onset  — how long the user took to start speaking (the learning metric:
 *              recall latency, feeds the FSRS grade);
 *   - ASR    — how long the engine took to report it after that (the platform
 *              cost, which decides whether variant A is usable at all).
 *
 * Measuring onset locally from mic energy keeps it honest and independent of
 * the recognizer. Silero VAD (@ricky0123/vad-web) is the upgrade path if a
 * plain RMS threshold proves too noisy in real rooms.
 */
/**
 * Where "the user started answering" comes from. The mic detector below is the
 * real one; the keyboard mock implements the same shape so the drill loop can
 * run without a microphone.
 */
export interface OnsetSource {
  start(): Promise<void>;
  stop(): void;
  /** Arm for a new card; the callback fires once, with ms since arming. */
  arm(onOnset: (msSinceArm: number) => void): void;
  disarm(): void;
  readonly level: number;
  readonly threshold: number;
}

export interface OnsetDetectorOptions {
  /** Frames above threshold required to call it speech. */
  framesToConfirm?: number;
  /** Multiple of the measured noise floor that counts as speech. */
  noiseMultiplier?: number;
  /** Absolute RMS floor, so a silent room cannot make the threshold ~0. */
  minThreshold?: number;
}

export class OnsetDetector implements OnsetSource {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private buffer: Float32Array<ArrayBuffer> = new Float32Array(0);
  private timer: number | null = null;

  private noiseFloor = 0.005;
  private calibrationSamples: number[] = [];
  private calibrating = true;

  private armedAt: number | null = null;
  private aboveCount = 0;
  private onOnset: ((msSinceArm: number) => void) | null = null;

  private peak = 0;

  private readonly framesToConfirm: number;
  private readonly noiseMultiplier: number;
  private readonly minThreshold: number;

  constructor(opts: OnsetDetectorOptions = {}) {
    this.framesToConfirm = opts.framesToConfirm ?? 3;
    this.noiseMultiplier = opts.noiseMultiplier ?? 3.5;
    this.minThreshold = opts.minThreshold ?? 0.015;
  }

  /** Requests the mic and starts measuring the room's noise floor. */
  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.ctx = new AudioContext();
    const source = this.ctx.createMediaStreamSource(this.stream);
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0;
    source.connect(analyser);
    this.analyser = analyser;
    this.buffer = new Float32Array(analyser.fftSize);

    this.calibrating = true;
    this.calibrationSamples = [];
    window.setTimeout(() => this.finishCalibration(), 700);

    this.timer = window.setInterval(() => this.tick(), 20);
  }

  private finishCalibration(): void {
    if (this.calibrationSamples.length > 0) {
      const sorted = [...this.calibrationSamples].sort((a, b) => a - b);
      this.noiseFloor = sorted[Math.floor(sorted.length * 0.9)];
    }
    this.calibrating = false;
  }

  get threshold(): number {
    return Math.max(this.noiseFloor * this.noiseMultiplier, this.minThreshold);
  }

  /** Current input level, for the mic meter in the UI. */
  get level(): number {
    return this.peak;
  }

  arm(onOnset: (msSinceArm: number) => void): void {
    this.armedAt = performance.now();
    this.aboveCount = 0;
    this.onOnset = onOnset;
  }

  disarm(): void {
    this.armedAt = null;
    this.onOnset = null;
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.disarm();
    this.analyser = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    void this.ctx?.close();
    this.ctx = null;
  }

  private tick(): void {
    const analyser = this.analyser;
    if (!analyser) return;
    analyser.getFloatTimeDomainData(this.buffer);

    let sum = 0;
    for (let i = 0; i < this.buffer.length; i++) sum += this.buffer[i] * this.buffer[i];
    const rms = Math.sqrt(sum / this.buffer.length);
    this.peak = rms;

    if (this.calibrating) {
      this.calibrationSamples.push(rms);
      return;
    }

    if (this.armedAt === null) return;

    if (rms > this.threshold) {
      this.aboveCount++;
      if (this.aboveCount >= this.framesToConfirm) {
        const onset = Math.round(performance.now() - this.armedAt);
        const cb = this.onOnset;
        this.disarm();
        // Subtract the frames it took to confirm, so we report the moment
        // speech actually crossed the threshold.
        cb?.(Math.max(0, onset - this.framesToConfirm * 20));
      }
    } else {
      this.aboveCount = 0;
    }
  }
}
