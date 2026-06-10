const CAMELOT_RE = /^(\d{1,2})([AB])$/;

function parseCamelot(s: string): { num: number; letter: "A" | "B" } | null {
  const m = s.match(CAMELOT_RE);
  if (!m) return null;
  const num = parseInt(m[1]!, 10);
  if (num < 1 || num > 12) return null;
  return { num, letter: m[2] as "A" | "B" };
}

/**
 * Harmonic-mixing compatibility on the Camelot wheel: same slot, the
 * relative major/minor (same number, other letter), or ±1 around the
 * wheel on the same scale type.
 */
export function isCamelotCompatible(a: string, b: string): boolean {
  const pa = parseCamelot(a);
  const pb = parseCamelot(b);
  if (!pa || !pb) return false;
  if (pa.num === pb.num) return true;
  if (pa.letter !== pb.letter) return false;
  const diff = Math.abs(pa.num - pb.num);
  return Math.min(diff, 12 - diff) === 1;
}
