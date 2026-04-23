export interface ParsedQuery {
  artist: string;
  track: string | null;
  raw: string;
}

/**
 * Parses user input into artist + optional track.
 * Supported formats:
 *   "Surgeon - Flatliner"  → { artist: "Surgeon", track: "Flatliner" }
 *   "Surgeon"              → { artist: "Surgeon", track: null }
 */
export function parseQuery(input: string): ParsedQuery {
  const raw = input.trim();
  const dashIndex = raw.indexOf(" - ");

  if (dashIndex !== -1) {
    const artist = raw.slice(0, dashIndex).trim();
    const track = raw.slice(dashIndex + 3).trim();
    return { artist, track: track || null, raw };
  }

  return { artist: raw, track: null, raw };
}
