import { z } from "zod";

export const DislikeKeySchema = z.string().brand<"DislikeKey">();
export type DislikeKey = z.infer<typeof DislikeKeySchema>;

export function makeDislikeKey(artistKey: string, titleKey: string): DislikeKey {
  return DislikeKeySchema.parse(`${artistKey}|${titleKey}`);
}
