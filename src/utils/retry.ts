/** Async retry utilities. */

export function retryAsync(
  maxRetries = 3,
  retryDelay = 1.0,
  retryOn: Array<abstract new (...args: any[]) => Error> = [Error],
) {
  return function <T extends (...args: unknown[]) => Promise<unknown>>(
    target: unknown,
    propertyKey: string | symbol,
    descriptor: TypedPropertyDescriptor<T>,
  ): TypedPropertyDescriptor<T> | void {
    const original = descriptor.value;
    if (!original) {
      return descriptor;
    }

    descriptor.value = async function (this: unknown, ...args: unknown[]) {
      let lastError: unknown;
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          return await original.apply(this, args);
        } catch (error) {
          lastError = error;
          const retryable = retryOn.some((Ctor) => error instanceof Ctor);
          if (!retryable || attempt >= maxRetries - 1) {
            throw error;
          }
          const delayMs = retryDelay * 1000 * 2 ** attempt;
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
      throw lastError;
    } as T;

    return descriptor;
  };
}

export async function retryWithBackoff<T>(
  func: () => Promise<T>,
  options: {
    max_retries?: number;
    base_delay?: number;
    retry_on?: Array<new (...args: unknown[]) => Error>;
  } = {},
): Promise<T> {
  const maxRetries = options.max_retries ?? 3;
  const baseDelay = options.base_delay ?? 1.0;
  const retryOn = options.retry_on ?? [Error];

  let lastException: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await func();
    } catch (error) {
      lastException = error;
      const retryable = retryOn.some((Ctor) => error instanceof Ctor);
      if (!retryable || attempt >= maxRetries) {
        break;
      }
      const delay = baseDelay * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, delay * 1000));
    }
  }
  throw lastException;
}

/** Functional wrapper matching Python's decorator factory usage. */
export function withRetryAsync<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
  options?: {
    max_retries?: number;
    retry_delay?: number;
    retry_on?: Array<new (...args: unknown[]) => Error>;
  },
): T {
  const maxRetries = options?.max_retries ?? 3;
  const retryDelay = options?.retry_delay ?? 1.0;
  const retryOn = options?.retry_on ?? [Error];

  const wrapped = (async (...args: Parameters<T>) => {
    let lastError: unknown;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await fn(...args);
      } catch (error) {
        lastError = error;
        const retryable = retryOn.some((Ctor) => error instanceof Ctor);
        if (!retryable || attempt >= maxRetries - 1) {
          throw error;
        }
        await new Promise((resolve) =>
          setTimeout(resolve, retryDelay * 1000 * 2 ** attempt),
        );
      }
    }
    throw lastError;
  }) as T;

  return wrapped;
}
