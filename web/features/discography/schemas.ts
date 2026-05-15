import { z } from "zod";

export const releaseRoleSchema = z.enum(["Main", "all"]);
export type ReleaseRoleFilter = z.infer<typeof releaseRoleSchema>;

export const releaseSortSchema = z.enum(["year_desc", "year_asc"]);
export type ReleaseSort = z.infer<typeof releaseSortSchema>;

export const releasesQuerySchema = z.object({
  artistId: z.string(),
  role: releaseRoleSchema.default("all"),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(15),
  sort: releaseSortSchema.default("year_desc"),
});

export type ReleasesQuery = z.infer<typeof releasesQuerySchema>;
