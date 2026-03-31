'use client';

import { useEffect, useRef } from 'react';

export function usePolling(
  enabled: boolean,
  intervalMs: number,
  callback: () => void | Promise<void>
) {
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled || !Number.isFinite(intervalMs) || intervalMs <= 0) {
      return;
    }

    const timer = window.setInterval(() => {
      void callbackRef.current();
    }, intervalMs);

    return () => window.clearInterval(timer);
  }, [enabled, intervalMs]);
}

