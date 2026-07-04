CREATE OR REPLACE FUNCTION calculate_interest(
    balance NUMERIC,
    annual_rate NUMERIC,
    days_in_period INTEGER
) RETURNS NUMERIC AS $$
BEGIN
    RETURN ROUND(balance * (annual_rate / 100) * (days_in_period::NUMERIC / 365), 2);
END;
$$ LANGUAGE plpgsql;
