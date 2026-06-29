      *================================================================
      * PROGRAM:    INTCALC
      * PURPOSE:    End-of-day compound interest calculation for
      *             savings and premium deposit accounts.
      *
      * CALLED BY:  EODBTCH (end_of_day_batch.cbl)
      *             Entry point: PERFORM CALC-INTEREST
      *
      * BUSINESS RULES ENFORCED HERE:
      *   BR-101  Base rate loaded into WS-INTEREST-RATE by caller
      *           from the PROD_TYPE rate table before entry.
      *   BR-102  PREMIUM account type earns +0.0025 bonus rate.
      *   BR-103  Balances exceeding 100,000 earn +0.0010 tier bonus.
      *           Bonuses are additive; max effective = BASE + 0.0035.
      *   BR-104  Formula: BALANCE * (RATE / 100) * (DAYS / 365).
      *           Simple-interest approximation agreed with actuaries
      *           in 1994.  Compound migration deferred to RFC-0047.
      *
      * HARDCODED VALUES — migrate to config table in Python:
      *   0.0025  premium bonus (BR-102)
      *   0.0010  high-balance bonus (BR-103)
      *   100000  high-balance threshold (BR-103)
      *
      * DB TABLE UPDATED: ACCOUNT_MASTER
      *================================================================
       IDENTIFICATION DIVISION.
       PROGRAM-ID. INTCALC.
       AUTHOR. J.HARRISON.
       DATE-WRITTEN. 1994-08-15.

       ENVIRONMENT DIVISION.
       CONFIGURATION SECTION.
       SOURCE-COMPUTER. IBM-390.
       OBJECT-COMPUTER. IBM-390.

       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-ACCOUNT-ID         PIC X(10).
       01  WS-BALANCE            PIC 9(13)V99.
       01  WS-INTEREST-RATE      PIC 9(3)V9(4).
       01  WS-INTEREST-AMT       PIC 9(13)V99.
       01  WS-ACCOUNT-TYPE       PIC X(10).
       01  WS-BONUS-RATE         PIC 9(3)V9(4).
       01  WS-DAYS-IN-PERIOD     PIC 9(3).
       01  SQLCODE               PIC S9(9) COMP.
       01  WS-TEMP-RATE          PIC 9(3)V9(8).
       01  WS-PERIOD-FACTOR      PIC 9(3)V9(8).
       01  WS-ERROR-MSG          PIC X(50).
       01  WS-ERROR-FLAG         PIC X(1)   VALUE 'N'.

       PROCEDURE DIVISION.

      *----------------------------------------------------------------
      * CALC-INTEREST: entry point for one account per EOD loop.
      * Adjusts rate for bonuses, computes interest, writes to DB.
      *----------------------------------------------------------------
       CALC-INTEREST.
           PERFORM APPLY-BONUS-RATE
           COMPUTE WS-TEMP-RATE =
               WS-INTEREST-RATE / 100
           COMPUTE WS-PERIOD-FACTOR =
               WS-DAYS-IN-PERIOD / 365
           COMPUTE WS-INTEREST-AMT ROUNDED =
               WS-BALANCE * WS-TEMP-RATE * WS-PERIOD-FACTOR
           PERFORM UPDATE-ACCOUNT.

      *----------------------------------------------------------------
      * APPLY-BONUS-RATE: increments WS-INTEREST-RATE in place.
      * BR-102: PREMIUM type adds 0.0025.
      * BR-103: balance > 100,000 adds 0.0010.
      * Both may apply at the same time.
      *----------------------------------------------------------------
       APPLY-BONUS-RATE.
           IF WS-ACCOUNT-TYPE = 'PREMIUM'
               ADD 0.0025 TO WS-INTEREST-RATE
           END-IF
           IF WS-BALANCE > 100000
               ADD 0.0010 TO WS-INTEREST-RATE
           END-IF.

      *----------------------------------------------------------------
      * UPDATE-ACCOUNT: writes computed interest to ACCOUNT_MASTER.
      * Any non-zero SQLCODE is a hard error — delegate and halt.
      *----------------------------------------------------------------
       UPDATE-ACCOUNT.
           EXEC SQL
               UPDATE ACCOUNT_MASTER
                   SET BALANCE      = :WS-BALANCE + :WS-INTEREST-AMT,
                       LAST_UPDATED = CURRENT_DATE
                   WHERE ACCOUNT_ID = :WS-ACCOUNT-ID
           END-EXEC
           IF SQLCODE NOT = 0
               MOVE 'UPDATE FAILED FOR ACCOUNT' TO WS-ERROR-MSG
               PERFORM ERROR-HANDLER
           END-IF.

      *----------------------------------------------------------------
      * ERROR-HANDLER: surface failure and halt the program.
      * Sets WS-ERROR-FLAG so the caller can inspect state.
      *----------------------------------------------------------------
       ERROR-HANDLER.
           DISPLAY 'INTCALC ERROR: ' WS-ERROR-MSG
           MOVE 'Y' TO WS-ERROR-FLAG
           STOP RUN.

       END PROGRAM INTCALC.
