export class Beeper {
  private context: AudioContext | undefined;

  unlock(): void {
    this.context ??= new AudioContext();
    void this.context.resume();
  }

  beep(): void {
    const context = this.context;
    if (!context) return;
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.3, now + 0.02);
    gain.gain.linearRampToValueAtTime(0, now + 0.4);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.45);
  }
}

export class SlouchAlarm {
  private badSince: number | undefined;
  private lastBeep = 0;

  constructor(
    private readonly beeper: Beeper,
    private readonly holdMs: number,
    private readonly repeatMs: number,
  ) {}

  update(isBad: boolean, now: number): boolean {
    if (!isBad) {
      this.badSince = undefined;
      return false;
    }
    this.badSince ??= now;
    if (now - this.badSince < this.holdMs) return false;
    if (now - this.lastBeep >= this.repeatMs) {
      this.lastBeep = now;
      this.beeper.beep();
    }
    return true;
  }
}
