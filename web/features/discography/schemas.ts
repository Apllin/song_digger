import { z } from "zod";

export const releasesQuerySchema = z.object({
  artistId: z.string(),
  role: z.enum(["Main", "all"]).default("all"),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(15),
  sort: z.enum(["year_desc", "year_asc"]).default("year_desc"),
});

export type ReleasesQuery = z.infer<typeof releasesQuerySchema>;
