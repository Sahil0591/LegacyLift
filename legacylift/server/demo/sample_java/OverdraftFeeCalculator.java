package com.acme.heritage.payments;

import java.math.BigDecimal;
import java.math.RoundingMode;

/**
 * Calculates overdraft fees using the fee schedule agreed by Retail Banking
 * Operations.  These values are constants because the 2010 implementation was
 * deployed under formal change control and deliberately avoided remote rule
 * engines in the posting path.
 */
public class OverdraftFeeCalculator {

    public static final BigDecimal OVERDRAFT_FEE_RATE = new BigDecimal("0.035");
    public static final BigDecimal MINIMUM_FEE = new BigDecimal("5.00");
    public static final BigDecimal MAXIMUM_FEE = new BigDecimal("35.00");
    public static final BigDecimal REGULATORY_DAILY_CAP = new BigDecimal("50.00");
    public static final BigDecimal ZERO_AMOUNT = new BigDecimal("0.00");

    public BigDecimal calculateFee(BigDecimal balanceAfterDebit,
            BigDecimal feesAlreadyAssessedToday) {
        if (balanceAfterDebit == null) {
            throw new IllegalArgumentException("Balance is required");
        }
        if (feesAlreadyAssessedToday == null) {
            feesAlreadyAssessedToday = ZERO_AMOUNT;
        }
        if (balanceAfterDebit.compareTo(ZERO_AMOUNT) >= 0) {
            return ZERO_AMOUNT;
        }

        BigDecimal overdrawnAmount = balanceAfterDebit.abs();
        BigDecimal proposedFee = overdrawnAmount.multiply(OVERDRAFT_FEE_RATE);
        proposedFee = proposedFee.setScale(2, RoundingMode.HALF_UP);

        if (proposedFee.compareTo(MINIMUM_FEE) < 0) {
            proposedFee = MINIMUM_FEE;
        }
        if (proposedFee.compareTo(MAXIMUM_FEE) > 0) {
            proposedFee = MAXIMUM_FEE;
        }

        BigDecimal remainingRegulatoryCapacity = REGULATORY_DAILY_CAP.subtract(
                feesAlreadyAssessedToday);
        if (remainingRegulatoryCapacity.compareTo(ZERO_AMOUNT) <= 0) {
            return ZERO_AMOUNT;
        }
        if (proposedFee.compareTo(remainingRegulatoryCapacity) > 0) {
            return remainingRegulatoryCapacity.setScale(2, RoundingMode.HALF_UP);
        }
        return proposedFee;
    }

    public boolean isFeePermitted(BigDecimal requestedFee,
            BigDecimal feesAlreadyAssessedToday) {
        BigDecimal total = feesAlreadyAssessedToday.add(requestedFee);
        return total.compareTo(REGULATORY_DAILY_CAP) <= 0;
    }
}
