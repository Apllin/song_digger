export interface MockTrack {
  id: string;
  title: string;
  artist: string;
  source: "youtube_music" | "cosine_club" | "yandex_music" | "lastfm" | "trackidnet";
  sourceUrl: string;
  coverUrl: string;
}

export const SOURCE_LABEL: Record<MockTrack["source"], string> = {
  youtube_music: "YouTube Music",
  cosine_club: "Cosine.club",
  yandex_music: "Yandex.Music",
  lastfm: "Last.fm",
  trackidnet: "trackid.net",
};

export const MOCK_QUERY = "Floating Points - Last Bloom";

export const MOCK_TRACKS: MockTrack[] = [
  {
    id: "t1",
    title: "Strangelove",
    artist: "Bicep",
    source: "youtube_music",
    sourceUrl: "https://music.youtube.com/watch?v=strangelove",
    coverUrl: "https://picsum.photos/seed/strangelove/600/600",
  },
  {
    id: "t2",
    title: "Birds (Robag Wruhme Slow Mix)",
    artist: "Floating Points",
    source: "cosine_club",
    sourceUrl: "https://cosine.club/track/birds-slow",
    coverUrl: "https://picsum.photos/seed/birds/600/600",
  },
  {
    id: "t3",
    title: "Avenue",
    artist: "Roland Tings",
    source: "youtube_music",
    sourceUrl: "https://music.youtube.com/watch?v=avenue",
    coverUrl: "https://picsum.photos/seed/avenue/600/600",
  },
  {
    id: "t4",
    title: "Glue",
    artist: "Bicep",
    source: "youtube_music",
    sourceUrl: "https://music.youtube.com/watch?v=glue",
    coverUrl: "https://picsum.photos/seed/glue/600/600",
  },
  {
    id: "t5",
    title: "Las Salinas",
    artist: "DJ Tennis",
    source: "yandex_music",
    sourceUrl: "https://music.yandex.ru/track/las-salinas",
    coverUrl: "https://picsum.photos/seed/salinas/600/600",
  },
  {
    id: "t6",
    title: "Waterfall",
    artist: "Rrose",
    source: "cosine_club",
    sourceUrl: "https://cosine.club/track/waterfall",
    coverUrl: "https://picsum.photos/seed/waterfall/600/600",
  },
  {
    id: "t7",
    title: "Reflection",
    artist: "Joy Orbison",
    source: "lastfm",
    sourceUrl: "https://last.fm/music/joy-orbison",
    coverUrl: "https://picsum.photos/seed/reflection/600/600",
  },
  {
    id: "t8",
    title: "Marble House",
    artist: "Four Tet",
    source: "youtube_music",
    sourceUrl: "https://music.youtube.com/watch?v=marble",
    coverUrl: "https://picsum.photos/seed/marble/600/600",
  },
  {
    id: "t9",
    title: "Nineteen Eighty Five",
    artist: "Floating Points",
    source: "youtube_music",
    sourceUrl: "https://music.youtube.com/watch?v=1985",
    coverUrl: "https://picsum.photos/seed/1985/600/600",
  },
  {
    id: "t10",
    title: "Skyless",
    artist: "Pole",
    source: "trackidnet",
    sourceUrl: "https://trackid.net/skyless",
    coverUrl: "https://picsum.photos/seed/skyless/600/600",
  },
  {
    id: "t11",
    title: "Aporia",
    artist: "Sully",
    source: "cosine_club",
    sourceUrl: "https://cosine.club/track/aporia",
    coverUrl: "https://picsum.photos/seed/aporia/600/600",
  },
  {
    id: "t12",
    title: "Erotic Discourse",
    artist: "Paranoid London",
    source: "yandex_music",
    sourceUrl: "https://music.yandex.ru/track/erotic-discourse",
    coverUrl: "https://picsum.photos/seed/discourse/600/600",
  },
];
