import { getErrorMessage, getErrorName } from "@vanya2h/utils/common";
import { ErrorHandler } from "hono";
import { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";

export function createErrorHandler(): ErrorHandler {
  return (err, c) => {
    console.error(err);
    if ("data" in err) {
      console.log("Additional data:", JSON.stringify(err.data, null, 2));
    }
    if (err.cause) {
      console.error("Caused by:", err.cause);
    }
    return c.json(
      {
        success: false,
        message: getErrorMessage(err),
        name: getErrorName(err),
        context: extractData(err),
      },
      extractCode(err),
    );
  };
}

const ErrorWithDataLike = z.object({
  data: z.any(),
});

function extractData(err: unknown) {
  const parsed = ErrorWithDataLike.safeParse(err);
  if (parsed.success) {
    return parsed.data.data;
  }
  return null;
}

const ErrorCodeLike = z.object({
  code: z.number(),
});

function extractCode(err: unknown) {
  const parsed = ErrorCodeLike.safeParse(err);
  if (parsed.success) {
    const code = parsed.data.code;
    if (code >= 400 && code < 600) {
      return code as ContentfulStatusCode;
    }
  }
  return 500;
}
