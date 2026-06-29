-- =============================================================================
-- legacy_bank.sql — Legacy Banking System Schema
-- =============================================================================
-- This schema was exported from a DB2/VSAM-backed COBOL mainframe system.
-- It has been running since 1993 and reflects 30 years of organic growth.
--
-- IMPORTANT MIGRATION NOTES:
--   - No foreign keys (referential integrity enforced in COBOL programs)
--   - Dates stored as INTEGER YYYYMMDD (NOT SQL DATE types)
--   - All table and column names are uppercase cryptic abbreviations
--   - Monetary amounts stored as INTEGER cents (e.g. 100000 = $1,000.00)
--     EXCEPT in newer tables which use DECIMAL(15,2)
--   - Status codes are single CHAR: A=Active, C=Closed, D=Delinquent,
--     F=Frozen, P=Pending, S=Suspended
--   - FILLER columns were added for record padding — do NOT remove them
--
-- Tables:
--   ACCT_MSTR    — Account master (core table)
--   CUST_MSTR    — Customer master
--   TXNS         — Transaction ledger
--   INT_ACCRUAL  — Daily interest accrual
--   ACCT_AUDIT   — Status change audit trail
--   PROD_TYPE    — Product type reference
--   EOD_CTRL     — End-of-day batch control
--   ERR_LOG      — Error log (used by all COBOL programs)
-- =============================================================================


-- =============================================================================
-- ACCT_MSTR — Account Master
-- The primary table for all deposit accounts.
-- Referenced by COBOL: INTCALC, ACCTMSTR, EODBATCH
-- =============================================================================
CREATE TABLE ACCT_MSTR (
    ACCT_ID         INTEGER         NOT NULL,   -- 10-digit account number
    CUST_ID         INTEGER         NOT NULL,   -- FK to CUST_MSTR (enforced in COBOL)
    ACCT_TYPE       CHAR(2)         NOT NULL,   -- SA=Savings, CA=Chequing, TD=Term Deposit
    PROD_CD         CHAR(4)         NOT NULL,   -- FK to PROD_TYPE.PROD_CD
    BAL_AMT         DECIMAL(15,2)   NOT NULL DEFAULT 0, -- Current balance (dollars, not cents)
    AVAIL_BAL       DECIMAL(15,2)   NOT NULL DEFAULT 0, -- Available balance (excl. holds)
    OPEN_DT         INTEGER         NOT NULL,   -- Account open date YYYYMMDD
    LAST_PMT_DT     INTEGER         DEFAULT 0,  -- Last payment date YYYYMMDD (0 if never)
    DAYS_OVERDUE    INTEGER         NOT NULL DEFAULT 0,
    STAT_CD         CHAR(1)         NOT NULL DEFAULT 'A', -- A/C/D/F/P/S
    INT_RATE        DECIMAL(6,6)    DEFAULT 0,  -- Override rate (0 = use tier table)
    BRANCH_CD       CHAR(4)         NOT NULL,   -- Branch code
    OPEN_BR_CD      CHAR(4)         NOT NULL,   -- Branch where account was opened
    LST_UPD_DT      INTEGER         NOT NULL DEFAULT 0, -- Last update YYYYMMDD
    LST_UPD_PGM     CHAR(8)         DEFAULT 'UNKNOWN', -- Last program to update
    FILLER_1        CHAR(20)        DEFAULT ' ' -- Reserved for future use
);


-- =============================================================================
-- CUST_MSTR — Customer Master
-- One row per customer. A customer may have multiple accounts (ACCT_MSTR).
-- =============================================================================
CREATE TABLE CUST_MSTR (
    CUST_ID         INTEGER         NOT NULL,
    CUST_SURNAME    CHAR(30)        NOT NULL DEFAULT 'N/A',  -- Fixed-length, space-padded
    CUST_GIVEN      CHAR(20)        NOT NULL DEFAULT 'N/A',
    CUST_DOB        INTEGER         NOT NULL DEFAULT 0,      -- YYYYMMDD
    CUST_TFN        CHAR(9)         DEFAULT '000000000',     -- Tax File Number (masked in reports)
    CUST_EMAIL      CHAR(50)        DEFAULT ' ',
    CUST_PHONE      CHAR(15)        DEFAULT ' ',
    ADDR_LINE1      CHAR(40)        DEFAULT ' ',
    ADDR_LINE2      CHAR(40)        DEFAULT ' ',
    ADDR_SUBURB     CHAR(30)        DEFAULT ' ',
    ADDR_STATE      CHAR(3)         DEFAULT ' ',
    ADDR_POSTCODE   CHAR(4)         DEFAULT ' ',
    KYC_STAT        CHAR(1)         NOT NULL DEFAULT 'P',    -- P=Pending, Y=Verified, F=Failed
    KYC_DT          INTEGER         DEFAULT 0,               -- KYC completion date YYYYMMDD
    CUST_SINCE      INTEGER         NOT NULL DEFAULT 0,      -- Customer since YYYYMMDD
    PREM_FLAG       CHAR(1)         NOT NULL DEFAULT 'N',    -- Y=Premium customer
    FILLER_1        CHAR(22)        DEFAULT ' '
);


-- =============================================================================
-- TXNS — Transaction Ledger
-- Every debit and credit to an account.  Append-only.  Never updated.
-- Volume: ~50M rows per month.
-- =============================================================================
CREATE TABLE TXNS (
    TXN_ID          INTEGER         NOT NULL,
    ACCT_ID         INTEGER         NOT NULL,   -- FK to ACCT_MSTR
    TXN_TYPE        CHAR(2)         NOT NULL,   -- DR=Debit, CR=Credit, FE=Fee, IN=Interest
    TXN_AMT         DECIMAL(15,2)   NOT NULL,   -- Always positive; type indicates direction
    TXN_DT          INTEGER         NOT NULL,   -- Transaction date YYYYMMDD
    TXN_TM          INTEGER         NOT NULL DEFAULT 0, -- Transaction time HHMMSS
    POST_DT         INTEGER         DEFAULT 0,  -- Posting date YYYYMMDD (0 if pending)
    BAL_AFTER       DECIMAL(15,2)   NOT NULL DEFAULT 0, -- Balance after this transaction
    CHANNEL         CHAR(4)         DEFAULT 'UNKN', -- BRNC/ATM/INET/TELE/BATC
    REF_NO          CHAR(16)        DEFAULT ' ', -- External reference number
    NARR            CHAR(50)        DEFAULT ' ', -- Narrative/description
    REVERSAL_FLAG   CHAR(1)         NOT NULL DEFAULT 'N', -- Y if this reverses another txn
    ORIG_TXN_ID     INTEGER         DEFAULT 0,  -- Original TXN_ID if reversal
    FILLER_1        CHAR(8)         DEFAULT ' '
);


-- =============================================================================
-- INT_ACCRUAL — Daily Interest Accrual
-- One row per account per day. Written by INTCALC via EODBATCH.
-- =============================================================================
CREATE TABLE INT_ACCRUAL (
    ACCRUAL_ID      INTEGER         NOT NULL,
    ACCT_ID         INTEGER         NOT NULL,   -- FK to ACCT_MSTR
    ACCRUAL_DT      INTEGER         NOT NULL,   -- Accrual date YYYYMMDD
    OPEN_BAL        DECIMAL(15,2)   NOT NULL,   -- Balance at start of day
    INT_RATE        DECIMAL(8,6)    NOT NULL,   -- Actual rate applied
    TIER_CD         INTEGER         NOT NULL DEFAULT 0, -- 1/2/3 from INTCALC
    DAILY_INT_AMT   DECIMAL(15,6)   NOT NULL,   -- Calculated daily interest (6 dp for precision)
    STATUS          CHAR(1)         NOT NULL DEFAULT 'P', -- P=Pending, C=Capitalised
    BATCH_RUN_ID    INTEGER         NOT NULL DEFAULT 0, -- FK to EOD_CTRL
    FILLER_1        CHAR(10)        DEFAULT ' '
);


-- =============================================================================
-- ACCT_AUDIT — Account Status Change Audit Trail
-- Compliance requirement: every status change must be logged with old/new values.
-- Append-only. Never updated or deleted.
-- =============================================================================
CREATE TABLE ACCT_AUDIT (
    AUDIT_ID        INTEGER         NOT NULL,
    ACCT_ID         INTEGER         NOT NULL,
    ACTION          CHAR(10)        NOT NULL,   -- STATUS-UPD, CLOSE, FREEZE, UNFREEZE
    OLD_STAT        CHAR(1)         DEFAULT ' ',
    NEW_STAT        CHAR(1)         NOT NULL,
    CHNG_DT         INTEGER         NOT NULL,   -- Change date YYYYMMDD
    CHNG_TM         INTEGER         NOT NULL DEFAULT 0, -- Change time HHMMSS
    CHANGED_BY      CHAR(8)         NOT NULL DEFAULT 'BATCH', -- User ID or program name
    REASON_CD       CHAR(4)         DEFAULT ' ', -- Reason code (blank if automated)
    NOTES           CHAR(60)        DEFAULT ' ',
    FILLER_1        CHAR(12)        DEFAULT ' '
);


-- =============================================================================
-- PROD_TYPE — Product Type Reference
-- Master list of account product types.  Rarely changes.
-- =============================================================================
CREATE TABLE PROD_TYPE (
    PROD_CD         CHAR(4)         NOT NULL,   -- e.g. STDS, PREM, BSAV, ETDA
    PROD_DESC       CHAR(40)        NOT NULL,
    ACCT_TYPE       CHAR(2)         NOT NULL,   -- SA/CA/TD
    MIN_BAL         DECIMAL(15,2)   NOT NULL DEFAULT 0,
    MONTHLY_FEE     DECIMAL(8,2)    NOT NULL DEFAULT 0,
    INT_ELIGIBLE    CHAR(1)         NOT NULL DEFAULT 'Y', -- Y=earns interest
    EFF_DT          INTEGER         NOT NULL,   -- Effective date YYYYMMDD
    EXP_DT          INTEGER         DEFAULT 99991231, -- Expiry date (99991231 = never)
    FILLER_1        CHAR(20)        DEFAULT ' '
);


-- =============================================================================
-- EOD_CTRL — End-of-Day Batch Control
-- One row per batch run.  EODBATCH writes here at start and end.
-- Used to detect failed/partial runs and for variance reporting.
-- =============================================================================
CREATE TABLE EOD_CTRL (
    BATCH_RUN_ID    INTEGER         NOT NULL,
    RUN_DT          INTEGER         NOT NULL,   -- YYYYMMDD
    START_TM        INTEGER         NOT NULL,   -- HHMMSS
    END_TM          INTEGER         DEFAULT 0,  -- 0 = not yet finished
    STATUS          CHAR(1)         NOT NULL DEFAULT 'R', -- R=Running, C=Complete, E=Error, W=Warning
    ACCTS_PROC      INTEGER         NOT NULL DEFAULT 0,
    ACCTS_SKIP      INTEGER         NOT NULL DEFAULT 0,
    ACCTS_ERR       INTEGER         NOT NULL DEFAULT 0,
    TOT_INT_AMT     DECIMAL(20,2)   NOT NULL DEFAULT 0,
    PREV_INT_AMT    DECIMAL(20,2)   NOT NULL DEFAULT 0,
    INT_VARIANCE    DECIMAL(8,4)    NOT NULL DEFAULT 0, -- Percentage
    ALERT_FLAG      CHAR(1)         NOT NULL DEFAULT 'N', -- Y if variance > 10%
    FILLER_1        CHAR(30)        DEFAULT ' '
);


-- =============================================================================
-- ERR_LOG — System Error Log
-- All COBOL programs write errors here. High volume during batch window.
-- =============================================================================
CREATE TABLE ERR_LOG (
    ERR_ID          INTEGER         NOT NULL,
    ERR_DT          INTEGER         NOT NULL,   -- YYYYMMDD
    ERR_TM          INTEGER         NOT NULL,   -- HHMMSS
    PROG_NAME       CHAR(8)         NOT NULL,   -- COBOL program ID
    ERR_CODE        CHAR(4)         NOT NULL,   -- Internal error code
    ERR_MSG         CHAR(80)        NOT NULL,
    ACCT_ID         INTEGER         DEFAULT 0,  -- 0 if not account-specific
    SEV_CD          CHAR(1)         NOT NULL DEFAULT 'E', -- E=Error, W=Warning, I=Info
    RESOLVED_FLAG   CHAR(1)         NOT NULL DEFAULT 'N',
    FILLER_1        CHAR(20)        DEFAULT ' '
);
