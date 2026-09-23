// Money / percentage formatting. Always shows exact dollars with cents.

// "$1,234.56" or "-$1,234.56" — sign-aware, always two decimals.
export function fmtUSD(x) {
  const n = Number(x) || 0;
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${sign}$${abs}`;
}

// "+$1,234.56" / "-$1,234.56" — like fmtUSD but always shows a leading + for gains.
export function fmtSignedUSD(x) {
  const n = Number(x) || 0;
  if (n > 0) return `+${fmtUSD(n)}`;
  return fmtUSD(n); // 0 and negatives handled by fmtUSD
}

export function fmtPct(x, digits = 1) {
  return `${(Number(x) || 0).toFixed(digits)}%`;
}

// ANSI color helpers for the terminal (the dashboard does its own CSS coloring).
const G = '\x1b[32m';
const R = '\x1b[31m';
const RS = '\x1b[0m';
export function colorUSD(x) {
  const n = Number(x) || 0;
  const s = fmtSignedUSD(n);
  if (n > 0) return `${G}${s}${RS}`;
  if (n < 0) return `${R}${s}${RS}`;
  return s;
}
