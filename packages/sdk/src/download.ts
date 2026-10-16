import { AlexandriaError } from './errors.js';
import type { Book, Hex32 } from './types.js';

export async function downloadPdf(
  gateways: string[],
  book: Book,
  opts?: {
    onProgress?: (bytes: number) => void;
    signal?: AbortSignal;
    gatewayTimeoutMs?: number;
  }
): Promise<Blob> {
  if (!gateways || gateways.length === 0) {
    throw new AlexandriaError('UNREACHABLE', 'No gateways configured');
  }

  const timeoutMs = opts?.gatewayTimeoutMs ?? 15000;
  const targetHash = book.pdfSha256.toLowerCase();
  const externalSignal = opts?.signal;

  if (externalSignal?.aborted) {
    throw new DOMException('Download aborted', 'AbortError');
  }

  return new Promise<Blob>((resolve, reject) => {
    let settled = false;
    let anyBytesReturned = false;
    let attemptsRemaining = gateways.length;
    const controllers: AbortController[] = [];
    const timers: ReturnType<typeof setTimeout>[] = [];

    function cleanup() {
      for (const t of timers) clearTimeout(t);
      if (externalSignal) {
        externalSignal.removeEventListener('abort', onExternalAbort);
      }
    }

    function abortAll() {
      for (const c of controllers) {
        try {
          c.abort();
        } catch {
          // ignore
        }
      }
    }

    function onExternalAbort() {
      if (settled) return;
      settled = true;
      cleanup();
      abortAll();
      reject(new DOMException('Download aborted', 'AbortError'));
    }

    if (externalSignal) {
      externalSignal.addEventListener('abort', onExternalAbort);
    }

    function finishAttempt() {
      attemptsRemaining--;
      if (attemptsRemaining === 0 && !settled) {
        settled = true;
        cleanup();
        abortAll();
        if (anyBytesReturned) {
          reject(new AlexandriaError('INTEGRITY', 'Verification failed for all gateways'));
        } else {
          reject(new AlexandriaError('UNREACHABLE', 'No gateway reachable'));
        }
      }
    }

    let maxProgress = 0;

    gateways.forEach((gw, index) => {
      const delay = index * 2000;
      const startTimer = setTimeout(async () => {
        if (settled) return;

        const controller = new AbortController();
        controllers.push(controller);

        let gwTimer: ReturnType<typeof setTimeout> | null = null;
        function resetGwTimer() {
          if (gwTimer) clearTimeout(gwTimer);
          gwTimer = setTimeout(() => {
            controller.abort();
          }, timeoutMs);
          timers.push(gwTimer);
        }
        resetGwTimer();

        const base = gw.endsWith('/') ? gw.slice(0, -1) : gw;
        const url = `${base}/ipfs/${book.pdfCid}`;

        try {
          const res = await fetch(url, { signal: controller.signal });
          if (!res.ok || !res.body) {
            if (gwTimer) clearTimeout(gwTimer);
            finishAttempt();
            return;
          }

          const reader = res.body.getReader();
          const chunks: Uint8Array[] = [];
          let totalBytes = 0;

          while (true) {
            if (settled) {
              await reader.cancel();
              break;
            }
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              chunks.push(value);
              totalBytes += value.length;
              if (opts?.onProgress && totalBytes > maxProgress) {
                maxProgress = totalBytes;
                opts.onProgress(maxProgress);
              }
              resetGwTimer();
            }
          }

          if (gwTimer) clearTimeout(gwTimer);

          if (settled) return;

          if (totalBytes > 0) {
            anyBytesReturned = true;
          }

          // Combine chunks
          const fullBytes = new Uint8Array(totalBytes);
          let offset = 0;
          for (const chunk of chunks) {
            fullBytes.set(chunk, offset);
            offset += chunk.length;
          }

          // Compute sha256
          const digest = await crypto.subtle.digest('SHA-256', fullBytes);
          const hex = ('0x' +
            Array.from(new Uint8Array(digest))
              .map((b) => b.toString(16).padStart(2, '0'))
              .join('')
              .toLowerCase()) as Hex32;

          if (hex === targetHash) {
            // Match found!
            if (!settled) {
              settled = true;
              cleanup();
              abortAll();
              resolve(new Blob([fullBytes], { type: 'application/pdf' }));
            }
          } else {
            // Hash mismatch: never resolves, count as failed
            finishAttempt();
          }
        } catch {
          if (gwTimer) clearTimeout(gwTimer);
          finishAttempt();
        }
      }, delay);

      timers.push(startTimer);
    });
  });
}
