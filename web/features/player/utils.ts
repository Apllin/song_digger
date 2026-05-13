export function formatTime(s: number): string {
  if (!isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

// Lazy singleton blob URL — created once per page load, never revoked.
// A real WAV file (vs. a MediaStream) is what Chrome uses to detect "tab has
// audio" and surface the media mini-player / tab indicator.
let _silentSrc: string | null = null;
export function silentWavSrc(): string {
  if (!_silentSrc && typeof URL !== "undefined") {
    const n = 8000; // 1 s @ 8 kHz mono 8-bit
    const buf = new ArrayBuffer(44 + n);
    const v = new DataView(buf);
    const w = (s: string, o: number) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    w("RIFF", 0);
    v.setUint32(4, 36 + n, true);
    w("WAVE", 8);
    w("fmt ", 12);
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, 8000, true);
    v.setUint32(28, 8000, true);
    v.setUint16(32, 1, true);
    v.setUint16(34, 8, true);
    w("data", 36);
    v.setUint32(40, n, true);
    new Uint8Array(buf, 44).fill(128); // 0x80 = midpoint = silence in unsigned 8-bit PCM
    _silentSrc = URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
  }
  return _silentSrc ?? "";
}
