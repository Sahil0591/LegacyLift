      *================================================================
      * PROGRAM:    ACCTMSTR
      * PURPOSE:    Account lifecycle management: open, close, freeze.
      *             All operations validate customer KYC status and
      *             write audit records to COMPLIANCE_FLAGS.
      *
      * CALLED BY:  EODBTCH (end_of_day_batch.cbl)
      *             Entry point: PERFORM VALIDATE-KYC
      *             Also called directly by online front-end programs
      *             for OPEN-ACCOUNT, CLOSE-ACCOUNT, FREEZE-ACCOUNT.
      *
      * BUSINESS RULES ENFORCED HERE:
      *   BR-201  KYC must be APPROVED before account can be opened.
      *           Any other status → WS-ACCOUNT-STATUS = REJECTED.
      *   BR-202  HIGH risk tier forces KYC to PENDING regardless of
      *           value in CUSTOMER_DATA.KYC_STATUS.
      *           Basel-III compliance directive 2011-09.
      *   BR-203  Every account closure raises a CLOSURE flag in
      *           COMPLIANCE_FLAGS (regulatory requirement).
      *   BR-204  Account freeze requires a re-validation of KYC
      *           identity per AML directive CD-2015-04.
      *           Raises a REGULATORY-HOLD compliance flag.
      *
      * DB TABLES READ:    CUSTOMER_DATA
      * DB TABLES WRITTEN: ACCOUNT_MASTER, COMPLIANCE_FLAGS
      *================================================================
       IDENTIFICATION DIVISION.
       PROGRAM-ID. ACCTMSTR.
       AUTHOR. P.CHEN.
       DATE-WRITTEN. 1995-07-22.

       ENVIRONMENT DIVISION.
       CONFIGURATION SECTION.
       SOURCE-COMPUTER. IBM-390.
       OBJECT-COMPUTER. IBM-390.

       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-CUSTOMER-ID        PIC X(10).
       01  WS-ACCOUNT-ID         PIC X(10).
       01  WS-KYC-STATUS         PIC X(10).
       01  WS-RISK-TIER          PIC X(6).
       01  WS-FREEZE-REASON      PIC X(50).
       01  WS-ACCOUNT-STATUS     PIC X(10).
       01  WS-FLAG-TYPE          PIC X(20).
       01  SQLCODE               PIC S9(9) COMP.

       PROCEDURE DIVISION.

      *----------------------------------------------------------------
      * OPEN-ACCOUNT: validates KYC then inserts new account row.
      * BR-201: only APPROVED KYC status may proceed to INSERT.
      *         Any other status sets WS-ACCOUNT-STATUS = REJECTED.
      *----------------------------------------------------------------
       OPEN-ACCOUNT.
           PERFORM VALIDATE-KYC
           IF WS-KYC-STATUS = 'APPROVED'
               EXEC SQL
                   INSERT INTO ACCOUNT_MASTER
                       (ACCOUNT_ID, CUSTOMER_ID, ACCOUNT_TYPE,
                        STATUS, OPENED_DATE)
                   VALUES
                       (:WS-ACCOUNT-ID, :WS-CUSTOMER-ID,
                        'STANDARD', 'ACTIVE', CURRENT_DATE)
               END-EXEC
           ELSE
               MOVE 'REJECTED' TO WS-ACCOUNT-STATUS
               DISPLAY 'ACCOUNT OPEN REJECTED — KYC: ' WS-KYC-STATUS
           END-IF.

      *----------------------------------------------------------------
      * CLOSE-ACCOUNT: marks account CLOSED and raises compliance flag.
      * BR-203: every closure must produce a COMPLIANCE_FLAGS record.
      *         No KYC re-check required for closures.
      *----------------------------------------------------------------
       CLOSE-ACCOUNT.
           EXEC SQL
               UPDATE ACCOUNT_MASTER
                   SET STATUS = 'CLOSED'
                   WHERE ACCOUNT_ID = :WS-ACCOUNT-ID
           END-EXEC
           EXEC SQL
               INSERT INTO COMPLIANCE_FLAGS
                   (FLAG_TYPE, ACCOUNT_ID, RAISED_DATE, RESOLVED)
               VALUES
                   ('CLOSURE', :WS-ACCOUNT-ID, CURRENT_DATE, FALSE)
           END-EXEC
           DISPLAY 'ACCOUNT ' WS-ACCOUNT-ID ' CLOSED'.

      *----------------------------------------------------------------
      * FREEZE-ACCOUNT: re-validates KYC then applies regulatory hold.
      * BR-204: AML requires identity re-check before freeze.
      *         Raises REGULATORY-HOLD flag in COMPLIANCE_FLAGS.
      *----------------------------------------------------------------
       FREEZE-ACCOUNT.
           MOVE 'REGULATORY-HOLD' TO WS-FLAG-TYPE
           PERFORM VALIDATE-KYC
           EXEC SQL
               UPDATE ACCOUNT_MASTER
                   SET STATUS = 'FROZEN'
                   WHERE ACCOUNT_ID = :WS-ACCOUNT-ID
           END-EXEC
           EXEC SQL
               INSERT INTO COMPLIANCE_FLAGS
                   (FLAG_TYPE, ACCOUNT_ID, RAISED_DATE, RESOLVED)
               VALUES
                   (:WS-FLAG-TYPE, :WS-ACCOUNT-ID, CURRENT_DATE, FALSE)
           END-EXEC
           DISPLAY 'ACCOUNT ' WS-ACCOUNT-ID ' FROZEN: '
                   WS-FREEZE-REASON.

      *----------------------------------------------------------------
      * VALIDATE-KYC: fetches KYC status and risk tier from DB.
      * BR-202: HIGH risk tier overrides KYC_STATUS to PENDING —
      *         customer must be manually reviewed by compliance team.
      *----------------------------------------------------------------
       VALIDATE-KYC.
           EXEC SQL
               SELECT KYC_STATUS,
                      RISK_TIER
               INTO   :WS-KYC-STATUS,
                      :WS-RISK-TIER
               FROM   CUSTOMER_DATA
               WHERE  CUSTOMER_ID = :WS-CUSTOMER-ID
           END-EXEC
           IF WS-RISK-TIER = 'HIGH'
               MOVE 'PENDING' TO WS-KYC-STATUS
               DISPLAY 'KYC OVERRIDE — HIGH RISK: ' WS-CUSTOMER-ID
           END-IF.

       END PROGRAM ACCTMSTR.
