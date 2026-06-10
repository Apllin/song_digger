// Must stay in sync with python-service/app/core/genre_buckets.py GENRE_MAP.
export const GENRE_MAP: Record<string, string> = {
  Techno: "techno",
  "Hard Techno": "techno",
  Industrial: "techno",
  EBM: "techno",
  House: "house",
  "Tech House": "house",
  "Deep House": "house",
  "Afro House": "house",
  "Melodic House & Techno": "house",
  "Progressive House": "house",
  "Funky House": "house",
  "Jackin House": "house",
  "Drum & Bass": "drum_bass",
  Jungle: "drum_bass",
  Trance: "trance",
  "Psy-Trance": "trance",
  "Progressive Trance": "trance",
  Breaks: "breaks",
  Breakbeat: "breaks",
  "UK Garage": "breaks",
  Ambient: "ambient",
  Downtempo: "ambient",
  Chillout: "ambient",
};

export function genreToBucket(genre: string | null | undefined): string {
  if (!genre) return "other";
  return GENRE_MAP[genre] ?? "other";
}
