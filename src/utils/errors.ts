export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
    public readonly statusCode = 400,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}