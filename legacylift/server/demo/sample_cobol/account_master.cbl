      *================================================================
      * PROGRAM:    ACCTMSTR
      * MODULE:     account_master.cbl
      * PURPOSE:    Account lookup, validation, and status update.
      *             Reads from ACCT_MSTR and CUST_MSTR tables.
      *             Writes back to ACCT_MSTR and ACCT_AUDIT tables.
      *
      * BUSINESS RULES EMBEDDED HERE:
      *   BR-004: Accounts > 90 days past due → status code 'D'
      *           (Delinquent) — blocks further withdrawals
      *   BR-006: Status 'C' (Closed) accounts → read-only, no updates
      *   BR-007: Fixed string 'N/A' used for missing customer names
      *
      * READS:   ACCT_MSTR (account master)
      *          CUST_MSTR (customer master)
      * WRITES:  ACCT_MSTR (status update)
      *          ACCT_AUDIT (audit trail)
      *
      * MIGRATION NOTES:
      *   - PIC X(30) fields are fixed-length — Python strings are not
      *   - DATE-LAST-PAYMENT stored as PIC 9(8) YYYYMMDD integer
      *   - Dead code block at lines 88-100 (old 60-day threshold)
      *   - CUST-NAME uses MOVE SPACES which Python must handle carefully
      *================================================================
       IDENTIFICATION DIVISION.
       PROGRAM-ID. ACCTMSTR.
       AUTHOR. P.CHEN.
       DATE-WRITTEN. 1995-07-22.

       ENVIRONMENT DIVISION.
       CONFIGURATION SECTION.
       SOURCE-COMPUTER. IBM-390.

       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT ACCT-FILE    ASSIGN TO DD-ACCTMSTR
                               FILE STATUS IS WS-ACCT-STATUS.
           SELECT AUDIT-FILE   ASSIGN TO DD-ACCTAUDIT
                               FILE STATUS IS WS-AUDIT-STATUS.

       DATA DIVISION.
       FILE SECTION.

       FD  ACCT-FILE.
       01  ACCT-RECORD.
           05 AR-ACCT-ID         PIC 9(10).
           05 AR-CUST-ID         PIC 9(10).
           05 AR-ACCT-TYPE       PIC X(2).
           05 AR-BALANCE         PIC S9(13)V99  COMP-3.
           05 AR-OPEN-DATE       PIC 9(8).
           05 AR-LAST-PMT-DATE   PIC 9(8).
           05 AR-DAYS-OVERDUE    PIC 9(5)       COMP-3.
           05 AR-STATUS-CODE     PIC X.
           05 AR-CUST-NAME       PIC X(30).
           05 FILLER             PIC X(18).

       FD  AUDIT-FILE.
       01  AUDIT-RECORD.
           05 AU-ACCT-ID         PIC 9(10).
           05 AU-ACTION          PIC X(10).
           05 AU-OLD-STATUS      PIC X.
           05 AU-NEW-STATUS      PIC X.
           05 AU-TIMESTAMP       PIC 9(14).
           05 FILLER             PIC X(25).

       WORKING-STORAGE SECTION.
       01  WS-ACCT-STATUS        PIC X(2)  VALUE '00'.
       01  WS-AUDIT-STATUS       PIC X(2)  VALUE '00'.
       01  WS-PROCESS-DATE       PIC 9(8).
       01  WS-OVERDUE-THRESHOLD  PIC 9(3)  VALUE 90.
       01  WS-ACTION             PIC X(10).
       01  WS-OLD-STATUS         PIC X.
       01  WS-TIMESTAMP          PIC 9(14).
       01  WS-FOUND-FLAG         PIC X     VALUE 'N'.
           88 WS-FOUND           VALUE 'Y'.
           88 WS-NOT-FOUND       VALUE 'N'.

       PROCEDURE DIVISION.

       MAIN-SECTION.
           PERFORM OPEN-FILES-SECTION
           PERFORM LOOKUP-ACCOUNT-SECTION
           IF WS-FOUND
             PERFORM VALIDATE-ACCOUNT-SECTION
             PERFORM UPDATE-STATUS-SECTION
             PERFORM WRITE-AUDIT-SECTION
           END-IF
           PERFORM CLOSE-FILES-SECTION
           GOBACK.

      *----------------------------------------------------------------
      * OPEN-FILES-SECTION
      *----------------------------------------------------------------
       OPEN-FILES-SECTION.
           OPEN I-O   ACCT-FILE
           OPEN OUTPUT AUDIT-FILE
           IF WS-ACCT-STATUS NOT = '00'
             DISPLAY 'ERROR OPENING ACCT FILE: ' WS-ACCT-STATUS
             MOVE 'N' TO WS-FOUND-FLAG
           END-IF.

      *----------------------------------------------------------------
      * LOOKUP-ACCOUNT-SECTION: Read account record by key
      *----------------------------------------------------------------
       LOOKUP-ACCOUNT-SECTION.
           READ ACCT-FILE INTO ACCT-RECORD
             KEY IS AR-ACCT-ID
             INVALID KEY
               MOVE 'N' TO WS-FOUND-FLAG
               DISPLAY 'ACCOUNT NOT FOUND: ' AR-ACCT-ID
             NOT INVALID KEY
               MOVE 'Y' TO WS-FOUND-FLAG
           END-READ
           IF AR-CUST-NAME = SPACES
             MOVE 'N/A' TO AR-CUST-NAME
           END-IF.

      *----------------------------------------------------------------
      * VALIDATE-ACCOUNT-SECTION: Check account is eligible for update
      * BR-006: Closed accounts are read-only
      *----------------------------------------------------------------
       VALIDATE-ACCOUNT-SECTION.
           IF AR-STATUS-CODE = 'C'
             DISPLAY 'ACCOUNT ' AR-ACCT-ID ' IS CLOSED — NO UPDATE'
             MOVE 'N' TO WS-FOUND-FLAG
           END-IF.

      *----------------------------------------------------------------
      * UPDATE-STATUS-SECTION: Apply delinquency logic
      * BR-004: > 90 days overdue → status 'D'
      *----------------------------------------------------------------
       UPDATE-STATUS-SECTION.
           MOVE AR-STATUS-CODE TO WS-OLD-STATUS
           IF AR-DAYS-OVERDUE > WS-OVERDUE-THRESHOLD
             MOVE 'D' TO AR-STATUS-CODE
             MOVE 'STATUS-UPD' TO WS-ACTION
             REWRITE ACCT-RECORD
               INVALID KEY
                 DISPLAY 'REWRITE FAILED FOR ACCT: ' AR-ACCT-ID
             END-REWRITE
           END-IF.

      *================================================================
      * DEAD CODE — old 60-day delinquency threshold
      * Changed to 90 days in 2001 per regulatory directive RD-2001-14
      * Kept here as audit record per compliance requirement C-REG-88
      *================================================================
      * OLD-60-DAY-THRESHOLD-SECTION.
      *     IF AR-DAYS-OVERDUE > 60
      *       MOVE 'D' TO AR-STATUS-CODE
      *     END-IF.
      *================================================================

      *----------------------------------------------------------------
      * WRITE-AUDIT-SECTION: Record status change in audit trail
      *----------------------------------------------------------------
       WRITE-AUDIT-SECTION.
           MOVE AR-ACCT-ID     TO AU-ACCT-ID
           MOVE WS-ACTION      TO AU-ACTION
           MOVE WS-OLD-STATUS  TO AU-OLD-STATUS
           MOVE AR-STATUS-CODE TO AU-NEW-STATUS
           MOVE WS-TIMESTAMP   TO AU-TIMESTAMP
           WRITE AUDIT-RECORD
             INVALID KEY
               DISPLAY 'AUDIT WRITE FAILED FOR ACCT: ' AR-ACCT-ID
           END-WRITE.

      *----------------------------------------------------------------
      * CLOSE-FILES-SECTION
      *----------------------------------------------------------------
       CLOSE-FILES-SECTION.
           CLOSE ACCT-FILE
           CLOSE AUDIT-FILE.

       END PROGRAM ACCTMSTR.
