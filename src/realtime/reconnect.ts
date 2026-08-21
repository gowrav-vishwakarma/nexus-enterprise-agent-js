/** Reconnect helpers for realtime connections (exponential backoff + jitter). */

export async function connectWithRetry<T>(
  connect: () => Promise<T>,
  options: {
    maxRetries?: number;
    baseDelay?: number;
    maxDelay?: number;
    jitter?: number;
  } = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  const baseDelay = options.baseDelay ?? 0.5;
  const maxDelay = options.maxDelay ?? 8.0;
  const jitter = options.jitter ?? 0.25;

  let attempt = 0;
  let lastError: unknown;
  while (attempt <= maxRetries) {
    try {
      return await connect();
    } catch (error) {
      lastError = error;
      if (attempt === maxRetries) break;
      const delay = Math.min(maxDelay, baseDelay * 2 ** attempt) + Math.random() * jitter;
      console.warn(
        `Realtime connect failed (attempt ${attempt + 1}/${maxRetries + 1}): ${String(error)}; retrying in ${delay.toFixed(2)}s`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay * 1000));
      attempt += 1;
    }
  }
  throw lastError;
}
