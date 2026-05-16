import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";

import { ReleasesQuerySchema } from "@/features/label/schemas";
import type { AppEnv } from "@/lib/hono/types";
import { getLabelReleasesCombined } from "@/lib/python-api/generated/clients/getLabelReleasesCombined";

export const labelApi = new Hono<AppEnv>().get(
  "/discography/label/releases",
  zValidator("query", ReleasesQuerySchema),
  async (c) => {
    const { labelId, labelName, page, perPage } = c.req.valid("query");
    const data = await getLabelReleasesCombined(
      Number(labelId),
      { label_name: labelName, page, per_page: perPage },
      { baseURL: c.var.pythonServiceUrl },
    );
    return c.json(data);
  },
);
