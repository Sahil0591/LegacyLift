package com.acme.heritage.payments;

import java.math.BigDecimal;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;

/**
 * DAO for strict double-entry ledger posting.  The caller supplies a transaction
 * boundary; this class never commits because the account balance and ledger
 * rows must succeed or fail as one unit.
 */
public class LedgerPostingDao {

    public static final String ENTRY_TYPE_DEBIT = "DEBIT";
    public static final String ENTRY_TYPE_CREDIT = "CREDIT";

    public void postDoubleEntry(Connection connection, long transferRequestId,
            long debitAccountId, long creditAccountId, BigDecimal amount,
            String narrative) throws SQLException {
        if (amount == null || amount.compareTo(BigDecimal.ZERO) <= 0) {
            throw new SQLException("Ledger amount must be positive");
        }

        insertLedgerEntry(connection, transferRequestId, debitAccountId,
                ENTRY_TYPE_DEBIT, amount, narrative);
        insertLedgerEntry(connection, transferRequestId, creditAccountId,
                ENTRY_TYPE_CREDIT, amount, narrative);
    }

    public void insertLedgerEntry(Connection connection, long transferRequestId,
            long accountId, String entryType, BigDecimal amount, String narrative)
            throws SQLException {
        PreparedStatement statement = null;
        try {
            statement = connection.prepareStatement(
                    "INSERT INTO LEDGER_ENTRY "
                            + "(TRANSFER_REQUEST_ID, ACCOUNT_ID, ENTRY_TYPE, AMOUNT, "
                            + "NARRATIVE, POSTED_AT) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)");
            statement.setLong(1, transferRequestId);
            statement.setLong(2, accountId);
            statement.setString(3, entryType);
            statement.setBigDecimal(4, amount);
            statement.setString(5, narrative);

            if (statement.executeUpdate() != 1) {
                throw new SQLException("Ledger insert failed for transfer "
                        + transferRequestId);
            }
        } finally {
            closeQuietly(statement);
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
