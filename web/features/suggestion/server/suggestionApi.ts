import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import type { AppEnv } from "@/lib/hono/types";
import { getSuggestionsSuggestionsGet } from "@/lib/python-api/generated/clients/getSuggestionsSuggestionsGet";

const SuggestionsQuerySchema = z.object({
  q: z.string().trim().min(2).max(200),
});

// Soft-degrade on every failure mode (validation, upstream, network) — the
// SearchBar treats an empty list as "no autocomplete" and never surfaces
// suggestion errors to the user.
export const suggestionApi = new Hono<AppEnv>().get(
  "/suggestions",
  zValidator("query", SuggestionsQuerySchema, (result, c) => {
    if (!result.success) return c.json([] as string[]);
  }),
  async (c) => {
    const { q } = c.req.valid("query");
    try {
      const data = await getSuggestionsSuggestionsGet(
        { q },
        { baseURL: c.var.pythonServiceUrl, signal: AbortSignal.timeout(4000) },
      );
      return c.json(data);
    } catch {
      return c.json([] as string[]);
    }
  },
);
