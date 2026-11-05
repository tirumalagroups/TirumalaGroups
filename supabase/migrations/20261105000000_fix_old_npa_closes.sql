-- Fix the two NPA closes that were saved the old (wrong) way.
--
-- LATHA A (CD505, receipt RC2647, 04-Nov-2026) and NARSIMULU GUNDRA (CD531, receipt RC2699, 05-Nov-2026)
-- were NPA closed with the old screen, which asked for a "settlement amount collected".
-- The full amount was typed there, so the app recorded it as money RECEIVED:
--   * a finance.npa_records row with settlement_amount = paid_amount = the full amount, waived_amount = 0
--   * a finance.loan_transactions 'Collection' row "NPA Closed Payment ..." for the same amount
--   * (the CD ledger rows failed to save because of a wrong column name, so there are none)
-- In the Day Book this showed the amount TWICE as Cash In (11,655 -> 23,310; 4,45,530 -> 8,91,060).
--
-- No money was received. The correct record (same as the new NPA close) is:
--   * NPA register: nothing paid, everything written off (waived_amount = loss)
--   * no 'Collection' transaction
--   * CD ledger, one receipt, entry_type 'NPA_WRITEOFF':
--       Debit  NPA WRITE-OFF / LOSS A/C  = loss            (P&L loss)
--       Credit CD LOAN RECEIVABLE A/C    = principal part  ("NPA CLOSE - PRINCIPAL")
--       Credit CD LOAN RECEIVABLE A/C    = interest part   ("NPA CLOSE - INTEREST")
--       Credit CD LOAN RECEIVABLE A/C    = penalty part    ("NPA CLOSE - PENALTY")
--
-- Amounts are taken from the saved remarks:
--   CD505: principal 10,360.75 + interest 1,035.41 + penalty 258.84 = 11,655.00
--   CD531: principal 4,00,000.00 + interest 36,424.00 + penalty 9,106.00 = 4,45,530.00
--
-- Safe to run more than once.

BEGIN;

-- 1. Remove the two "NPA Closed Payment" collections (no cash was received)
DELETE FROM finance.loan_transactions
WHERE id IN ('59ca8906-a767-4209-a0b5-2afa6975a028',   -- CD505 LATHA A, RC2647, 11,655.00
             '81cf8f6b-62ce-478d-a4f5-26ebfaefdb8d')   -- CD531 NARSIMULU GUNDRA, RC2699, 4,45,530.00
  AND type = 'Collection'
  AND remarks LIKE 'NPA Closed Payment%';

-- 2. NPA register: nothing paid, everything written off
UPDATE finance.npa_records
SET paid_amount = 0,
    settlement_amount = 0,
    waived_amount = 11655.00,
    total_liability = 11655.00,
    reason = CASE WHEN reason LIKE '%[RC2647]%' THEN reason ELSE reason || ' [RC2647]' END
WHERE id = 'e10c0a76-466b-467b-829d-c13bb5274bd5';      -- CD505 LATHA A

UPDATE finance.npa_records
SET paid_amount = 0,
    settlement_amount = 0,
    waived_amount = 445530.00,
    total_liability = 445530.00,
    reason = CASE WHEN reason LIKE '%[RC2699]%' THEN reason ELSE reason || ' [RC2699]' END
WHERE id = 'bd07057c-519f-4bdc-a30c-cfec1b9be5c5';      -- CD531 NARSIMULU GUNDRA

-- 3. CD ledger rows for the write-off (inserted only if not there yet)
INSERT INTO finance.cd_ledger_entries
  (loan_id, customer_id, receipt_no, date, entry_date, account_name, credit, debit, total_paid,
   principal_part, interest_part, penalty_part, particulars, user_name, entry_type, book_id)
SELECT v.loan_id::uuid, v.customer_id::uuid, v.receipt_no, v.d::date, v.d::date, v.account_name, v.credit, v.debit,
       v.credit + v.debit, v.pp, v.ip, v.np, v.particulars, 'RAMESH', 'NPA_WRITEOFF', 'd499da98-71a8-40d6-a167-ca67d8cdacab'::uuid
FROM (VALUES
  -- CD505 LATHA A
  ('07492c60-2cdc-44c5-901b-d829afa0d977', '05a5421a-8d9f-4d01-a0ae-1de9974de679', 'RC2647', '2026-11-04',
   'NPA WRITE-OFF / LOSS A/C', 0::numeric, 11655.00::numeric, 0::numeric, 0::numeric, 0::numeric,
   E'NPA CLOSE - CD505 - LATHA A\nPrincipal: ₹10,360.75  Interest: ₹1,035.41  Penalty: ₹258.84\nWritten off as loss: ₹11,655.00 (no amount received)\nReceipt: RC2647\nReason: DFS'),
  ('07492c60-2cdc-44c5-901b-d829afa0d977', '05a5421a-8d9f-4d01-a0ae-1de9974de679', 'RC2647', '2026-11-04',
   'CD LOAN RECEIVABLE A/C', 10360.75, 0, 10360.75, 0, 0, 'NPA CLOSE - PRINCIPAL - CD505 - LATHA A (Reason: DFS)'),
  ('07492c60-2cdc-44c5-901b-d829afa0d977', '05a5421a-8d9f-4d01-a0ae-1de9974de679', 'RC2647', '2026-11-04',
   'CD LOAN RECEIVABLE A/C', 1035.41, 0, 0, 1035.41, 0, 'NPA CLOSE - INTEREST - CD505 - LATHA A (Reason: DFS)'),
  ('07492c60-2cdc-44c5-901b-d829afa0d977', '05a5421a-8d9f-4d01-a0ae-1de9974de679', 'RC2647', '2026-11-04',
   'CD LOAN RECEIVABLE A/C', 258.84, 0, 0, 0, 258.84, 'NPA CLOSE - PENALTY - CD505 - LATHA A (Reason: DFS)'),
  -- CD531 NARSIMULU GUNDRA
  ('dc4db1e5-25b3-445a-b58a-c8701d4577e4', '294795d9-2f8d-4546-90a0-2e15b2f7f07e', 'RC2699', '2026-11-05',
   'NPA WRITE-OFF / LOSS A/C', 0, 445530.00, 0, 0, 0,
   E'NPA CLOSE - CD531 - NARSIMULU GUNDRA\nPrincipal: ₹4,00,000.00  Interest: ₹36,424.00  Penalty: ₹9,106.00\nWritten off as loss: ₹4,45,530.00 (no amount received)\nReceipt: RC2699\nReason: GH'),
  ('dc4db1e5-25b3-445a-b58a-c8701d4577e4', '294795d9-2f8d-4546-90a0-2e15b2f7f07e', 'RC2699', '2026-11-05',
   'CD LOAN RECEIVABLE A/C', 400000.00, 0, 400000.00, 0, 0, 'NPA CLOSE - PRINCIPAL - CD531 - NARSIMULU GUNDRA (Reason: GH)'),
  ('dc4db1e5-25b3-445a-b58a-c8701d4577e4', '294795d9-2f8d-4546-90a0-2e15b2f7f07e', 'RC2699', '2026-11-05',
   'CD LOAN RECEIVABLE A/C', 36424.00, 0, 0, 36424.00, 0, 'NPA CLOSE - INTEREST - CD531 - NARSIMULU GUNDRA (Reason: GH)'),
  ('dc4db1e5-25b3-445a-b58a-c8701d4577e4', '294795d9-2f8d-4546-90a0-2e15b2f7f07e', 'RC2699', '2026-11-05',
   'CD LOAN RECEIVABLE A/C', 9106.00, 0, 0, 0, 9106.00, 'NPA CLOSE - PENALTY - CD531 - NARSIMULU GUNDRA (Reason: GH)')
) AS v(loan_id, customer_id, receipt_no, d, account_name, credit, debit, pp, ip, np, particulars)
WHERE NOT EXISTS (
  SELECT 1 FROM finance.cd_ledger_entries e
  WHERE e.loan_id = v.loan_id::uuid
    AND e.receipt_no = v.receipt_no
    AND e.entry_type = 'NPA_WRITEOFF'
    AND e.account_name = v.account_name
    AND e.credit = v.credit
    AND e.debit = v.debit
);

COMMIT;

-- Check afterwards (expect: 0 collections, 2 register rows with settlement 0, 8 ledger rows; per loan debit = credits)
SELECT 'collections left' AS what, count(*)::text AS value
  FROM finance.loan_transactions
  WHERE id IN ('59ca8906-a767-4209-a0b5-2afa6975a028', '81cf8f6b-62ce-478d-a4f5-26ebfaefdb8d')
UNION ALL
SELECT 'register ' || customer_name, 'settlement ' || settlement_amount || ', loss ' || waived_amount
  FROM finance.npa_records
  WHERE id IN ('e10c0a76-466b-467b-829d-c13bb5274bd5', 'bd07057c-519f-4bdc-a30c-cfec1b9be5c5')
UNION ALL
SELECT 'ledger ' || receipt_no, 'debit ' || sum(debit) || ' / credit ' || sum(credit) || ' (' || count(*) || ' rows)'
  FROM finance.cd_ledger_entries
  WHERE receipt_no IN ('RC2647', 'RC2699') AND entry_type = 'NPA_WRITEOFF'
  GROUP BY receipt_no;
