export class HttpError extends Error {
  public constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function invariantHttp(
  condition: unknown,
  statusCode: number,
  code: string,
  message: string,
): asserts condition {
  if (!condition) {
    throw new HttpError(statusCode, code, message);
  }
}
