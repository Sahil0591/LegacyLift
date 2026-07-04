import java.math.BigDecimal;
import java.math.RoundingMode;

public final class LegacyLiftMigration {
    private LegacyLiftMigration() {}

    public static BigDecimal calculateInterest(BigDecimal balance, BigDecimal annualRate, int days) {
        BigDecimal rate = annualRate.divide(BigDecimal.valueOf(100), 12, RoundingMode.HALF_UP);
        BigDecimal period = BigDecimal.valueOf(days).divide(BigDecimal.valueOf(365), 12, RoundingMode.HALF_UP);
        return balance.multiply(rate).multiply(period).setScale(2, RoundingMode.HALF_UP);
    }
}
