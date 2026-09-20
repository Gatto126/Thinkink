import { z } from 'zod';
import { apiErrorSchema } from '@thinkink/shared/contracts';

export class ApiError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function readApi<T>(
  path: string,
  schema: z.ZodType<T>,
  signal: AbortSignal,
  options?: RequestInit,
): Promise<T> {
  const response = await fetch(path, { ...options, signal });
  const body: unknown = await response.json();
  if (!response.ok) {
    const error = apiErrorSchema.safeParse(body);
    throw new ApiError(
      error.success
        ? error.data.error.message
        : 'Something went wrong. Please try again.',
      error.success ? error.data.error.code : 'UNKNOWN',
      response.status,
    );
  }
  const result = schema.safeParse(body);
  if (!result.success)
    throw new Error('This page could not be loaded. Please try again.');
  return result.data;
}
