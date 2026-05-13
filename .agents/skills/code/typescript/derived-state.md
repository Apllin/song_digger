# Derived State

Do not store a value in state when it can be computed from existing state. This applies to `useState`, Jotai atoms, Zustand slices, server-side variables, or any other state container.

Redundant state has two failure modes: the derivative falls out of sync with its source, and every setter must update both.

**Wrong — duplicating state:**
```ts
// React
const [playlist, setPlaylist] = useState<Track[]>([]);
const [playingIndex, setPlayingIndex] = useState<number | null>(null);
const [track, setTrack] = useState<Track | null>(null); // always playlist[playingIndex]

// Jotai
const playlistAtom = atom<Track[]>([]);
const playingIndexAtom = atom<number | null>(null);
const trackAtom = atom<Track | null>(null); // redundant
```

**Right — derive at read time:**
```ts
// React
const [playlist, setPlaylist] = useState<Track[]>([]);
const [playingIndex, setPlayingIndex] = useState<number | null>(null);
const track = playingIndex !== null ? (playlist[playingIndex] ?? null) : null;

// Jotai computed atom
const trackAtom = atom((get) => {
  const index = get(playingIndexAtom);
  return index !== null ? (get(playlistAtom)[index] ?? null) : null;
});
```

When writing setters, update only the source-of-truth state. Derived values follow automatically — never update both.
