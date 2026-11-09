-- Removes the rupee symbol from old saved Finance remarks. Amounts are not touched.
-- New entries are saved without the symbol, and the code reads old and new text the same way.
-- On 9 Nov 2026 this affected 9 rows of finance.loan_transactions and 2 of finance.cd_ledger_entries.

BEGIN;

UPDATE finance.loan_transactions
SET remarks = replace(replace(remarks, '₹ ', ''), '₹', '')
WHERE remarks LIKE '%₹%';

UPDATE finance.cd_ledger_entries
SET particulars = replace(replace(particulars, '₹ ', ''), '₹', '')
WHERE particulars LIKE '%₹%';

COMMIT;

-- Check: both counts should be 0
SELECT
  (SELECT count(*) FROM finance.loan_transactions WHERE remarks LIKE '%₹%') AS loan_transactions_left,
  (SELECT count(*) FROM finance.cd_ledger_entries WHERE particulars LIKE '%₹%') AS cd_ledger_entries_left;
