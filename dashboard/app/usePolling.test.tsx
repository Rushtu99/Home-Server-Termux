import { render } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePolling } from './usePolling';

function PollHarness({ enabled, intervalMs, onTick }: { enabled: boolean; intervalMs: number; onTick: () => void }) {
  const [count, setCount] = useState(0);
  usePolling(enabled, intervalMs, () => {
    onTick();
    setCount((value) => value + 1);
  });
  useEffect(() => {}, [count]);
  return <div data-testid="count">{count}</div>;
}

describe('usePolling', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls callback on interval while enabled', () => {
    vi.useFakeTimers();
    const onTick = vi.fn();
    render(<PollHarness enabled intervalMs={1000} onTick={onTick} />);
    vi.advanceTimersByTime(3200);
    expect(onTick).toHaveBeenCalledTimes(3);
  });

  it('does not schedule timer when disabled', () => {
    vi.useFakeTimers();
    const onTick = vi.fn();
    render(<PollHarness enabled={false} intervalMs={1000} onTick={onTick} />);
    vi.advanceTimersByTime(3000);
    expect(onTick).not.toHaveBeenCalled();
  });
});
