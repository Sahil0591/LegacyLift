pub fn calculate_interest_cents(
    balance_cents: i64,
    rate_basis_points: i64,
    days_in_period: i64,
) -> i64 {
    (balance_cents * rate_basis_points * days_in_period) / (10_000 * 365)
}
