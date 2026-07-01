package com.acme.heritage.payments;

import java.math.BigDecimal;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;

/**
 * AccountService contains the deliberately plain account rules used by the
 * heritage payments module.  This class dates from the period where service
 * methods were expected to own their JDBC, state checks, and failure handling
 * in one visibly auditable unit.
 */
public class AccountService {

    public static final String STATUS_ACTIVE = "ACTIVE";
    public static final String STATUS_SUSPENDED = "SUSPENDED";
    public static final String STATUS_CLOSED = "CLOSED";
    public static final BigDecimal ZERO_AMOUNT = new BigDecimal("0.00");

    /**
     * Loads the available balance for a transfer and enforces the historical
     * operations rule that no suspended or closed account can be used even when
     * the target debit would otherwise be fully covered.
     */
    public BigDecimal getAvailableBalance(Connection connection, long accountId)
            throws SQLException {
        PreparedStatement statement = null;
        ResultSet resultSet = null;

        try {
            statement = connection.prepareStatement(
                    "SELECT BALANCE, STATUS FROM ACCOUNT WHERE ACCOUNT_ID = ?");
            statement.setLong(1, accountId);
            resultSet = statement.executeQuery();

            if (!resultSet.next()) {
                throw new SQLException("Account not found: " + accountId);
            }

            String status = resultSet.getString("STATUS");
            assertAccountOpenForPosting(status, accountId);
            return resultSet.getBigDecimal("BALANCE");
        } finally {
            closeQuietly(resultSet);
            closeQuietly(statement);
        }
    }

    /**
     * Applies a balance movement using explicit pessimistic locking.  The lock
     * is intentional: the old payments cluster runs multiple transfer workers,
     * and the bank requires ledger-visible serial ordering per account.
     */
    public void applyBalanceChange(Connection connection, long accountId,
            BigDecimal amount, String postingReference) throws SQLException {
        PreparedStatement select = null;
        PreparedStatement update = null;
        ResultSet resultSet = null;

        try {
            select = connection.prepareStatement(
                    "SELECT BALANCE, STATUS FROM ACCOUNT WHERE ACCOUNT_ID = ? FOR UPDATE");
            select.setLong(1, accountId);
            resultSet = select.executeQuery();

            if (!resultSet.next()) {
                throw new SQLException("Account not found for posting: " + accountId);
            }

            assertAccountOpenForPosting(resultSet.getString("STATUS"), accountId);
            BigDecimal currentBalance = resultSet.getBigDecimal("BALANCE");
            BigDecimal newBalance = currentBalance.add(amount);

            update = connection.prepareStatement(
                    "UPDATE ACCOUNT SET BALANCE = ?, LAST_POSTED_REFERENCE = ? "
                            + "WHERE ACCOUNT_ID = ?");
            update.setBigDecimal(1, newBalance);
            update.setString(2, postingReference);
            update.setLong(3, accountId);

            if (update.executeUpdate() != 1) {
                throw new SQLException("Balance update failed for account: " + accountId);
            }
        } finally {
            closeQuietly(resultSet);
            closeQuietly(update);
            closeQuietly(select);
        }
    }

    public void assertAccountOpenForPosting(String status, long accountId)
            throws SQLException {
        if (STATUS_ACTIVE.equals(status)) {
            return;
        }
        if (STATUS_SUSPENDED.equals(status)) {
            throw new SQLException("Suspended account cannot post payments: " + accountId);
        }
        if (STATUS_CLOSED.equals(status)) {
            throw new SQLException("Closed account cannot post payments: " + accountId);
        }
        throw new SQLException("Unknown account status " + status + " for " + accountId);
    }

    private void closeQuietly(ResultSet resultSet) {
        if (resultSet != null) {
            try {
                resultSet.close();
            } catch (SQLException ignored) {
            }
        }
    }

    private void closeQuietly(PreparedStatement statement) {
        if (statement != null) {
            try {
                statement.close();
            } catch (SQLException ignored) {
            }
        }
    }
}
