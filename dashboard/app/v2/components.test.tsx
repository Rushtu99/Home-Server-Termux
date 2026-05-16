import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EmptyState, ErrorState, LoadingState } from './components';

describe('v2 state components', () => {
  it('renders loading skeleton with accessible status label', () => {
    const { container } = render(<LoadingState label="Loading admin workspace" />);

    expect(screen.getByText('Loading admin workspace')).toBeInTheDocument();
    expect(container.querySelector('.dash2-loading__skeleton')).toBeTruthy();
    expect(container.querySelector('.dash2-loading')?.getAttribute('role')).toBe('status');
  });

  it('renders empty state title and message', () => {
    render(<EmptyState title="No data" message="Connect source and refresh." />);

    expect(screen.getByText('No data')).toBeInTheDocument();
    expect(screen.getByText('Connect source and refresh.')).toBeInTheDocument();
  });

  it('renders error state with alert semantics', () => {
    render(<ErrorState message="Network route probe failed." />);

    expect(screen.getByText('Action required')).toBeInTheDocument();
    expect(screen.getByText('Network route probe failed.')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
