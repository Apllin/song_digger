import { z } from "zod";

import { normalizeArtist, normalizeTitle } from "@/lib/aggregator";

export const DislikeKeySchema = z.string().brand<"DislikeKey">();
export type DislikeKey = z.infer<typeof DislikeKeySchema>;

export function makeDislikeKey(artist: string, title: string): DislikeKey {
  return DislikeKeySchema.parse(`${normalizeArtist(artist)}|${normalizeTitle(title)}`);
}
