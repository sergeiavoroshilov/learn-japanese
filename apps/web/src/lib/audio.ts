/**
 * Owns the microphone: one capture shared by everything that needs audio.
 *
 * The onset detector and a WASM recognizer both want the same stream, and
 * opening `getUserMedia` twice costs a second permission-checked capture and
 * makes the two disagree about when a sound started.
 */
export class MicSource {
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;

  /**
   * @param preferredSampleRate Vosk models are trained at 16 kHz; browsers may
   * refuse the hint, so always read {@link sampleRate} back afterwards.
   */
  async start(preferredSampleRate?: number): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.ctx = preferredSampleRate
      ? new AudioContext({ sampleRate: preferredSampleRate })
      : new AudioContext();

    // iOS Safari hands back a suspended context, and awaiting getUserMedia
    // above has already spent the user gesture that would have started it.
    // A suspended context never fires onaudioprocess: the mic meter sits at
    // zero, the decoder is fed nothing, and the drill looks broken for no
    // visible reason. Resume explicitly, and say so if it refuses.
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    if (this.ctx.state !== 'running') {
      throw new Error(
        'Браузер не запустил обработку звука — нажмите «Начать сессию» ещё раз',
      );
    }

    this.source = this.ctx.createMediaStreamSource(this.stream);
  }

  get sampleRate(): number {
    return this.ctx?.sampleRate ?? 0;
  }

  createAnalyser(fftSize = 1024): AnalyserNode {
    if (!this.ctx || !this.source) throw new Error('Микрофон не запущен');
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = fftSize;
    analyser.smoothingTimeConstant = 0;
    this.source.connect(analyser);
    return analyser;
  }

  /**
   * Streams raw PCM to a recognizer that decodes in the page (Vosk/WASM).
   *
   * @param bufferSize samples per chunk — also how far behind the decoder can
   * be when we ask it to commit. 1024 at 16 kHz is 64 ms, small enough that a
   * 200 ms mora is not cut in half by an early flush.
   */
  onChunk(cb: (chunk: Float32Array, sampleRate: number) => void, bufferSize = 1024): void {
    if (!this.ctx || !this.source) throw new Error('Микрофон не запущен');
    const processor = this.ctx.createScriptProcessor(bufferSize, 1, 1);
    processor.onaudioprocess = (event) => {
      // The channel buffer is reused between callbacks — copy before it is
      // handed to a worker.
      cb(new Float32Array(event.inputBuffer.getChannelData(0)), this.ctx!.sampleRate);
    };
    this.source.connect(processor);
    // A ScriptProcessor only fires while connected to a destination; route it
    // through a silent gain node so the mic is not echoed to the speakers.
    const mute = this.ctx.createGain();
    mute.gain.value = 0;
    processor.connect(mute);
    mute.connect(this.ctx.destination);
    this.processor = processor;
  }

  stop(): void {
    if (this.processor) this.processor.onaudioprocess = null;
    this.processor?.disconnect();
    this.processor = null;
    this.source?.disconnect();
    this.source = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    void this.ctx?.close();
    this.ctx = null;
  }
}
