const { normalizeErrorText, toClientFacingUpstreamError } = require('../lib/upstream-errors');

describe('upstream error helpers', () => {
  it('normalizes whitespace-heavy provider messages', () => {
    expect(normalizeErrorText('  rate   limit \n exceeded  ')).toBe('rate limit exceeded');
  });

  it('maps sensitive provider details to safe client messages', () => {
    expect(toClientFacingUpstreamError({
      status: 401,
      rawMessage: 'Invalid API key sk-secret',
      fallbackMessage: 'LLM request failed',
    })).toBe('Upstream provider rejected the request.');

    expect(toClientFacingUpstreamError({
      status: 429,
      rawMessage: 'rate limit exceeded for org abc',
      fallbackMessage: 'LLM request failed',
    })).toBe('Upstream provider rate limited the request.');
  });

  it('falls back to generic text for unexpected upstream failures', () => {
    expect(toClientFacingUpstreamError({
      status: 500,
      rawMessage: 'internal server error with stack trace',
      fallbackMessage: 'LLM request failed',
    })).toBe('LLM request failed');
  });
});
