import { useEffect } from 'react';
export function useTopicVisit(id: string) {
  useEffect(() => {
    const controller = new AbortController();
    let timer: number | undefined;
    let sent = false;
    let retries = 0;
    async function record() {
      if (document.hidden || sent) return;
      sent = true;
      try {
        const response = await fetch(`/api/topics/${id}/views`, {
          method: 'POST',
          signal: controller.signal,
        });
        // A cached page may need to establish its first signed reader cookie.
        if (
          response.status === 202 &&
          !controller.signal.aborted &&
          retries++ < 1
        )
          timer = window.setTimeout(() => {
            sent = false;
            void record();
          }, 6000);
      } catch {
        /* Reading is independent of the popularity counter. */
      }
    }
    function visible() {
      clearTimeout(timer);
      if (!document.hidden && !sent)
        timer = window.setTimeout(() => void record(), 6000);
    }
    visible();
    document.addEventListener('visibilitychange', visible);
    return () => {
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [id]);
}
