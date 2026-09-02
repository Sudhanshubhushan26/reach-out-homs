// Indian Rupee formatting utility — Indian number system (lakhs, crores)
// Usage: formatInr(250000) → "₹2,50,000"  |  formatInr(12500000) → "₹1,25,00,000"
export function formatInr(amount, { decimals = 0, symbol = "₹" } = {}) {
  const n = Number(amount) || 0;
  const formatted = n.toLocaleString("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `${symbol}${formatted}`;
}

// Abbreviated format for dashboard cards: ₹1.2L, ₹2.5Cr, ₹500
export function formatInrShort(amount, { symbol = "₹" } = {}) {
  const n = Number(amount) || 0;
  if (Math.abs(n) >= 10000000) return `${symbol}${(n / 10000000).toFixed(2)}Cr`;
  if (Math.abs(n) >= 100000) return `${symbol}${(n / 100000).toFixed(2)}L`;
  if (Math.abs(n) >= 1000) return `${symbol}${(n / 1000).toFixed(1)}k`;
  return `${symbol}${n.toFixed(0)}`;
}
