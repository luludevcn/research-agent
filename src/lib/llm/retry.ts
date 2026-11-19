export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { retries?: number; baseMs?: number; label?: string } = {}
): Promise<T> {
  const { retries = 2, baseMs = 800, label = "llm" } = opts;
  let lastErr: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;
      const status = e?.status ?? e?.response?.status;
      const retriable = !status || status >= 500 || status === 429 || /timeout|ECONN|fetch failed/i.test(String(e));
      if (!retriable || i === retries) break;
      const wait = baseMs * 2 ** i;
      console.error(`[retry] ${label} 第 ${i + 1} 次失败，${wait}ms 后重试:`, String(e).slice(0, 120));
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}