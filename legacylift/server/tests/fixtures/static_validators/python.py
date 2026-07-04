from decimal import Decimal, ROUND_HALF_UP


def calculate_interest(balance: Decimal, annual_rate: Decimal, days: int) -> Decimal:
    rate = annual_rate / Decimal("100")
    period = Decimal(days) / Decimal("365")
    return (balance * rate * period).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
