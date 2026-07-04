export function calculateInterestCents(
  balanceCents: bigint,
  rateBasisPoints: bigint,
  daysInPeriod: bigint,
): bigint {
  return (balanceCents * rateBasisPoints * daysInPeriod) / (10000n * 365n);
}
