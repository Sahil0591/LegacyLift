package com.acme.heritage.payments;

import java.math.BigDecimal;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;

/**
 * End-of-day settlement routine used by Operations after the online transfer
 * window closes.  It deliberately uses cursor-style iteration and commits only
 * when the audit record agrees with the posted totals.
 */
public class EndOfDaySettlementJob {

    public static final String AUDIT_STATUS_COMPLETE = "COMPLETE";
    public static final String AUDIT_STATUS_FAILED = "FAILED";
    public static final BigDecimal ZERO_AMOUNT = new BigDecimal("0.00");

    private final LedgerPostingDao ledgerPostingDao;

    public EndOfDaySettlementJob(LedgerPostingDao ledgerPostingDao) {
        this.ledgerPostingDao = ledgerPostingDao;
    }

    public void runSettlement(Connection connection, String businessDate)
            throws SQLException {
        boolean originalAutoCommit = connection.getAutoCommit();
        connection.setAutoCommit(false);

        int settledCount = 0;
        BigDecimal settledTotal = ZERO_AMOUNT;

        try {
            PreparedStatement statement = connection.prepareStatement(
                    "SELECT TRANSFER_REQUEST_ID, DEBIT_ACCOUNT_ID, "
                            + "SETTLEMENT_SUSPENSE_ACCOUNT_ID, AMOUNT "
                            + "FROM TRANSFER_REQUEST WHERE STATUS = 'POSTED' "
                            + "AND SETTLEMENT_DATE = ? AND SAME_BANK_TRANSFER = 0");
            statement.setString(1, businessDate);
            ResultSet resultSet = statement.executeQuery();

            try {
                while (resultSet.next()) {
                    long transferRequestId = resultSet.getLong("TRANSFER_REQUEST_ID");
                    long debitAccountId = resultSet.getLong("DEBIT_ACCOUNT_ID");
                    long suspenseAccountId = resultSet.getLong(
                            "SETTLEMENT_SUSPENSE_ACCOUNT_ID");
                    BigDecimal amount = resultSet.getBigDecimal("AMOUNT");

                    ledgerPostingDao.postDoubleEntry(connection, transferRequestId,
                            suspenseAccountId, debitAccountId, amount,
                            "EOD external network settlement");
                    settledCount++;
                    settledTotal = settledTotal.add(amount);
                }
            } finally {
                closeQuietly(resultSet);
                closeQuietly(statement);
            }

            writeSettlementAudit(connection, businessDate, settledCount,
                    settledTotal, AUDIT_STATUS_COMPLETE, null);
            connection.commit();
        } catch (SQLException ex) {
            connection.rollback();
            writeFailedAuditBestEffort(connection, businessDate, settledCount,
                    settledTotal, ex);
            throw ex;
        } finally {
            connection.setAutoCommit(originalAutoCommit);
        }
    }

    private void writeSettlementAudit(Connection connection, String businessDate,
            int settledCount, BigDecimal settledTotal, String status,
            String failureReason) throws SQLException {
        PreparedStatement statement = null;
        try {
            statement = connection.prepareStatement(
                    "INSERT INTO SETTLEMENT_AUDIT "
                            + "(BUSINESS_DATE, SETTLED_COUNT, SETTLED_AMOUNT, "
                            + "STATUS, FAILURE_REASON, CREATED_AT) "
                            + "VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)");
            statement.setString(1, businessDate);
            statement.setInt(2, settledCount);
            statement.setBigDecimal(3, settledTotal);
            statement.setString(4, status);
            statement.setString(5, failureReason);
            statement.executeUpdate();
        } finally {
            closeQuietly(statement);
        }
    }

    private void writeFailedAuditBestEffort(Connection connection,
            String businessDate, int settledCount, BigDecimal settledTotal,
            SQLException failure) {
        try {
            connection.setAutoCommit(true);
            writeSettlementAudit(connection, businessDate, settledCount,
                    settledTotal, AUDIT_STATUS_FAILED, failure.getMessage());
        } catch (SQLException ignored) {
        }
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
