long long calculate_interest_cents(
    long long balance_cents,
    long long rate_basis_points,
    int days_in_period
) {
    return (balance_cents * rate_basis_points * days_in_period) / (10000LL * 365LL);
}
