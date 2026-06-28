      *================================================================
      * PROGRAM:    INTCALC
      * MODULE:     interest_calc.cbl
      * PURPOSE:    Calculate daily interest for savings accounts.
      *             Applies a tiered interest rate based on account
      *             balance using three tiers.
      *
      * BUSINESS RULES EMBEDDED HERE:
      *   BR-001: Balances < $10,000          → 2.5% per annum
      *   BR-002: Balances $10,000–$100,000   → 3.75% per annum
      *   BR-003: Balances > $100,000         → 4.5% per annum
      *   Calculation: DAILY_INT = BALANCE * RATE / 365
      *
      * CALLED BY:  END-OF-DAY-BATCH (end_of_day_batch.cbl)
      * CALLS:      ACCT-MASTER (account_master.cbl) for balance lookup
      *
      * MIGRATION NOTES:
      *   - Uses COMP-3 (packed decimal) for all monetary fields
      *   - INTEREST-RATE is a hardcoded VALUE — should move to config
      *   - See commented-out section near line 80 (old Tier-3 logic)
      *================================================================
       IDENTIFICATION DIVISION.
       PROGRAM-ID. INTCALC.
       AUTHOR. J.HARRISON.
       DATE-WRITTEN. 1998-03-15.
       DATE-COMPILED.

       ENVIRONMENT DIVISION.
       CONFIGURATION SECTION.
       SOURCE-COMPUTER. IBM-390.
       OBJECT-COMPUTER. IBM-390.

       DATA DIVISION.
       WORKING-STORAGE SECTION.
      *----------------------------------------------------------------
      * Input fields (passed from calling program)
      *----------------------------------------------------------------
       01  WS-ACCT-ID          PIC 9(10).
       01  WS-BALANCE          PIC S9(13)V99   COMP-3.
       01  WS-PROCESS-DATE     PIC 9(8).

      *----------------------------------------------------------------
      * Working fields
      *----------------------------------------------------------------
       01  WS-INTEREST-RATE    PIC S9(2)V9(6)  COMP-3.
       01  WS-DAILY-RATE       PIC S9(2)V9(10) COMP-3.
       01  WS-DAILY-INTEREST   PIC S9(11)V99   COMP-3.
       01  WS-TIER-CODE        PIC 9.
           88 WS-TIER-1        VALUE 1.
           88 WS-TIER-2        VALUE 2.
           88 WS-TIER-3        VALUE 3.

      *----------------------------------------------------------------
      * Thresholds (BR-001, BR-002, BR-003)
      *----------------------------------------------------------------
       01  WS-TIER1-LIMIT      PIC S9(13)V99   COMP-3  VALUE 10000.00.
       01  WS-TIER2-LIMIT      PIC S9(13)V99   COMP-3  VALUE 100000.00.

      *----------------------------------------------------------------
      * Rate constants (HARDCODED — move to parameter table in Python)
      *----------------------------------------------------------------
       01  WS-RATE-TIER1       PIC S9(2)V9(6)  COMP-3  VALUE 0.025000.
       01  WS-RATE-TIER2       PIC S9(2)V9(6)  COMP-3  VALUE 0.037500.
       01  WS-RATE-TIER3       PIC S9(2)V9(6)  COMP-3  VALUE 0.045000.
       01  WS-DAYS-IN-YEAR     PIC 9(3)                VALUE 365.

      *----------------------------------------------------------------
      * Output fields
      *----------------------------------------------------------------
       01  WS-CALC-STATUS      PIC X(2).
           88 WS-CALC-OK       VALUE '00'.
           88 WS-CALC-ERROR    VALUE '99'.
       01  WS-OUTPUT-INTEREST  PIC S9(11)V99   COMP-3.

       PROCEDURE DIVISION.

       MAIN-SECTION.
           PERFORM INIT-SECTION
           PERFORM DETERMINE-TIER-SECTION
           PERFORM CALC-INTEREST-SECTION
           PERFORM OUTPUT-RESULTS-SECTION
           GOBACK.

      *----------------------------------------------------------------
      * INIT-SECTION: Initialise working storage
      *----------------------------------------------------------------
       INIT-SECTION.
           MOVE ZEROS TO WS-DAILY-INTEREST
           MOVE ZEROS TO WS-OUTPUT-INTEREST
           MOVE '00'  TO WS-CALC-STATUS.

      *----------------------------------------------------------------
      * DETERMINE-TIER-SECTION: Choose which interest tier applies
      * Business rules: BR-001, BR-002, BR-003
      *----------------------------------------------------------------
       DETERMINE-TIER-SECTION.
           EVALUATE TRUE
             WHEN WS-BALANCE < WS-TIER1-LIMIT
               MOVE 1             TO WS-TIER-CODE
               MOVE WS-RATE-TIER1 TO WS-INTEREST-RATE
             WHEN WS-BALANCE >= WS-TIER1-LIMIT
                AND WS-BALANCE < WS-TIER2-LIMIT
               MOVE 2             TO WS-TIER-CODE
               MOVE WS-RATE-TIER2 TO WS-INTEREST-RATE
             WHEN WS-BALANCE >= WS-TIER2-LIMIT
               MOVE 3             TO WS-TIER-CODE
               MOVE WS-RATE-TIER3 TO WS-INTEREST-RATE
             WHEN OTHER
               MOVE '99' TO WS-CALC-STATUS
               MOVE ZEROS TO WS-INTEREST-RATE
           END-EVALUATE.

      *----------------------------------------------------------------
      * CALC-INTEREST-SECTION: Apply daily interest formula
      * Formula: DAILY_INT = BALANCE * (ANNUAL_RATE / 365)
      *          Uses ROUNDED to match bank ledger rounding rules
      *----------------------------------------------------------------
       CALC-INTEREST-SECTION.
           IF WS-CALC-ERROR
             NEXT SENTENCE
           ELSE
             COMPUTE WS-DAILY-RATE ROUNDED =
               WS-INTEREST-RATE / WS-DAYS-IN-YEAR
             COMPUTE WS-DAILY-INTEREST ROUNDED =
               WS-BALANCE * WS-DAILY-RATE
             MOVE WS-DAILY-INTEREST TO WS-OUTPUT-INTEREST
           END-IF.

      *----------------------------------------------------------------
      * OUTPUT-RESULTS-SECTION: Write results to output fields
      *----------------------------------------------------------------
       OUTPUT-RESULTS-SECTION.
           IF WS-CALC-OK
             CONTINUE
           ELSE
             MOVE ZEROS TO WS-OUTPUT-INTEREST
           END-IF.

      *================================================================
      * DEAD CODE — old flat-rate calculation replaced by tiered logic
      * DO NOT REMOVE — compliance requires keeping original logic visible
      * Last used: 1997-12-31 before tiered rates were introduced
      *================================================================
      * OLD-FLAT-RATE-SECTION.
      *     MOVE 0.030000 TO WS-INTEREST-RATE
      *     COMPUTE WS-DAILY-INTEREST ROUNDED =
      *         WS-BALANCE * WS-INTEREST-RATE / WS-DAYS-IN-YEAR
      *     MOVE WS-DAILY-INTEREST TO WS-OUTPUT-INTEREST.
      *================================================================

       END PROGRAM INTCALC.
