export function createLogBatcher<T extends Record<string, number>>(
  initialMetrics: T,
  intervalMs: number = 60000
) {
  let lastLogTime = 0;
  let accumulatedMetrics = { ...initialMetrics };

  return {
    accumulate: (metrics: Partial<T>) => {
      for (const key in metrics) {
        if (typeof metrics[key] === "number") {
          (accumulatedMetrics[key] as any) += metrics[key] ?? 0;
        }
      }
    },
    shouldLog: () => {
      return Date.now() - lastLogTime >= intervalMs;
    },
    flush: (callback: (metrics: T) => void) => {
      const now = Date.now();
      if (now - lastLogTime >= intervalMs) {
        callback(accumulatedMetrics);
        lastLogTime = now;
        accumulatedMetrics = { ...initialMetrics };
        return true;
      }
      return false;
    },
    get metrics() {
      return accumulatedMetrics;
    }
  };
}
