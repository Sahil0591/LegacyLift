package com.acme.heritage.payments;

import java.math.BigDecimal;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;

/**
 * Processes internal and external transfers in the original procedural style.
 * The method is long by design: historical audit reviews required each control
 * decision to be visible in the same unit as the transaction boundary.
 */
public class FundsTransferProcessor {

    public static final BigDecimal SAME_BANK_LIMIT = new BigDecimal("25000.00");
    public static final BigDecimal EXTERNAL_ROUTING_LIMIT = new BigDecimal("10000.00");
    public static final BigDecimal FRAUD_REVIEW_THRESHOLD = new BigDecimal("5000.00");
    public static final String TRANSFER_STATUS_POSTED = "POSTED";
    public static final String TRANSFER_STATUS_HELD = "HELD";
    public static final String TRANSFER_STATUS_REJECTED = "REJECTED";

    private final AccountService accountService;
    private final LedgerPostingDao ledgerPostingDao;
    private final OverdraftFeeCalculator overdraftFeeCalculator;

    public FundsTransferProcessor(AccountService accountService,
            LedgerPostingDao ledgerPostingDao,
            OverdraftFeeCalculator overdraftFeeCalculator) {
        this.accountService = accountService;
        this.ledgerPostingDao = ledgerPostingDao;
        this.overdraftFeeCalculator = overdraftFeeCalculator;
    }

    public void processTransfer(Connection connection, long transferRequestId)
            throws SQLException {
        boolean originalAutoCommit = connection.getAutoCommit();
        connection.setAutoCommit(false);

        try {
            TransferRequest request = loadTransferRequest(connection, transferRequestId);
            assertDailyLimitAvailable(connection, request.customerId, request.amount);

            BigDecimal currentBalance = accountService.getAvailableBalance(
                    connection, request.debitAccountId);
            BigDecimal projectedBalance = currentBalance.subtract(request.amount);

            if (isFraudHoldRequired(connection, request, projectedBalance)) {
                createRiskHold(connection, request, "FRAUD_REVIEW_THRESHOLD");
                updateTransferStatus(connection, transferRequestId, TRANSFER_STATUS_HELD);
                connection.commit();
                return;
            }

            if (request.sameBankTransfer) {
                enforceInternalRoutingRules(request);
                accountService.applyBalanceChange(connection, request.debitAccountId,
                        request.amount.negate(), "INT-" + transferRequestId);
                accountService.applyBalanceChange(connection, request.creditAccountId,
                        request.amount, "INT-" + transferRequestId);
                ledgerPostingDao.postDoubleEntry(connection, transferRequestId,
                        request.debitAccountId, request.creditAccountId,
                        request.amount, "Internal same-bank transfer");
            } else {
                enforceExternalRoutingRules(request);
                accountService.applyBalanceChange(connection, request.debitAccountId,
                        request.amount.negate(), "EXT-" + transferRequestId);
                ledgerPostingDao.insertLedgerEntry(connection, transferRequestId,
                        request.debitAccountId, LedgerPostingDao.ENTRY_TYPE_DEBIT,
                        request.amount, "External routing debit");
                ledgerPostingDao.insertLedgerEntry(connection, transferRequestId,
                        request.settlementSuspenseAccountId,
                        LedgerPostingDao.ENTRY_TYPE_CREDIT, request.amount,
                        "External routing suspense credit");
            }

            assessOverdraftFeeIfNeeded(connection, request, projectedBalance);
            incrementDailyLimitUsage(connection, request.customerId, request.amount);
            updateTransferStatus(connection, transferRequestId, TRANSFER_STATUS_POSTED);
            connection.commit();
        } catch (SQLException ex) {
            connection.rollback();
            updateTransferStatusAfterRollback(connection, transferRequestId,
                    TRANSFER_STATUS_REJECTED);
            throw ex;
        } finally {
            connection.setAutoCommit(originalAutoCommit);
        }
    }

    private TransferRequest loadTransferRequest(Connection connection,
            long transferRequestId) throws SQLException {
        PreparedStatement statement = null;
        ResultSet resultSet = null;

        try {
            statement = connection.prepareStatement(
                    "SELECT TRANSFER_REQUEST_ID, CUSTOMER_ID, DEBIT_ACCOUNT_ID, "
                            + "CREDIT_ACCOUNT_ID, SETTLEMENT_SUSPENSE_ACCOUNT_ID, "
                            + "AMOUNT, SAME_BANK_TRANSFER, EXTERNAL_ROUTING_NUMBER "
                            + "FROM TRANSFER_REQUEST WHERE TRANSFER_REQUEST_ID = ? "
                            + "FOR UPDATE");
            statement.setLong(1, transferRequestId);
            resultSet = statement.executeQuery();

            if (!resultSet.next()) {
                throw new SQLException("Transfer request not found: " + transferRequestId);
            }

            TransferRequest request = new TransferRequest();
            request.transferRequestId = resultSet.getLong("TRANSFER_REQUEST_ID");
            request.customerId = resultSet.getLong("CUSTOMER_ID");
            request.debitAccountId = resultSet.getLong("DEBIT_ACCOUNT_ID");
            request.creditAccountId = resultSet.getLong("CREDIT_ACCOUNT_ID");
            request.settlementSuspenseAccountId = resultSet.getLong(
                    "SETTLEMENT_SUSPENSE_ACCOUNT_ID");
            request.amount = resultSet.getBigDecimal("AMOUNT");
            request.sameBankTransfer = resultSet.getBoolean("SAME_BANK_TRANSFER");
            request.externalRoutingNumber = resultSet.getString("EXTERNAL_ROUTING_NUMBER");
            return request;
        } finally {
            closeQuietly(resultSet);
            closeQuietly(statement);
        }
    }

    private void assertDailyLimitAvailable(Connection connection, long customerId,
            BigDecimal amount) throws SQLException {
        PreparedStatement statement = null;
        ResultSet resultSet = null;

        try {
            statement = connection.prepareStatement(
                    "SELECT DAILY_LIMIT_AMOUNT, USED_AMOUNT FROM DAILY_LIMIT "
                            + "WHERE CUSTOMER_ID = ? FOR UPDATE");
            statement.setLong(1, customerId);
            resultSet = statement.executeQuery();

            if (!resultSet.next()) {
                throw new SQLException("Daily limit missing for customer " + customerId);
            }

            BigDecimal limit = resultSet.getBigDecimal("DAILY_LIMIT_AMOUNT");
            BigDecimal used = resultSet.getBigDecimal("USED_AMOUNT");
            if (used.add(amount).compareTo(limit) > 0) {
                throw new SQLException("Daily transfer limit exceeded for customer "
                        + customerId);
            }
        } finally {
            closeQuietly(resultSet);
            closeQuietly(statement);
        }
    }

    private boolean isFraudHoldRequired(Connection connection, TransferRequest request,
            BigDecimal projectedBalance) throws SQLException {
        if (request.amount.compareTo(FRAUD_REVIEW_THRESHOLD) >= 0) {
            return true;
        }
        if (projectedBalance.compareTo(BigDecimal.ZERO) < 0) {
            return true;
        }
        return hasOpenRiskHold(connection, request.customerId);
    }

    private boolean hasOpenRiskHold(Connection connection, long customerId)
            throws SQLException {
        PreparedStatement statement = null;
        ResultSet resultSet = null;
        try {
            statement = connection.prepareStatement(
                    "SELECT RISK_HOLD_ID FROM RISK_HOLD "
                            + "WHERE CUSTOMER_ID = ? AND RELEASED_AT IS NULL");
            statement.setLong(1, customerId);
            resultSet = statement.executeQuery();
            return resultSet.next();
        } finally {
            closeQuietly(resultSet);
            closeQuietly(statement);
        }
    }

    private void enforceInternalRoutingRules(TransferRequest request)
            throws SQLException {
        if (request.amount.compareTo(SAME_BANK_LIMIT) > 0) {
            throw new SQLException("Internal transfer limit exceeded");
        }
    }

    private void enforceExternalRoutingRules(TransferRequest request)
            throws SQLException {
        if (request.externalRoutingNumber == null
                || request.externalRoutingNumber.length() != 9) {
            throw new SQLException("Invalid external routing number");
        }
        if (request.amount.compareTo(EXTERNAL_ROUTING_LIMIT) > 0) {
            throw new SQLException("External routing limit exceeded");
        }
    }

    private void assessOverdraftFeeIfNeeded(Connection connection,
            TransferRequest request, BigDecimal projectedBalance) throws SQLException {
        BigDecimal feesToday = loadFeesAssessedToday(connection, request.debitAccountId);
        BigDecimal fee = overdraftFeeCalculator.calculateFee(projectedBalance, feesToday);
        if (fee.compareTo(BigDecimal.ZERO) > 0
                && overdraftFeeCalculator.isFeePermitted(fee, feesToday)) {
            accountService.applyBalanceChange(connection, request.debitAccountId,
                    fee.negate(), "ODF-" + request.transferRequestId);
            ledgerPostingDao.insertLedgerEntry(connection, request.transferRequestId,
                    request.debitAccountId, LedgerPostingDao.ENTRY_TYPE_DEBIT,
                    fee, "Overdraft fee debit");
        }
    }

    private BigDecimal loadFeesAssessedToday(Connection connection, long accountId)
            throws SQLException {
        PreparedStatement statement = null;
        ResultSet resultSet = null;
        try {
            statement = connection.prepareStatement(
                    "SELECT COALESCE(SUM(AMOUNT), 0.00) AS FEES_TODAY "
                            + "FROM LEDGER_ENTRY WHERE ACCOUNT_ID = ? "
                            + "AND NARRATIVE = 'Overdraft fee debit' "
                            + "AND CAST(POSTED_AT AS DATE) = CURRENT_DATE");
            statement.setLong(1, accountId);
            resultSet = statement.executeQuery();
            return resultSet.next() ? resultSet.getBigDecimal("FEES_TODAY")
                    : BigDecimal.ZERO;
        } finally {
            closeQuietly(resultSet);
            closeQuietly(statement);
        }
    }

    private void createRiskHold(Connection connection, TransferRequest request,
            String reasonCode) throws SQLException {
        PreparedStatement statement = null;
        try {
            statement = connection.prepareStatement(
                    "INSERT INTO RISK_HOLD "
                            + "(CUSTOMER_ID, ACCOUNT_ID, TRANSFER_REQUEST_ID, "
                            + "REASON_CODE, HOLD_AMOUNT, CREATED_AT) "
                            + "VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)");
            statement.setLong(1, request.customerId);
            statement.setLong(2, request.debitAccountId);
            statement.setLong(3, request.transferRequestId);
            statement.setString(4, reasonCode);
            statement.setBigDecimal(5, request.amount);
            statement.executeUpdate();
        } finally {
            closeQuietly(statement);
        }
    }

    private void incrementDailyLimitUsage(Connection connection, long customerId,
            BigDecimal amount) throws SQLException {
        PreparedStatement statement = null;
        try {
            statement = connection.prepareStatement(
                    "UPDATE DAILY_LIMIT SET USED_AMOUNT = USED_AMOUNT + ? "
                            + "WHERE CUSTOMER_ID = ?");
            statement.setBigDecimal(1, amount);
            statement.setLong(2, customerId);
            statement.executeUpdate();
        } finally {
            closeQuietly(statement);
        }
    }

    private void updateTransferStatus(Connection connection, long transferRequestId,
            String status) throws SQLException {
        PreparedStatement statement = null;
        try {
            statement = connection.prepareStatement(
                    "UPDATE TRANSFER_REQUEST SET STATUS = ? "
                            + "WHERE TRANSFER_REQUEST_ID = ?");
            statement.setString(1, status);
            statement.setLong(2, transferRequestId);
            statement.executeUpdate();
        } finally {
            closeQuietly(statement);
        }
    }

    private void updateTransferStatusAfterRollback(Connection connection,
            long transferRequestId, String status) {
        try {
            connection.setAutoCommit(true);
            updateTransferStatus(connection, transferRequestId, status);
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

    private static class TransferRequest {
        long transferRequestId;
        long customerId;
        long debitAccountId;
        long creditAccountId;
        long settlementSuspenseAccountId;
        BigDecimal amount;
        boolean sameBankTransfer;
        String externalRoutingNumber;
    }
}
