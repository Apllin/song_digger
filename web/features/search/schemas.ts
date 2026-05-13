import { z } from "zod";

export const SEARCH_PAGE_SIZE = 18;

export const SearchQueryIdSchema = z.string().min(1).max(64).brand<"SearchQueryId">();
export type SearchQueryId = z.infer<typeof SearchQueryIdSchema>;

export const searchPageParamSchema = z.object({
  id: SearchQueryIdSchema,
});

export const searchPageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(SEARCH_PAGE_SIZE),
});

export type SearchPageQuery = z.infer<typeof searchPageQuerySchema>;
