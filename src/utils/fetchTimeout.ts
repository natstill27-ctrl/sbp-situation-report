/**
 * Fetch wrapper with AbortController timeout so hung connections cannot freeze UI loading states.
 */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 15000
): Promise<Response> {
  const controller = new AbortController();
  const upstreamSignal = init.signal;

  const onUpstreamAbort = () => controller.abort();
  if (upstreamSignal) {
    if (upstreamSignal.aborted) {
      controller.abort();
    } else {
      upstreamSignal.addEventListener('abort', onUpstreamAbort, { once: true });
    }
  }

  const timer = globalThis.setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError' && !upstreamSignal?.aborted) {
      throw new Error('หมดเวลาการเชื่อมต่อเซิร์ฟเวอร์ (เกิน 15 วินาที) กรุณาลองใหม่อีกครั้ง');
    }
    throw err;
  } finally {
    globalThis.clearTimeout(timer);
    if (upstreamSignal) {
      upstreamSignal.removeEventListener('abort', onUpstreamAbort);
    }
  }
}
