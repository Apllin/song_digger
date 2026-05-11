import { CustomError, CustomErrorOptions } from "@vanya2h/utils/common";
import { ClientErrorStatusCode, ServerErrorStatusCode } from "hono/utils/http-status";

export class HttpError<
  TCode extends ClientErrorStatusCode | ServerErrorStatusCode,
  TData = void,
> extends CustomError<TData> {
  constructor(
    readonly code: TCode,
    options: CustomErrorOptions<TData>,
  ) {
    super(options);
  }
}
