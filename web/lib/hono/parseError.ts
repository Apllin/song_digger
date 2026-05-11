import { ErrorLikeSchema, getErrorMessage, getErrorName } from "@vanya2h/utils/common";
import { DetailedError } from "hono/client";

/**
 * Extension of `getErrorMessage` but with additional handling of Hono's `DetailedError`
 */

export function parseErrorMessage(error: unknown): string {
  if (error instanceof DetailedError) {
    if ("data" in error.detail) {
      const parsedError = ErrorLikeSchema.safeParse(error.detail.data);
      if (parsedError.success) {
        return parseErrorMessage(parsedError.data);
      }
    }
  }
  return getErrorMessage(error);
}

/**
 * Extension of `getErrorName` but with additional handling of Hono's `DetailedError`
 */

export function parseErrorName(error: unknown): string {
  if (error instanceof DetailedError) {
    if ("data" in error.detail) {
      const parsedError = ErrorLikeSchema.safeParse(error.detail.data);
      if (parsedError.success) {
        return parseErrorName(parsedError.data);
      }
    }
  }
  return getErrorName(error);
}
