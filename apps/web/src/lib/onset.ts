import type { MicSource } from './audio';

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
  start(mic: MicSource | null): Promise<void>;
  stop(): void;
  /** Arm for a new card; the callback fires once, with ms since arming. */
  arm(onOnset: (msSinceArm: number) => void): void;
  disarm(): void;
  /**
   * Fires when speech that had started falls back to silence. The drill uses
   * it to tell the decoder "the answer is over, commit now" instead of waiting
   * for the engine's own endpointing.
   */
  onSpeechEnd(cb: () => void): void;
  readonly level: number;
  readonly threshold: number;
}

export interface OnsetDetectorOptions {
  /** Frames above threshold required to call it speech. */
  framesToConfirm?: number;
  /** Silence needed before speech counts as finished. */
  silenceMs?: number;
  /** Multiple of the measured noise floor that counts as speech. */
  noiseMultiplier?: number;
  /** Absolute RMS floor, so a silent room cannot make the threshold ~0. */
  minThreshold?: number;
}

export class OnsetDetector implements OnsetSource {
  private analyser: AnalyserNode | null = null;
  private buffer: Float32Array<ArrayBuffer> = new Float32Array(0);
  private timer: number | null = null;

  private noiseFloor = 0.005;
  private calibrationSamples: number[] = [];
  private calibrating = true;

  private armedAt: number | null = null;
  private aboveCount = 0;
  private belowCount = 0;
  private speaking = false;
  /**
   * Set when a card is armed while the previous answer is still being spoken:
   * onset then waits for actual silence first, instead of reporting ~0 ms.
   */
  private awaitingSilence = false;
  private onOnset: ((msSinceArm: number) => void) | null = null;
  private speechEndListener: (() => void) | null = null;

  private peak = 0;

  private readonly framesToConfirm: number;
  private readonly noiseMultiplier: number;
  private readonly minThreshold: number;
  private readonly framesForSilence: number;

  constructor(opts: OnsetDetectorOptions = {}) {
    this.framesToConfirm = opts.framesToConfirm ?? 3;
    this.noiseMultiplier = opts.noiseMultiplier ?? 3.5;
    this.minThreshold = opts.minThreshold ?? 0.015;
    // A mora is short; ~160 ms of silence is enough to call it finished
    // without cutting off a trailing vowel.
    this.framesForSilence = Math.round((opts.silenceMs ?? 160) / 20);
  }

  /** Attaches to an already-open mic and starts measuring the noise floor. */
  async start(mic: MicSource): Promise<void> {
    const analyser = mic.createAnalyser();
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
    // Still hearing the previous answer — do not call that this card's onset.
    this.awaitingSilence = this.speaking;
  }

  onSpeechEnd(cb: () => void): void {
    this.speechEndListener = cb;
  }

  disarm(): void {
    this.armedAt = null;
    this.onOnset = null;
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.disarm();
    this.analyser?.disconnect();
    this.analyser = null;
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

    if (rms > this.threshold) {
      this.belowCount = 0;
      this.aboveCount++;
      if (!this.speaking && this.aboveCount >= this.framesToConfirm) {
        this.speaking = true;
        if (this.armedAt !== null && !this.awaitingSilence) {
          const onset = Math.round(performance.now() - this.armedAt);
          const cb = this.onOnset;
          this.onOnset = null;
          this.armedAt = null;
          // Subtract the frames it took to confirm, so we report the moment
          // speech actually crossed the threshold.
          cb?.(Math.max(0, onset - this.framesToConfirm * 20));
        }
      }
    } else {
      this.aboveCount = 0;
      this.belowCount++;
      if (this.belowCount >= this.framesForSilence) {
        if (this.speaking) {
          this.speaking = false;
          this.speechEndListener?.();
        }
        // Silence reached: a card armed mid-speech may now measure onset.
        this.awaitingSilence = false;
      }
    }
  }
}
