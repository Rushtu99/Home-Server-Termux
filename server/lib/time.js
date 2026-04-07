const parseDurationMs = (input, fallbackMs) => {
  const value = String(input || '').trim();
  if (!value) {
    return fallbackMs;
  }

  if (/^\d+$/.test(value)) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : fallbackMs;
  }

  const match = value.match(/^(\d+)(ms|s|m|h|d)$/i);
  if (!match) {
    return fallbackMs;
  }

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multipliers = {
    ms: 1,
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };

  return amount * multipliers[unit];
};

module.exports = {
  parseDurationMs,
};
