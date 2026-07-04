using System;

public static class LegacyLiftMigration
{
    public static decimal CalculateInterest(decimal balance, decimal annualRate, int daysInPeriod)
    {
        var rate = annualRate / 100m;
        var period = daysInPeriod / 365m;
        return Math.Round(balance * rate * period, 2, MidpointRounding.AwayFromZero);
    }
}
