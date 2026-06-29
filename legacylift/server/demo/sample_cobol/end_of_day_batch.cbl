      *================================================================
      * PROGRAM:    EODBTCH
      * PURPOSE:    Master end-of-day batch orchestrator.
      *             Runs after market close.  Drives interest
      *             calculation and KYC validation across all
      *             accounts, reconciles totals, writes audit
      *             record, and notifies downstream systems.
      *
      * ENTRY POINT: RUN-EOD (called by JCL step EODSTEP1)
      *
      * CALLS:
      *   PERFORM CALC-INTEREST  — interest_calc.cbl (INTCALC)
      *   PERFORM VALIDATE-KYC   — account_master.cbl (ACCTMSTR)
      *
      * BUSINESS RULES ENFORCED HERE:
      *   BR-301  If any processing step increments WS-ERROR-COUNT,
      *           GENERATE-REPORT and NOTIFY-DOWNSTREAM are skipped
      *           and WS-BATCH-STATUS is set to FAILED.
      *           Batch must never silently swallow errors.
      *   BR-302  WS-RUN-DATE is captured from system clock at entry.
      *           Do not accept a date parameter — prevents replay bugs.
      *   BR-303  NOTIFY-DOWNSTREAM must be the last step; calling it
      *           before reconciliation is a compliance violation.
      *
      * DB TABLE WRITTEN: EOD_AUDIT
      *
      * MIGRATION RISK: CRITICAL
      *   - Cross-program PERFORM references require careful mapping
      *   - CURRENT-DATE function differs between COBOL and Python
      *   - WS-NOTIFY-ENDPOINT is hardcoded — externalise to config
      *================================================================
       IDENTIFICATION DIVISION.
       PROGRAM-ID. EODBTCH.
       AUTHOR. M.OKONKWO.
       DATE-WRITTEN. 1999-11-30.

       ENVIRONMENT DIVISION.
       CONFIGURATION SECTION.
       SOURCE-COMPUTER. IBM-390.
       OBJECT-COMPUTER. IBM-390.

       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-TOTAL-ACCOUNTS     PIC 9(9).
       01  WS-TOTAL-INTEREST     PIC 9(15)V99.
       01  WS-BATCH-STATUS       PIC X(10).
       01  WS-RUN-DATE           PIC X(10).
       01  WS-ERROR-COUNT        PIC 9(5).
       01  WS-NOTIFY-ENDPOINT    PIC X(100).
       01  SQLCODE               PIC S9(9) COMP.

       PROCEDURE DIVISION.

      *----------------------------------------------------------------
      * RUN-EOD: master orchestrator — fixed execution order.
      * BR-301: GENERATE-REPORT and NOTIFY-DOWNSTREAM only run when
      *         WS-ERROR-COUNT = 0.  Any upstream failure aborts.
      * BR-302: date captured here; not accepted as a parameter.
      *----------------------------------------------------------------
       RUN-EOD.
           MOVE FUNCTION CURRENT-DATE(1:10) TO WS-RUN-DATE
           MOVE ZEROS TO WS-ERROR-COUNT
           MOVE ZEROS TO WS-TOTAL-ACCOUNTS
           MOVE ZEROS TO WS-TOTAL-INTEREST
           PERFORM CALC-INTEREST
           PERFORM VALIDATE-KYC
           PERFORM RECONCILE-TOTALS
           IF WS-ERROR-COUNT = 0
               PERFORM GENERATE-REPORT
               PERFORM NOTIFY-DOWNSTREAM
           ELSE
               MOVE 'FAILED' TO WS-BATCH-STATUS
               DISPLAY 'EOD ABORTED — ERROR COUNT: ' WS-ERROR-COUNT
           END-IF.

      *----------------------------------------------------------------
      * RECONCILE-TOTALS: queries ACCOUNT_MASTER for live totals.
      * Populates WS-TOTAL-ACCOUNTS and WS-TOTAL-INTEREST used by
      * GENERATE-REPORT.  SQLCODE failure increments error counter.
      *----------------------------------------------------------------
       RECONCILE-TOTALS.
           EXEC SQL
               SELECT COUNT(*),
                      SUM(BALANCE)
               INTO   :WS-TOTAL-ACCOUNTS,
                      :WS-TOTAL-INTEREST
               FROM   ACCOUNT_MASTER
               WHERE  STATUS = 'ACTIVE'
           END-EXEC
           IF SQLCODE NOT = 0
               ADD 1 TO WS-ERROR-COUNT
               DISPLAY 'RECONCILE FAILED — SQLCODE: ' SQLCODE
           END-IF.

      *----------------------------------------------------------------
      * GENERATE-REPORT: inserts one row into EOD_AUDIT per run.
      * Only reached when WS-ERROR-COUNT = 0 (enforced by RUN-EOD).
      * STATUS column is always COMPLETE at this point.
      *----------------------------------------------------------------
       GENERATE-REPORT.
           EXEC SQL
               INSERT INTO EOD_AUDIT
                   (RUN_DATE, TOTAL_ACCOUNTS,
                    TOTAL_INTEREST_APPLIED, STATUS)
               VALUES
                   (:WS-RUN-DATE, :WS-TOTAL-ACCOUNTS,
                    :WS-TOTAL-INTEREST, 'COMPLETE')
           END-EXEC
           DISPLAY 'EOD AUDIT WRITTEN FOR: ' WS-RUN-DATE.

      *----------------------------------------------------------------
      * NOTIFY-DOWNSTREAM: signals downstream settlement systems.
      * BR-303: must be last step — called only after audit is written.
      * WS-NOTIFY-ENDPOINT is hardcoded — externalise in migration.
      *----------------------------------------------------------------
       NOTIFY-DOWNSTREAM.
           MOVE 'https://internal-api/eod-complete' TO WS-NOTIFY-ENDPOINT
           DISPLAY 'NOTIFYING: ' WS-NOTIFY-ENDPOINT
           CALL 'HTTPPOST' USING WS-NOTIFY-ENDPOINT
                                 WS-BATCH-STATUS.

       END PROGRAM EODBTCH.
