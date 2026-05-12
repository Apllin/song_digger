import { z } from "zod";

export const ReleasesQuerySchema = z.object({
  labelId: z.string().trim().regex(/^\d+$/).max(12),
  page: z.coerce.number().int().positive().max(1000).default(1),
  perPage: z.coerce.number().int().positive().max(200).default(100),
});

export type ReleasesQuery = z.infer<typeof ReleasesQuerySchema>;
