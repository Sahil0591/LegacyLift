package legacylift

func CalculateInterestCents(balanceCents int64, rateBasisPoints int64, daysInPeriod int64) int64 {
	return (balanceCents * rateBasisPoints * daysInPeriod) / (10000 * 365)
}
