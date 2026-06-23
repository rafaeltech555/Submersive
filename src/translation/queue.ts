export interface RetryOpts {
  retries: number
  baseMs: number
  sleep?: (ms: number) => Promise<void>
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export async function runWithRetry<T>(fn: () => Promise<T>, opts: RetryOpts): Promise<T> {
  const sleep = opts.sleep ?? defaultSleep
  let lastErr: unknown
  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (attempt < opts.retries) await sleep(opts.baseMs * 2 ** attempt)
    }
  }
  throw lastErr
}
