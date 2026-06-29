-- =============================================================================
-- legacy_bank.sql — Core banking schema (PostgreSQL / DB2 compatible)
-- Referenced by: INTCALC, ACCTMSTR, EODBTCH
-- =============================================================================

CREATE TABLE ACCOUNT_MASTER (
    ACCOUNT_ID      CHAR(10)        NOT NULL PRIMARY KEY,
    CUSTOMER_ID     CHAR(10)        NOT NULL,
    BALANCE         DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
    INTEREST_RATE   DECIMAL(7,4)    NOT NULL DEFAULT 0.0000,
    ACCOUNT_TYPE    VARCHAR(10)     NOT NULL,  -- STANDARD|PREMIUM|ISA
    STATUS          VARCHAR(10)     NOT NULL,  -- ACTIVE|CLOSED|FROZEN
    LAST_UPDATED    DATE,
    OPENED_DATE     DATE            NOT NULL
);

CREATE TABLE CUSTOMER_DATA (
    CUSTOMER_ID     CHAR(10)        NOT NULL PRIMARY KEY,
    FULL_NAME       VARCHAR(100)    NOT NULL,
    KYC_STATUS      VARCHAR(10)     NOT NULL,  -- APPROVED|PENDING|FAILED
    RISK_TIER       VARCHAR(6)      NOT NULL,  -- LOW|MEDIUM|HIGH
    DATE_OF_BIRTH   DATE,
    ONBOARDED_DATE  DATE            NOT NULL
);

CREATE TABLE COMPLIANCE_FLAGS (
    FLAG_ID         SERIAL          PRIMARY KEY,
    ACCOUNT_ID      CHAR(10)        NOT NULL,
    FLAG_TYPE       VARCHAR(20)     NOT NULL,  -- CLOSURE|REGULATORY-HOLD
    RAISED_DATE     DATE            NOT NULL,
    RESOLVED        BOOLEAN         NOT NULL DEFAULT FALSE,
    RESOLVED_DATE   DATE,
    FOREIGN KEY (ACCOUNT_ID) REFERENCES ACCOUNT_MASTER(ACCOUNT_ID)
);

CREATE TABLE EOD_AUDIT (
    RUN_ID                  SERIAL          PRIMARY KEY,
    RUN_DATE                DATE            NOT NULL,
    TOTAL_ACCOUNTS          INTEGER         NOT NULL,
    TOTAL_INTEREST_APPLIED  DECIMAL(17,2)   NOT NULL,
    STATUS                  VARCHAR(10)     NOT NULL,  -- COMPLETE|FAILED
    CREATED_AT              TIMESTAMP       DEFAULT CURRENT_TIMESTAMP
);
