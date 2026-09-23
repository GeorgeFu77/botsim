// Time / period helpers for the 5-minute market grid.

export const nowMs = () => Date.now();
export const nowSec = () => Math.floor(Date.now() / 1000);

// The active 5-min window's start epoch (seconds), aligned to the 300s grid.
export function periodStartFor(epochSec, periodSeconds) {
  return Math.floor(epochSec / periodSeconds) * periodSeconds;
}

// Build the Polymarket slug for a given window-start epoch.
export function slugFor(prefix, periodStartSec) {
  return `${prefix}${periodStartSec}`;
}

// Human label for a window, e.g. "23:05–23:10 UTC".
export function windowLabel(periodStartSec, periodSeconds) {
  const a = new Date(periodStartSec * 1000);
  const b = new Date((periodStartSec + periodSeconds) * 1000);
  const hm = (d) => `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  return `${hm(a)}–${hm(b)} UTC`;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
