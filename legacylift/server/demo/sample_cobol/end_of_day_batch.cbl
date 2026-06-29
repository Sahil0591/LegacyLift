      *================================================================
      * PROGRAM:    EODBATCH
      * MODULE:     end_of_day_batch.cbl
      * PURPOSE:    End-of-day batch orchestrator.
      *             Iterates over all active accounts, calls INTCALC
      *             for interest calculation, calls ACCTMSTR for status
      *             update, and writes a daily summary report.
      *
      * BUSINESS RULES EMBEDDED HERE:
      *   BR-005: Batch must run between 23:00:00 and 23:59:59 AEST
      *           If outside window: set BATCH-STATUS='W', alert ops
      *   BR-008: Skip accounts with STATUS = 'C' (Closed) or 'F' (Frozen)
      *   BR-009: Date arithmetic uses YYYYMMDD format — handle century boundary
      *   BR-010: Maximum accounts per batch run: 5,000,000
      *           Exceeded: split into sub-batches (not implemented here)
      *
      * CALLS:      INTCALC    (interest_calc.cbl)
      *             ACCTMSTR   (account_master.cbl)
      *
      * GLOBAL STATE: WS-BATCH-DATE and WS-TOTAL-ACCOUNTS are shared
      *               across all paragraphs (WORKING-STORAGE).
      *
      * MIGRATION NOTES:
      *   - This is the MOST COMPLEX file (Risk: CRITICAL)
      *   - PERFORM VARYING loops over account file sequentially
      *   - Time window check uses hardcoded AEST offset (+10 hours)
      *   - YYYYMMDD date arithmetic is fragile — use datetime in Python
      *   - WS-REPORT-LINE is a fixed-width 132-char output record
      *================================================================
       IDENTIFICATION DIVISION.
       PROGRAM-ID. EODBATCH.
       AUTHOR. M.OKONKWO.
       DATE-WRITTEN. 1999-11-30.
       DATE-COMPILED.

       ENVIRONMENT DIVISION.
       CONFIGURATION SECTION.
       SOURCE-COMPUTER. IBM-390.
       OBJECT-COMPUTER. IBM-390.

       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT ACCT-MASTER-FILE ASSIGN TO DD-ACCTMSTR
                                   FILE STATUS IS WS-FILE-STATUS.
           SELECT REPORT-FILE      ASSIGN TO DD-EODREPORT
                                   FILE STATUS IS WS-RPT-STATUS.

       DATA DIVISION.
       FILE SECTION.

       FD  ACCT-MASTER-FILE
           RECORDING MODE IS F
           BLOCK CONTAINS 0 RECORDS.
       01  AMF-RECORD.
           05 AMF-ACCT-ID      PIC 9(10).
           05 AMF-STATUS       PIC X.
           05 AMF-BALANCE      PIC S9(13)V99  COMP-3.
           05 AMF-LAST-INT-DT  PIC 9(8).
           05 FILLER           PIC X(50).

       FD  REPORT-FILE
           RECORDING MODE IS F.
       01  RPT-LINE             PIC X(132).

       WORKING-STORAGE SECTION.
      *----------------------------------------------------------------
      * GLOBAL STATE — all paragraphs share these fields
      *----------------------------------------------------------------
       01  WS-BATCH-DATE       PIC 9(8).
       01  WS-BATCH-TIME       PIC 9(6).
       01  WS-BATCH-STATUS     PIC X(1)  VALUE 'R'.
           88 WS-BATCH-OK      VALUE 'R'.
           88 WS-BATCH-WARN    VALUE 'W'.
           88 WS-BATCH-ERROR   VALUE 'E'.

      *----------------------------------------------------------------
      * Time window constants (BR-005)
      * AEST = UTC + 10 hours (no DST handling — known limitation)
      *----------------------------------------------------------------
       01  WS-WINDOW-START     PIC 9(6)  VALUE 230000.
       01  WS-WINDOW-END       PIC 9(6)  VALUE 235900.
       01  WS-AEST-OFFSET      PIC 9(4)  VALUE 1000.

      *----------------------------------------------------------------
      * Account processing counters
      *----------------------------------------------------------------
       01  WS-TOTAL-ACCOUNTS   PIC 9(8)  COMP-3  VALUE 0.
       01  WS-PROCESSED-COUNT  PIC 9(8)  COMP-3  VALUE 0.
       01  WS-SKIPPED-COUNT    PIC 9(8)  COMP-3  VALUE 0.
       01  WS-ERROR-COUNT      PIC 9(8)  COMP-3  VALUE 0.
       01  WS-MAX-ACCOUNTS     PIC 9(8)  COMP-3  VALUE 5000000.

      *----------------------------------------------------------------
      * Totals
      *----------------------------------------------------------------
       01  WS-TOTAL-INTEREST   PIC S9(15)V99  COMP-3  VALUE 0.
       01  WS-PREV-INTEREST    PIC S9(15)V99  COMP-3  VALUE 0.
       01  WS-INT-VARIANCE     PIC S9(15)V99  COMP-3  VALUE 0.

      *----------------------------------------------------------------
      * File and loop control
      *----------------------------------------------------------------
       01  WS-FILE-STATUS      PIC X(2)  VALUE '00'.
       01  WS-RPT-STATUS       PIC X(2)  VALUE '00'.
       01  WS-EOF-FLAG         PIC X     VALUE 'N'.
           88 WS-EOF           VALUE 'Y'.
           88 WS-NOT-EOF       VALUE 'N'.

      *----------------------------------------------------------------
      * Linkage area for called programs (INTCALC, ACCTMSTR)
      *----------------------------------------------------------------
       01  WS-CALL-ACCT-ID     PIC 9(10).
       01  WS-CALL-BALANCE     PIC S9(13)V99  COMP-3.
       01  WS-CALL-DATE        PIC 9(8).
       01  WS-CALL-INTEREST    PIC S9(11)V99  COMP-3.
       01  WS-CALL-STATUS      PIC X(2).

      *----------------------------------------------------------------
      * Report formatting (132-char fixed width)
      *----------------------------------------------------------------
       01  WS-REPORT-LINE.
           05 WR-DATE          PIC 9(8).
           05 FILLER           PIC X    VALUE SPACES.
           05 WR-ACCT-COUNT    PIC ZZZ,ZZZ,ZZ9.
           05 FILLER           PIC X    VALUE SPACES.
           05 WR-TOTAL-INT     PIC ZZZ,ZZZ,ZZZ,ZZ9.99.
           05 FILLER           PIC X    VALUE SPACES.
           05 WR-STATUS        PIC X.
           05 FILLER           PIC X(99) VALUE SPACES.

       PROCEDURE DIVISION.

       MAIN-SECTION.
           PERFORM INIT-SECTION
           PERFORM WINDOW-CHECK-SECTION
           IF WS-BATCH-OK OR WS-BATCH-WARN
             OPEN INPUT ACCT-MASTER-FILE
             READ ACCT-MASTER-FILE
               AT END MOVE 'Y' TO WS-EOF-FLAG
             END-READ
             PERFORM PROCESS-ACCOUNTS-SECTION
               UNTIL WS-EOF OR WS-PROCESSED-COUNT > WS-MAX-ACCOUNTS
             CLOSE ACCT-MASTER-FILE
           END-IF
           PERFORM CALC-EOD-SECTION
           PERFORM WRITE-REPORT-SECTION
           PERFORM CLOSE-SECTION
           GOBACK.

      *----------------------------------------------------------------
      * INIT-SECTION: Set up batch run for today
      *----------------------------------------------------------------
       INIT-SECTION.
           ACCEPT WS-BATCH-DATE FROM DATE YYYYMMDD
           ACCEPT WS-BATCH-TIME FROM TIME
           MOVE ZEROS TO WS-TOTAL-ACCOUNTS
           MOVE ZEROS TO WS-PROCESSED-COUNT
           MOVE ZEROS TO WS-SKIPPED-COUNT
           MOVE ZEROS TO WS-ERROR-COUNT
           MOVE ZEROS TO WS-TOTAL-INTEREST
           DISPLAY 'EOD BATCH STARTED: ' WS-BATCH-DATE ' ' WS-BATCH-TIME.

      *----------------------------------------------------------------
      * WINDOW-CHECK-SECTION: Verify batch is running in allowed window
      * BR-005: Must run 23:00:00–23:59:59 AEST (UTC+10)
      *         AEST time = WS-BATCH-TIME + WS-AEST-OFFSET (simplified)
      *----------------------------------------------------------------
       WINDOW-CHECK-SECTION.
           EVALUATE TRUE
             WHEN WS-BATCH-TIME < WS-WINDOW-START
               MOVE 'W' TO WS-BATCH-STATUS
               DISPLAY 'WARNING: BATCH STARTED BEFORE WINDOW (23:00 AEST)'
             WHEN WS-BATCH-TIME > WS-WINDOW-END
               MOVE 'W' TO WS-BATCH-STATUS
               DISPLAY 'WARNING: BATCH STARTED AFTER WINDOW (23:59 AEST)'
             WHEN OTHER
               MOVE 'R' TO WS-BATCH-STATUS
               DISPLAY 'BATCH TIME WINDOW: OK'
           END-EVALUATE.

      *----------------------------------------------------------------
      * PROCESS-ACCOUNTS-SECTION: Main account loop
      * BR-008: Skip closed ('C') and frozen ('F') accounts
      *----------------------------------------------------------------
       PROCESS-ACCOUNTS-SECTION.
           ADD 1 TO WS-TOTAL-ACCOUNTS
           EVALUATE AMF-STATUS
             WHEN 'C'
               ADD 1 TO WS-SKIPPED-COUNT
             WHEN 'F'
               ADD 1 TO WS-SKIPPED-COUNT
             WHEN OTHER
               PERFORM CALL-INTEREST-CALC-SECTION
               PERFORM CALL-ACCOUNT-UPDATE-SECTION
               ADD 1 TO WS-PROCESSED-COUNT
               ADD WS-CALL-INTEREST TO WS-TOTAL-INTEREST
           END-EVALUATE
           READ ACCT-MASTER-FILE
             AT END MOVE 'Y' TO WS-EOF-FLAG
           END-READ.

      *----------------------------------------------------------------
      * CALL-INTEREST-CALC-SECTION: Call INTCALC for this account
      *----------------------------------------------------------------
       CALL-INTEREST-CALC-SECTION.
           MOVE AMF-ACCT-ID  TO WS-CALL-ACCT-ID
           MOVE AMF-BALANCE  TO WS-CALL-BALANCE
           MOVE WS-BATCH-DATE TO WS-CALL-DATE
           CALL 'INTCALC' USING
             WS-CALL-ACCT-ID
             WS-CALL-BALANCE
             WS-CALL-DATE
             WS-CALL-INTEREST
             WS-CALL-STATUS
           IF WS-CALL-STATUS NOT = '00'
             ADD 1 TO WS-ERROR-COUNT
             DISPLAY 'INTCALC ERROR FOR ACCT: ' WS-CALL-ACCT-ID
           END-IF.

      *----------------------------------------------------------------
      * CALL-ACCOUNT-UPDATE-SECTION: Call ACCTMSTR to update status
      *----------------------------------------------------------------
       CALL-ACCOUNT-UPDATE-SECTION.
           CALL 'ACCTMSTR' USING
             WS-CALL-ACCT-ID
             WS-BATCH-DATE
             WS-CALL-STATUS
           IF WS-CALL-STATUS NOT = '00'
             ADD 1 TO WS-ERROR-COUNT
             DISPLAY 'ACCTMSTR ERROR FOR ACCT: ' WS-CALL-ACCT-ID
           END-IF.

      *----------------------------------------------------------------
      * CALC-EOD-SECTION: Compute day-over-day interest variance
      * (used for anomaly detection — if variance > 10%, alert)
      *----------------------------------------------------------------
       CALC-EOD-SECTION.
           COMPUTE WS-INT-VARIANCE ROUNDED =
             (WS-TOTAL-INTEREST - WS-PREV-INTEREST) /
               WS-PREV-INTEREST * 100
           IF WS-INT-VARIANCE > 10 OR WS-INT-VARIANCE < -10
             DISPLAY 'ALERT: INTEREST VARIANCE > 10%: ' WS-INT-VARIANCE
           END-IF.

      *----------------------------------------------------------------
      * WRITE-REPORT-SECTION: Write fixed-width 132-char report line
      *----------------------------------------------------------------
       WRITE-REPORT-SECTION.
           OPEN OUTPUT REPORT-FILE
           MOVE WS-BATCH-DATE        TO WR-DATE
           MOVE WS-PROCESSED-COUNT   TO WR-ACCT-COUNT
           MOVE WS-TOTAL-INTEREST    TO WR-TOTAL-INT
           MOVE WS-BATCH-STATUS      TO WR-STATUS
           MOVE WS-REPORT-LINE       TO RPT-LINE
           WRITE RPT-LINE
           DISPLAY 'EOD REPORT WRITTEN: ' WS-PROCESSED-COUNT
                   ' ACCOUNTS / INTEREST: ' WS-TOTAL-INTEREST.

      *----------------------------------------------------------------
      * CLOSE-SECTION
      *----------------------------------------------------------------
       CLOSE-SECTION.
           CLOSE REPORT-FILE
           DISPLAY 'EOD BATCH COMPLETE'
           DISPLAY 'PROCESSED: ' WS-PROCESSED-COUNT
           DISPLAY 'SKIPPED:   ' WS-SKIPPED-COUNT
           DISPLAY 'ERRORS:    ' WS-ERROR-COUNT.

       END PROGRAM EODBATCH.
