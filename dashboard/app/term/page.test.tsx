import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import TerminalPage from './page';
import { isDemoMode } from '../demo-mode';
import { getDemoTerminalFrameUrl, getDemoTerminalLines } from '../demo-api';
import { useGatewayBase } from '../useGatewayBase';

vi.mock('../demo-mode', () => ({
  isDemoMode: vi.fn(),
}));

vi.mock('../demo-api', () => ({
  getDemoTerminalFrameUrl: vi.fn(),
  getDemoTerminalLines: vi.fn(),
}));

vi.mock('../useGatewayBase', () => ({
  useGatewayBase: vi.fn(),
}));

describe('/term page', () => {
  it('shows resolving state when gateway is unavailable', () => {
    vi.mocked(isDemoMode).mockReturnValue(false);
    vi.mocked(useGatewayBase).mockReturnValue('');

    render(<TerminalPage />);

    expect(screen.getByText('Gateway resolving')).toBeInTheDocument();
    expect(screen.getByText('Gateway is still resolving. The terminal will load automatically.')).toBeInTheDocument();
  });

  it('renders embedded terminal when gateway is ready', () => {
    vi.mocked(isDemoMode).mockReturnValue(false);
    vi.mocked(useGatewayBase).mockReturnValue('http://127.0.0.1:8088');

    render(<TerminalPage />);

    const frame = screen.getByTitle('Terminal');
    expect(frame).toBeInTheDocument();
    expect(frame).toHaveAttribute('src', 'http://127.0.0.1:8088/term/');
    expect(screen.getByRole('link', { name: 'Open In New Tab' })).toHaveAttribute('href', 'http://127.0.0.1:8088/term/');
  });

  it('renders demo transcript in demo mode', () => {
    vi.mocked(isDemoMode).mockReturnValue(true);
    vi.mocked(useGatewayBase).mockReturnValue('');
    vi.mocked(getDemoTerminalFrameUrl).mockReturnValue('https://demo.invalid/term/');
    vi.mocked(getDemoTerminalLines).mockReturnValue(['line one', 'line two']);

    render(<TerminalPage />);

    expect(screen.getByText('Demo terminal active')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Demo terminal output' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Demo terminal output' })).toHaveTextContent(/line one\s+line two/);
  });
});
