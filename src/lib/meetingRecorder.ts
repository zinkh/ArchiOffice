// Each segment has its own container header. Never send individual
// dataavailable chunks as standalone audio (only the first has a header).
export const RECORDING_SEGMENT_MS = 5 * 60_000;
export const RECORDING_SEGMENT_BYTES = 8 * 1024 * 1024;
export const TRANSCRIPTION_MAX_BYTES = 10 * 1024 * 1024;
export const RECORDING_MIME_TYPES = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus'];

export class MeetingRecorder {
  private stream?: MediaStream;
  private recorder?: MediaRecorder;
  private segments: Blob[] = [];
  private chunks: Blob[] = [];
  private bytes = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private ended = false;
  private rotation = false;
  private started = false;

  constructor(
    private onSnapshot: (segments: Blob[]) => void,
    private onStopped: () => void,
    private onError: (message: string) => void,
  ) {}

  async start() {
    if (this.started) return;
    this.started = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false });
      // Permission may arrive after the user navigated away.
      if (this.ended) { stream.getTracks().forEach(track => track.stop()); return; }
      this.stream = stream;
      stream.getAudioTracks().forEach(track => track.addEventListener('ended', () => {
        if (!this.ended) { this.onError('Microphone interrompu. Vérifiez puis relancez un enregistrement.'); this.stop(); }
      }));
      this.startSegment();
    } catch (error) {
      this.stop();
      throw error;
    }
  }

  private startSegment() {
    if (this.ended || !this.stream) return;
    this.rotation = false;
    this.chunks = [];
    this.bytes = 0;
    const mimeType = RECORDING_MIME_TYPES.find(type => MediaRecorder.isTypeSupported(type));
    const recorder = new MediaRecorder(this.stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 32_000 });
    this.recorder = recorder;
    recorder.ondataavailable = event => {
      if (!event.data.size) return;
      this.chunks.push(event.data);
      this.bytes += event.data.size;
      this.onSnapshot([...this.segments, new Blob(this.chunks, { type: recorder.mimeType || event.data.type })]);
      if (this.bytes >= RECORDING_SEGMENT_BYTES) this.rotate();
    };
    recorder.onerror = () => { this.onError('Enregistrement interrompu par le navigateur. L’audio reçu reste disponible.'); this.stop(); };
    recorder.onstop = () => {
      clearTimeout(this.timer);
      if (this.chunks.length) {
        this.segments.push(new Blob(this.chunks, { type: recorder.mimeType || this.chunks[0].type }));
        this.chunks = [];
        this.onSnapshot([...this.segments]);
      }
      if (this.ended) this.onStopped();
      else {
        try { this.startSegment(); }
        catch { this.onError('Impossible de poursuivre l’enregistrement. Les séquences reçues sont conservées.'); this.stop(); }
      }
    };
    recorder.start(5000);
    this.timer = setTimeout(() => this.rotate(), RECORDING_SEGMENT_MS);
  }

  private rotate() {
    if (this.rotation || this.ended || this.recorder?.state !== 'recording') return;
    this.rotation = true;
    this.recorder.stop();
  }

  stop() {
    if (this.ended) return;
    this.ended = true;
    clearTimeout(this.timer);
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    else if (!this.rotation) this.onStopped();
    this.stream?.getTracks().forEach(track => track.stop());
  }
}
