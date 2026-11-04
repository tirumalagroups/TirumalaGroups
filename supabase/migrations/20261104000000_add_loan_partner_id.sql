-- New Loan Entry saves the Assigned Partner on the loan as partner_id.
-- The column was never added to finance.loans, so saving a loan failed with:
--   "Could not find the 'partner_id' column of 'loans' in the schema cache"
ALTER TABLE finance.loans
  ADD COLUMN IF NOT EXISTS partner_id uuid REFERENCES finance.partners(id) ON DELETE SET NULL;

ALTER TABLE finance.loans
  ADD COLUMN IF NOT EXISTS partner_name text;

-- Make the API see the new columns immediately
NOTIFY pgrst, 'reload schema';
