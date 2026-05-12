import { z } from "zod";

// Mirrors SEARCH_PAGE_SIZE so the favorites and search grids paginate at the
// same cadence.
export const FAVORITES_PAGE_SIZE = 18;

export const favoritesPageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(FAVORITES_PAGE_SIZE),
});

export type FavoritesPageQuery = z.infer<typeof favoritesPageQuerySchema>;
