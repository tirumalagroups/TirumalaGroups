import { getLocalBusinessDateISO } from '../utils/dateUtils';
import { supabase } from './supabaseDatabase';
import { financeCalculationService } from '../services/financeCalculationService';
import { cdLedgerRebuildService } from '../services/cdLedgerRebuildService';
import { FinanceCalculationEngine } from '../services/FinanceCalculationEngine';
import {
  buildHPContract, hpOpening, hpRound, hpOpeningRemarks, isHPOpeningRow, HP_OPENING_PREFIX,
  hpPaymentsFromTransactions, previewHPPayment, hpReceiptRemarks, HPPaymentKind, HPSplit
} from '../services/hpLedgerEngine';

// TypeScript Interfaces for Finance Mode
export interface FinancePartner {
  id: string;
  partner_id?: number;
  partner_code?: string | null;
  name: string;
  is_md?: boolean;
  share_percent?: number;
  phone: string | null;
  home_phone?: string | null;
  village?: string | null;
  md_name?: string | null;
  address?: string | null;
  created_at: string;
  updated_at: string;
}

export interface FinanceLedgerSetting {
  code: string;
  rate: number;
  overdue: number;
  method: string;
  days_per_year: number;
  principal_rolls_on_renewal: boolean;
  updated_at?: string;
}

export interface FinanceCustomer {
  id: string;
  name: string;
  phone: string | null;
  phone2?: string | null;
  partner_name?: string | null;
  address: string | null;
  aadhaar: string | null;
  created_at: string;
  updated_at: string;
  customer_photo_url?: string | null;
  fingerprint_url?: string | null;
  fingerprint_template?: string | null;
  fingerprint_added?: boolean;
  customer_fingerprint_template?: string | null;
  customer_fingerprint_image_url?: string | null;
  customer_fingerprint_added?: boolean;
  surety_fingerprint_template?: string | null;
  surety_fingerprint_image_url?: string | null;
  surety_fingerprint_added?: boolean;
  father_husband_name?: string | null;
  
  // Redesign fields
  customer_id?: number;
  father_name?: string | null;
  village?: string | null;
  mandal?: string | null;
  district?: string | null;
  aadhaar_address?: string | null;
  aadhaar_village?: string | null;
  aadhaar_mandal?: string | null;
  aadhaar_district?: string | null;
  present_address?: string | null;
  present_village?: string | null;
  present_mandal?: string | null;
  present_district?: string | null;
  phone_1?: string | null;
  phone_2?: string | null;
}

/**
 * Helper to fetch ALL pages from a Supabase query builder, bypassing the 1000-row default limit.
 */
export const fetchAllPages = async <T = any>(
  queryFactory: (from: number, to: number) => any,
  pageSize = 1000
): Promise<T[]> => {
  let allRows: T[] = [];
  let page = 0;
  let hasMore = true;

  while (hasMore) {
    const from = page * pageSize;
    const to = from + pageSize - 1;
    const { data, error } = await queryFactory(from, to);
    if (error) {
      console.error('Error in fetchAllPages:', error);
      break;
    }
    if (data && data.length > 0) {
      allRows.push(...data);
      if (data.length < pageSize) {
        hasMore = false;
      } else {
        page++;
      }
    } else {
      hasMore = false;
    }
  }

  return allRows;
};

export interface FinanceGuarantor {
  id: string;
  guarantor_id?: number;
  name: string;
  aadhaar: string | null;
  aadhaar_address?: string | null;
  present_address?: string | null;
  phone: string | null;
  phone_2?: string | null;
  father_name?: string | null;
  village?: string | null;
  mandal?: string | null;
  district?: string | null;
  permanent_address?: string | null;
  permanent_village?: string | null;
  permanent_mandal?: string | null;
  permanent_district?: string | null;
  current_address?: string | null;
  current_village?: string | null;
  current_mandal?: string | null;
  current_district?: string | null;
  photo_url?: string | null;
  fingerprint_template?: string | null;
  fingerprint_image_url?: string | null;
  fingerprint_added?: boolean;
  fingerprint_status?: string | null;
  fingerprint_id?: string | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface FinanceLoan {
  id: string;
  loan_id: string;
  customer_id: string;
  date: string;
  amount: number;
  interest_rate: number;
  duration_months: number;
  due_type: 'Daily' | 'Weekly' | 'Monthly';
  due_amount: number;
  surety_name: string | null;
  surety_phone: string | null;
  surety_aadhaar: string | null;
  surety_aadhaar_address?: string | null;
  surety_present_address?: string | null;
  surety_relation?: string | null;
  remarks: string | null;
  status: 'Active' | 'Closed' | 'NPA_CLOSED';
  created_at: string;
  updated_at: string;
  customer_photo_url?: string | null;
  surety_photo_url?: string | null;
  fingerprint_url?: string | null;
  fingerprint_template?: string | null;
  fingerprint_added?: boolean;
  customer_fingerprint_template?: string | null;
  customer_fingerprint_image_url?: string | null;
  customer_fingerprint_added?: boolean;
  surety_fingerprint_template?: string | null;
  surety_fingerprint_image_url?: string | null;
  surety_fingerprint_added?: boolean;
  father_husband_name?: string | null;
  loan_category?: string;
  partner_id?: string | null;
  partner_name?: string | null;
  npa_closed?: boolean;
  document_charges?: number;
  penalty_percent?: number;
  guarantor_1_id?: string | null;
  guarantor_2_id?: string | null;
  deleted_at?: string | null;
  period_days?: number | null;
  grace_days?: number | null;
  balance_with_interest?: number | null;
  balance_without_interest?: number | null;
  installments_paid?: number | null;
  installments_due?: number | null;
  dc_status?: string | null;
}

export interface FinanceLoanDocument {
  id: string;
  loan_id: string;
  category: string;
  document_name: string;
  remarks: string | null;
  file_url: string | null;
  is_submitted: boolean;
  created_at: string;
  updated_at: string;
}

export interface FinanceTransaction {
  id: string;
  loan_id: string;
  date: string;
  amount: number;
  type: 'Collection' | 'Disbursement' | 'Interest Charge' | 'Other';
  collected_by: string | null;
  remarks: string | null;
  payment_mode?: string | null;
  receipt_no?: string | null;
  created_at: string;
  updated_at: string;
}

export interface FinanceTransactionReview {
  id: string;
  book_id?: string | null;
  finance_mode: 'REGULAR' | 'ITR';
  source_type: 'Loan Payment' | 'Day Book Entry';
  source_id: string;
  loan_id?: string | null;
  receipt_number?: string | null;
  transaction_type: string;
  transaction_date: string;
  amount: number;
  penalty_amount?: number;
  interest_amount?: number;
  principal_amount?: number;
  entered_by: string;
  entered_at: string;
  review_status: 'PENDING' | 'APPROVED' | 'REJECTED';
  approved_by?: string | null;
  approved_at?: string | null;
  created_at: string;
  updated_at: string;
  action_type?: 'CREATE' | 'EDIT' | 'DELETE';
}


export interface FinanceCapitalEntry {
  id: string;
  entry_date: string;
  partner_id: string;
  partner_name: string | null;
  particulars: string | null;
  credit: number;
  debit: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  amount?: number;
  type?: 'Credit' | 'Debit';
}

export interface FinanceDue {
  id: string;
  loan_id: string;
  due_date: string;
  amount: number;
  paid_amount: number;
  status: 'Pending' | 'Paid' | 'Partially Paid';
  created_at: string;
  updated_at: string;
}

export interface FinancePhoto {
  id: string;
  loan_id: string;
  photo_type: 'Customer' | 'Surety';
  photo_url: string;
  created_at: string;
}

export interface FinanceDocument {
  id: string;
  loan_id: string;
  document_type: string;
  document_url: string;
  created_at: string;
}


export interface FinanceEditedLog {
  id: string;
  table_name: string;
  record_id: string;
  old_values: any;
  new_values: any;
  edited_by: string;
  edited_at: string;
}

export interface FinanceDeletedLog {
  id: string;
  table_name: string;
  record_id: string;
  old_values: any;
  deleted_by: string;
  deleted_at: string;
}

export interface FinanceCashbookAccount {
  id: string;
  account_name: string;
  account_number: string | null;
  report_classification?: 'BALANCE_SHEET' | 'PROFIT_AND_LOSS' | null;
  report_section?: 'BALANCE_SHEET' | 'PROFIT_AND_LOSS' | null;
  category?: string | null;
  created_at: string;
}

export interface FinanceCashbookEntry {
  id: string;
  entry_date: string;
  account_number: string | null;
  head_of_account: string;
  particulars: string;
  credit: number;
  debit: number;
  created_by: string | null;
  book_id?: string | null;
  status?: string | null;
  approved_by?: string | null;
  approved_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface UnifiedLedgerEntry {
  id: string;
  date: string;
  account_number: string;
  head_of_account: string;
  debit: number;
  credit: number;
  particulars: string;
  user: string;
  category: 'CD' | 'HP' | 'STBD' | 'TBD' | 'BANK' | 'SALARY' | 'EXPENSE' | 'CAPITAL' | 'LIABILITIES' | 'OTHER';
}

export interface FinanceNPARecord {
  id: string;
  loan_id: string | null;
  customer_id: string | null;
  customer_name: string;
  aadhaar: string | null;
  phone: string | null;
  loan_type: string | null;
  loan_amount: number;
  paid_amount: number;
  balance_amount: number;
  interest_due: number;
  penalty_due: number;
  settlement_amount: number;
  total_liability?: number;
  waived_amount?: number;
  reason: string | null;
  full_history_json: any;
  closed_by: string | null;
  closed_at: string;
  created_at: string;
}

export interface FinanceCDLedgerEntry {
  id: string;
  loan_id: string;
  customer_id: string | null;
  entry_date: string;
  account_name: string | null;
  credit: number;
  debit: number;
  receipt_no: string | null;
  particulars: string | null;
  user_name: string | null;
  entry_type: string | null;
  created_at: string;
  book_id?: string | null;
  principal_paid?: number;
  interest_paid?: number;
  penalty_paid?: number;
}

export interface FinanceCDInterestDetail {
  id: string;
  loan_id: string;
  entry_id: string;
  entry_date: string;
  credit: number;
  receipt_no: string | null;
  particulars: string | null;
  renewed_days: number;
  renewed_till_date: string | null;
  row_type: string | null;
  created_at: string;
}

export interface FinanceLoanPaymentFollowup {
  id: string;
  loan_id: string;
  follow_up_date: string;
  followed_up_at: string;
  followed_up_by: string;
  contacted_person: string;
  result: string;
  narration: string;
  next_follow_up_date: string | null;
  promised_amount?: number | null;
  created_at: string;
  updated_at: string;
  loan?: any;
}


export interface FinanceNPARecord {
  id: string;
  loan_id: string | null;
  customer_id: string | null;
  customer_name: string;
  aadhaar: string | null;
  phone: string | null;
  loan_type: string | null;
  loan_amount: number;
  paid_amount: number;
  balance_amount: number;
  interest_due: number;
  penalty_due: number;
  settlement_amount: number;
  total_liability?: number;
  waived_amount?: number;
  reason: string | null;
  full_history_json: any | null;
  closed_by: string | null;
  closed_at: string;
  created_at: string;
}

export interface FinanceDocumentReturned {
  id: string;
  loan_id: string;
  returned_date: string;
  returned_to: string;
  received_by_signature: string | null;
  remarks: string | null;
  created_by: string | null;
  created_at: string;
  receipt_no?: string | null;
}

export interface FinanceWaiverAudit {
  id: string;
  loan_id: string;
  waived_date: string;
  waived_by: string;
  waiver_reason: string | null;
  waived_interest: number;
  waived_penalty: number;
  waived_commission: number;
  receipt_no: string | null;
  created_at: string;
  updated_at: string;
}

// --------------------------------------------------
// Settings & System Configuration Interfaces


/**
 * Loan columns that may not exist yet in an older live database
 * (e.g. finance.loans.partner_id before its migration is run).
 * If the database says one of these is missing, the save is retried without it
 * so the loan still saves instead of failing with "Could not find the 'partner_id' column".
 */
const OPTIONAL_LOAN_COLUMNS = ['partner_id', 'partner_name'];

const missingOptionalLoanColumn = (err: any): string | null => {
  if (!err) return null;
  const msg = String(err.message || '');
  if (err.code !== 'PGRST204' && !/schema cache/i.test(msg)) return null;
  return OPTIONAL_LOAN_COLUMNS.find(col => msg.includes(`'${col}'`)) || null;
};

const runLoanWriteWithColumnFallback = async <T>(
  row: Record<string, any>,
  write: (row: Record<string, any>) => PromiseLike<{ data: T | null; error: any }>
): Promise<{ data: T | null; error: any }> => {
  let current = { ...row };
  let result = await write(current);
  for (let attempt = 0; attempt < OPTIONAL_LOAN_COLUMNS.length && result.error; attempt++) {
    const col = missingOptionalLoanColumn(result.error);
    if (!col || !(col in current)) break;
    console.warn(`[finance_loans] Column "${col}" is missing in the database; saving the loan without it. Run the partner_id migration to store it.`);
    const { [col]: _dropped, ...rest } = current;
    current = rest;
    result = await write(current);
  }
  return result;
};

class SupabaseFinance {
  // --- Partners ---
  async getPartners(): Promise<FinancePartner[]> {
    try {
      const { data, error } = await supabase
        .from('finance_partners')
        .select('*')
        .order('name');
      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error fetching finance partners:', error);
      return [];
    }
  }

  async getPartnerBasics(): Promise<Partial<FinancePartner>[]> {
    try {
      const { data, error } = await supabase
        .from('finance_partners')
        .select('id, partner_id, name, phone, is_md')
        .order('name');
      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error fetching finance partner basics:', error);
      return [];
    }
  }

  async createPartner(partner: Omit<FinancePartner, 'id' | 'created_at' | 'updated_at'>): Promise<FinancePartner | null> {
    try {
      const { data, error } = await supabase
        .from('finance_partners')
        .insert([partner])
        .select()
        .single();
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error creating finance partner:', error);
      throw error;
    }
  }

  async updatePartner(id: string, partner: Partial<FinancePartner>, editedBy: string): Promise<FinancePartner | null> {
    try {
      // Get old values for logging
      const { data: oldData } = await supabase
        .from('finance_partners')
        .select('*')
        .eq('id', id)
        .single();

      const { data, error } = await supabase
        .from('finance_partners')
        .update({ ...partner, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;

      if (oldData) {
        await this.logEdit('finance_partners', id, oldData, data, editedBy);
      }
      return data;
    } catch (error) {
      console.error('Error updating finance partner:', error);
      throw error;
    }
  }

  async deletePartner(id: string, deletedBy: string): Promise<boolean> {
    try {
      const { data: oldData } = await supabase
        .from('finance_partners')
        .select('*')
        .eq('id', id)
        .single();

      const { error } = await supabase
        .from('finance_partners')
        .delete()
        .eq('id', id);
      if (error) throw error;

      if (oldData) {
        await this.logDelete('finance_partners', id, oldData, deletedBy);
      }
      return true;
    } catch (error) {
      console.error('Error deleting finance partner:', error);
      return false;
    }
  }

  // --- Guarantors ---
  async getGuarantors(): Promise<FinanceGuarantor[]> {
    try {
      const { data, error } = await supabase
        .from('finance_guarantors')
        .select('*')
        .is('deleted_at', null)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error fetching finance guarantors:', error);
      return [];
    }
  }

  async searchGuarantors(query: string): Promise<Partial<FinanceGuarantor>[]> {
    try {
      if (!query || query.length < 2) return [];
      
      const { data, error } = await supabase
        .from('finance_guarantors')
        .select('id, guarantor_id, name, aadhaar, phone, phone_2, permanent_address, permanent_village, permanent_mandal, permanent_district, current_address, current_village, current_mandal, current_district, village, mandal, district, aadhaar_address, present_address')
        .is('deleted_at', null)
        .or(`name.ilike.%${query}%,guarantor_id.eq.${!isNaN(Number(query)) ? Number(query) : 0},phone.ilike.%${query}%,aadhaar.ilike.%${query}%`)
        .limit(10);
      
      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error searching finance guarantors:', error);
      return [];
    }
  }

  async getGuarantorById(id: string): Promise<FinanceGuarantor | null> {
    try {
      const { data, error } = await supabase
        .from('finance_guarantors')
        .select('*')
        .eq('id', id)
        .single();
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error fetching finance guarantor by id:', error);
      return null;
    }
  }

  async createGuarantor(guarantor: Omit<FinanceGuarantor, 'id' | 'created_at' | 'updated_at'>): Promise<FinanceGuarantor | null> {
    try {
      const { data, error } = await supabase
        .from('finance_guarantors')
        .insert([guarantor])
        .select()
        .single();
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error creating finance guarantor:', error);
      return null;
    }
  }

  async updateGuarantor(id: string, guarantor: Partial<FinanceGuarantor>, editedBy: string): Promise<FinanceGuarantor | null> {
    try {
      const { data: oldData } = await supabase
        .from('finance_guarantors')
        .select('*')
        .eq('id', id)
        .single();

      const { data, error } = await supabase
        .from('finance_guarantors')
        .update({ ...guarantor, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;

      if (oldData) {
        await this.logEdit('finance_guarantors', id, oldData, data, editedBy);
      }

      return data;
    } catch (error) {
      console.error('Error updating finance guarantor:', error);
      return null;
    }
  }

  async deleteGuarantor(id: string, deletedBy: string): Promise<boolean> {
    try {
      // Check for active loans
      const { count: loanCount1, error: error1 } = await supabase
        .from('finance_loans')
        .select('*', { count: 'exact', head: true })
        .eq('guarantor_1_id', id)
        .neq('status', 'Closed');
      const { count: loanCount2, error: error2 } = await supabase
        .from('finance_loans')
        .select('*', { count: 'exact', head: true })
        .eq('guarantor_2_id', id)
        .neq('status', 'Closed');

      if (error1 || error2) throw error1 || error2;
      
      if ((loanCount1 || 0) > 0 || (loanCount2 || 0) > 0) {
        return false;
      }

      const { data: oldData } = await supabase
        .from('finance_guarantors')
        .select('*')
        .eq('id', id)
        .single();

      // Soft delete
      const { error } = await supabase
        .from('finance_guarantors')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id);
        
      if (error) throw error;

      if (oldData) {
        await this.logDelete('finance_guarantors', id, oldData, deletedBy);
      }
      return true;
    } catch (error) {
      console.error('Error deleting finance guarantor:', error);
      return false;
    }
  }

  async addTransaction(payload: Partial<FinanceTransaction>): Promise<FinanceTransaction> {
    const { data, error } = await supabase.from('finance_transactions').insert(payload).select().single();
    if (error) {
      console.error('Error adding finance transaction:', error);
      throw error;
    }
    return data;
  }

  async addCDLedgerEntry(payload: Partial<FinanceCDLedgerEntry>): Promise<FinanceCDLedgerEntry> {
    const totalPaidVal = Number(payload.credit || 0) + Number(payload.debit || 0);
    const fullPayload = {
      ...payload,
      date: payload.entry_date || (payload as any).date,
      entry_date: payload.entry_date || (payload as any).date,
      total_paid: (payload as any).total_paid !== undefined ? (payload as any).total_paid : totalPaidVal
    };
    const { data, error } = await supabase.from('finance_cd_ledger_entries').insert(fullPayload).select().single();
    if (error) {
      console.error('Error adding CD ledger entry:', error);
      throw error;
    }
    return data;
  }

  async addCDInterestDetail(payload: Partial<FinanceCDInterestDetail>): Promise<FinanceCDInterestDetail> {
    const fullPayload: any = {
      ...payload,
      entry_date: payload.entry_date || (payload as any).date
    };
    if ('date' in fullPayload) {
      delete fullPayload.date;
    }
    const { data, error } = await supabase.from('finance_cd_interest_details').insert(fullPayload).select().single();
    if (error) {
      console.error('Error adding CD interest detail:', error);
      throw error;
    }
    return data;
  }

  async getNextReceiptNumber(): Promise<string> {
    try {
      const { data, error } = await supabase.schema('finance').rpc('get_next_finance_receipt_no');
      if (error) throw error;
      if (!data) throw new Error('No receipt number returned from database');
      return data as string;
    } catch (e) {
      console.error('Error generating receipt number:', e);
      throw new Error('Unable to generate receipt number. Payment was not saved.');
    }
  }

  async generateUniqueReceiptNo(): Promise<string> {
    return this.getNextReceiptNumber();
  }

  async postCdLedgerPayment(params: {
    loanId: string;
    customerId: string;
    accountName: string | null;
    userName: string;
    actionType: 'Renew' | 'Partial' | 'Close';
    principalPaid: number;
    interestPaid: number;
    penaltyPaid: number;
    renewedDays: number;
    paymentDate?: string;
    receiptNo?: string;
    renewedTillDate?: string | null;
  }): Promise<{ success: boolean; error?: string; receiptNo?: string }> {
    try {
      const receiptNo = params.receiptNo || await this.generateUniqueReceiptNo();
      const entryDate = params.paymentDate ? new Date(params.paymentDate).toISOString() : new Date().toISOString();
      const totalAmount = params.principalPaid + params.interestPaid + params.penaltyPaid;

      // Build remarks
      let remarks = '';
      if (params.actionType === 'Renew') {
        if (params.interestPaid === 0 && params.penaltyPaid === 0) {
          remarks = `Renewal Payment / Principal Adjusted - ${receiptNo}`;
        } else {
          let parts = ['Renewal Payment'];
          let adjusted: string[] = [];
          if (params.penaltyPaid > 0) adjusted.push('Penalty Paid');
          if (params.interestPaid > 0) adjusted.push('Interest Paid');
          if (params.principalPaid > 0) adjusted.push('Principal Adjusted');
          parts.push(adjusted.join(' & '));
          remarks = `${parts.join(' / ')} - ${receiptNo}`;
        }
      } else {
        const actionText = params.actionType === 'Partial' ? 'Partial Payment' : 'Close Account';
        let parts = [actionText];
        let adjusted: string[] = [];
        if (params.penaltyPaid > 0) adjusted.push('Penalty Paid');
        if (params.interestPaid > 0) adjusted.push('Interest Paid');
        if (params.principalPaid > 0) adjusted.push('Principal Paid');
        if (adjusted.length > 0) {
          parts.push(adjusted.join(' & '));
        } else {
          parts.push('Principal Adjusted');
        }
        remarks = `${parts.join(' / ')} - ${receiptNo}`;
      }

      // 1. Post to finance_transactions (Daybook)
      const tx = await this.addTransaction({
        loan_id: params.loanId,
        type: 'Collection',
        amount: totalAmount,
        date: entryDate,
        remarks: remarks,
        collected_by: params.userName,
        receipt_no: receiptNo
      });

      // Log transaction review entry asynchronously
      this.logTransactionForReview({
        loanId: params.loanId,
        sourceType: 'Loan Payment',
        sourceId: tx.id,
        receiptNo: receiptNo,
        transactionType: params.actionType === 'Renew' ? 'CD Renewal' : (params.actionType === 'Partial' ? 'CD Partial Payment' : 'CD Close'),
        transactionDate: entryDate,
        amount: totalAmount,
        penaltyAmount: params.penaltyPaid,
        interestAmount: params.interestPaid,
        principalAmount: params.principalPaid,
        enteredBy: params.userName
      }).catch(err => console.error('Error logging CD payment for review:', err));

      // 1.5. Post CD Amount Paid (Audit Row)
      await this.addCDLedgerEntry({
        loan_id: params.loanId,
        customer_id: params.customerId,
        account_name: 'CD Amount Paid',
        entry_date: entryDate,
        credit: totalAmount,
        debit: 0,
        receipt_no: receiptNo,
        particulars: `CD Amount Paid - ${receiptNo}`,
        user_name: params.userName,
        entry_type: 'amount_paid'
      });

      let mainEntryId: string | null = null;
      const actionText = params.actionType === 'Renew'
        ? 'Renewal Completed'
        : (params.actionType === 'Partial' ? 'Partial Payment' : 'Close');

      const isInterestOrPenaltyPaid = params.interestPaid > 0 || params.penaltyPaid > 0;

      // 2. Post Penalty
      if (params.penaltyPaid > 0) {
        const penaltyParticulars = params.actionType === 'Renew'
          ? 'Penalty Paid - Renewal Payment'
          : `Penalty Paid - ${actionText} - ${receiptNo}`;

        const entry = await this.addCDLedgerEntry({
          loan_id: params.loanId,
          customer_id: params.customerId,
          account_name: 'PENALTY A/C',
          entry_date: entryDate,
          credit: params.penaltyPaid,
          debit: 0,
          receipt_no: receiptNo,
          particulars: penaltyParticulars,
          user_name: params.userName,
          entry_type: 'penalty_payment'
        });

        if (entry) {
          mainEntryId = entry.id;
          if (isInterestOrPenaltyPaid) {
            await this.addCDInterestDetail({
              loan_id: params.loanId,
              entry_id: entry.id,
              entry_date: entryDate,
              credit: params.penaltyPaid,
              receipt_no: receiptNo,
              particulars: penaltyParticulars,
              renewed_days: 0,
              renewed_till_date: null,
              row_type: entry.entry_type
            });
          }
        }
      }

      // 3. Post Interest
      if (params.interestPaid > 0) {
        const interestParticulars = params.renewedDays > 0
          ? financeCalculationService.formatRenewedDaysDescription(params.renewedDays)
          : `Interest Paid - ${actionText} - ${receiptNo}`;

        const entry = await this.addCDLedgerEntry({
          loan_id: params.loanId,
          customer_id: params.customerId,
          account_name: 'CD COMMISSION A/C',
          entry_date: entryDate,
          credit: params.interestPaid,
          debit: 0,
          receipt_no: receiptNo,
          particulars: interestParticulars,
          user_name: params.userName,
          entry_type: 'interest_payment'
        });

        if (entry) {
          if (!mainEntryId) mainEntryId = entry.id;
          if (isInterestOrPenaltyPaid) {
            const renewedTillDate = params.renewedTillDate !== undefined
              ? params.renewedTillDate
              : (params.renewedDays > 0 
                  ? getLocalBusinessDateISO(new Date(new Date(entryDate).getTime() + params.renewedDays * 24 * 60 * 60 * 1000))
                  : null);

            await this.addCDInterestDetail({
              loan_id: params.loanId,
              entry_id: entry.id,
              entry_date: entryDate,
              credit: params.interestPaid,
              receipt_no: receiptNo,
              particulars: interestParticulars,
              renewed_days: params.renewedDays,
              renewed_till_date: renewedTillDate,
              row_type: entry.entry_type
            });
          }
        }
      }

      // 4. Post Principal
      if (params.principalPaid > 0) {
        const principalParticulars = params.actionType === 'Renew'
          ? 'Principal Adjusted - Renewal Payment'
          : `Principal Adjusted - ${actionText} - ${receiptNo}`;

        const entry = await this.addCDLedgerEntry({
          loan_id: params.loanId,
          customer_id: params.customerId,
          account_name: 'CD A/C',
          entry_date: entryDate,
          credit: params.principalPaid,
          debit: 0,
          receipt_no: receiptNo,
          particulars: principalParticulars,
          user_name: params.userName,
          entry_type: 'principal_payment'
        });

        if (entry) {
          if (!mainEntryId) mainEntryId = entry.id;
          if (isInterestOrPenaltyPaid) {
            await this.addCDInterestDetail({
              loan_id: params.loanId,
              entry_id: entry.id,
              entry_date: entryDate,
              credit: params.principalPaid,
              receipt_no: receiptNo,
              particulars: principalParticulars,
              renewed_days: 0,
              renewed_till_date: null,
              row_type: entry.entry_type
            });
          }
        }
      }

      // 5. Post Note row to Interest Details (Credit = 0, contains full split detail description)
      if (mainEntryId && isInterestOrPenaltyPaid) {
        const renewedTillDate = params.renewedDays > 0 
          ? getLocalBusinessDateISO(new Date(new Date(entryDate).getTime() + params.renewedDays * 24 * 60 * 60 * 1000))
          : null;

        const noteParticulars = params.actionType === 'Renew'
          ? `Renewal Completed Note: Total Paid ${totalAmount} (Penalty: ${params.penaltyPaid}, Interest: ${params.interestPaid}, Principal: ${params.principalPaid})`
          : `${params.actionType} Note: Total Paid ${totalAmount} (Penalty: ${params.penaltyPaid}, Interest: ${params.interestPaid}, Principal: ${params.principalPaid})`;

        await this.addCDInterestDetail({
          loan_id: params.loanId,
          entry_id: mainEntryId,
          entry_date: entryDate,
          credit: 0,
          receipt_no: receiptNo,
          particulars: noteParticulars,
          renewed_days: params.renewedDays,
          renewed_till_date: renewedTillDate,
          row_type: params.actionType === 'Renew' ? 'Renewal' : 'Partial Payment'
        });
      }

      return { success: true, receiptNo };
    } catch (e: any) {
      console.error('Error posting CD ledger payment:', e);
      return { success: false, error: e?.message || String(e) };
    }
  }

  async postCdNpaClose(params: {
    loanId: string;
    customerId: string;
    customerName: string;
    loanIdStr: string;
    userName: string;
    totalOutstanding: number;
    settlementAmount: number;
    waivedAmount: number;
    principalPaid: number;
    interestPaid: number;
    penaltyPaid: number;
    docChargesPaid?: number;
    paymentDate: string;
    receiptNo: string;
    reason: string;
  }): Promise<{ success: boolean; error?: string; receiptNo?: string }> {
    try {
      const entryDate = params.paymentDate.split('T')[0];
      const receiptNo = params.receiptNo || await this.getNextReceiptNumber();

      // 1. If actual cash was received from customer (Cash Collection)
      if (params.settlementAmount > 0) {
        const particularsLines = [
          `NPA Closed Payment - ${params.loanIdStr} - ${params.customerName}`,
          `Principal Paid: ${params.principalPaid.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          `Interest Paid: ${params.interestPaid.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          `Penalty Paid: ${params.penaltyPaid.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          ...((params.docChargesPaid || 0) > 0 ? [`Document Charges: ${(params.docChargesPaid || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`] : []),
          `Total Received: ${params.settlementAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          `Receipt: ${receiptNo}`,
          ...(params.reason ? [`Reason: ${params.reason}`] : [])
        ];
        const npaPaymentParticulars = particularsLines.join('\n');

        // Post to finance_transactions (Day Book & Global Transaction Journal)
        const tx = await this.addTransaction({
          loan_id: params.loanId,
          type: 'Collection',
          amount: params.settlementAmount,
          date: entryDate,
          remarks: npaPaymentParticulars,
          collected_by: params.userName,
          receipt_no: receiptNo
        });

        // Log review entry asynchronously
        this.logTransactionForReview({
          loanId: params.loanId,
          sourceType: 'Loan Payment',
          sourceId: tx.id,
          receiptNo: receiptNo,
          transactionType: 'NPA Close',
          transactionDate: entryDate,
          amount: params.settlementAmount,
          penaltyAmount: params.penaltyPaid,
          interestAmount: params.interestPaid,
          principalAmount: params.principalPaid,
          enteredBy: params.userName
        }).catch(err => console.error('Error logging NPA Close for review:', err));

        // Post to finance_cd_ledger_entries (Cash Collection entry)
        await this.addCDLedgerEntry({
          loan_id: params.loanId,
          customer_id: params.customerId,
          account_name: 'CD A/C',
          entry_date: entryDate,
          credit: params.settlementAmount,
          debit: 0,
          receipt_no: receiptNo,
          particulars: npaPaymentParticulars,
          user_name: params.userName,
          // (finance_cd_ledger_entries has no principal_paid / interest_paid / penalty_paid
          //  columns - sending them made every NPA close fail; the split is in the particulars)
          entry_type: 'NPA_CLOSE'
        });

        // Audit row for amount paid
        await this.addCDLedgerEntry({
          loan_id: params.loanId,
          customer_id: params.customerId,
          account_name: 'CD Amount Paid',
          entry_date: entryDate,
          credit: params.settlementAmount,
          debit: 0,
          receipt_no: receiptNo,
          particulars: `CD Amount Paid - ${receiptNo}`,
          user_name: params.userName,
          entry_type: 'amount_paid'
        });
      }

      // 2. If an amount was waived / written off (Balanced Journal Entry)
      if (params.waivedAmount > 0) {
        const writeoffParticularsLines = [
          `NPA CLOSURE / WRITE-OFF / WAIVER - ${params.loanIdStr} - ${params.customerName}`,
          `Total Outstanding: ${params.totalOutstanding.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          `Actual Paid: ${params.settlementAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          `Waived / Written Off: ${params.waivedAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          ...(params.reason ? [`Reason: ${params.reason}`] : [])
        ];
        const writeoffParticulars = writeoffParticularsLines.join('\n');
        const writeoffReceiptNo = receiptNo ? `WO-${receiptNo}` : undefined;

        // Debit side: NPA WRITE-OFF / LOSS A/C (P&L Loss / Expense)
        await this.addCDLedgerEntry({
          loan_id: params.loanId,
          customer_id: params.customerId,
          account_name: 'NPA WRITE-OFF / LOSS A/C',
          entry_date: entryDate,
          credit: 0,
          debit: params.waivedAmount,
          receipt_no: writeoffReceiptNo,
          particulars: writeoffParticulars,
          user_name: params.userName,
          entry_type: 'NPA_WRITEOFF',
        });

        // Credit side: CD LOAN RECEIVABLE A/C (Balance Sheet Asset Reduction)
        await this.addCDLedgerEntry({
          loan_id: params.loanId,
          customer_id: params.customerId,
          account_name: 'CD LOAN RECEIVABLE A/C',
          entry_date: entryDate,
          credit: params.waivedAmount,
          debit: 0,
          receipt_no: writeoffReceiptNo,
          particulars: writeoffParticulars,
          user_name: params.userName,
          entry_type: 'NPA_WRITEOFF',
        });

        // Log audit waiver
        await this.addWaiverAudit({
          loan_id: params.loanId,
          waived_date: entryDate,
          waived_by: params.userName,
          waiver_reason: params.reason ? `NPA Closure Write-off: ${params.reason}` : 'NPA Closure Write-off',
          waived_interest: Math.max(0, params.totalOutstanding - params.principalPaid - params.settlementAmount),
          waived_penalty: 0,
          waived_commission: 0,
          receipt_no: writeoffReceiptNo || receiptNo
        }).catch(err => console.error('Error logging NPA waiver audit:', err));
      } else if (params.settlementAmount === 0) {
        // Zero payment & zero outstanding closure audit row
        await this.addCDLedgerEntry({
          loan_id: params.loanId,
          customer_id: params.customerId,
          account_name: 'CD A/C',
          entry_date: entryDate,
          credit: 0,
          debit: 0,
          receipt_no: receiptNo,
          particulars: `NPA Closed - ${params.loanIdStr} - ${params.customerName}${params.reason ? ` (${params.reason})` : ''}`,
          user_name: params.userName,
          entry_type: 'NPA_CLOSE',
        });
      }

      return { success: true, receiptNo };
    } catch (e: any) {
      console.error('Error posting CD NPA close:', e);
      return { success: false, error: e?.message || String(e) };
    }
  }

  /**
   * NPA close with NO money received: the whole "Total for Close" is written off as loss.
   * Ledger rows (one receipt, all entry_type 'NPA_WRITEOFF'):
   *   - Debit  NPA WRITE-OFF / LOSS A/C  = loss (total for close)            -> P&L expense
   *   - Credit CD LOAN RECEIVABLE A/C    = principal part  ("NPA CLOSE - PRINCIPAL")
   *   - Credit CD LOAN RECEIVABLE A/C    = interest part   ("NPA CLOSE - INTEREST")
   *   - Credit CD LOAN RECEIVABLE A/C    = penalty part    ("NPA CLOSE - PENALTY")
   * Debit = sum of credits, so the cash balance does not change (no cash moved).
   * The Day Book groups these rows by receipt: debit row = parent, credit rows = children.
   */
  async postCdNpaWriteOff(params: {
    loanId: string;
    customerId: string;
    customerName: string;
    loanIdStr: string;
    userName: string;
    principalPart: number;
    interestPart: number;
    penaltyPart: number;
    paymentDate: string;
    receiptNo: string;
    reason: string;
  }): Promise<{ success: boolean; error?: string; receiptNo?: string; loss?: number }> {
    const r2 = (v: number) => Number((Number(v) || 0).toFixed(2));
    const fmt = (v: number) => `${r2(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const inserted: string[] = [];
    try {
      const entryDate = params.paymentDate.split('T')[0];
      const receiptNo = params.receiptNo || await this.getNextReceiptNumber();
      const principal = Math.max(0, r2(params.principalPart));
      const interest = Math.max(0, r2(params.interestPart));
      const penalty = Math.max(0, r2(params.penaltyPart));
      const loss = r2(principal + interest + penalty);
      const head = `${params.loanIdStr} - ${params.customerName}`;
      const summary = [
        `NPA CLOSE - ${head}`,
        `Principal: ${fmt(principal)}  Interest: ${fmt(interest)}  Penalty: ${fmt(penalty)}`,
        `Written off as loss: ${fmt(loss)} (no amount received)`,
        `Receipt: ${receiptNo}`,
        ...(params.reason ? [`Reason: ${params.reason}`] : [])
      ].join('\n');

      const base = {
        loan_id: params.loanId,
        customer_id: params.customerId,
        entry_date: entryDate,
        receipt_no: receiptNo,
        user_name: params.userName,
        entry_type: 'NPA_WRITEOFF'
      };

      if (loss > 0) {
        const dr = await this.addCDLedgerEntry({ ...base, account_name: 'NPA WRITE-OFF / LOSS A/C', credit: 0, debit: loss, particulars: summary });
        inserted.push(dr.id);
        const parts: Array<[string, number]> = [['PRINCIPAL', principal], ['INTEREST', interest], ['PENALTY', penalty]];
        for (const [label, amt] of parts) {
          if (amt <= 0) continue;
          const cr = await this.addCDLedgerEntry({
            ...base,
            account_name: 'CD LOAN RECEIVABLE A/C',
            credit: amt,
            debit: 0,
            particulars: `NPA CLOSE - ${label} - ${head}${params.reason ? ` (Reason: ${params.reason})` : ''}`,
            // the ledger table's own split columns
            ...(label === 'PRINCIPAL' ? { principal_part: amt } : label === 'INTEREST' ? { interest_part: amt } : { penalty_part: amt })
          } as any);
          inserted.push(cr.id);
        }
      } else {
        // Nothing outstanding: keep a zero marker row so the ledger shows when the NPA close happened
        const mk = await this.addCDLedgerEntry({ ...base, account_name: 'CD A/C', credit: 0, debit: 0, entry_type: 'NPA_CLOSE', particulars: summary });
        inserted.push(mk.id);
      }

      this.addWaiverAudit({
        loan_id: params.loanId,
        waived_date: entryDate,
        waived_by: params.userName,
        waiver_reason: params.reason ? `NPA Closure Write-off: ${params.reason}` : 'NPA Closure Write-off',
        waived_interest: interest,
        waived_penalty: penalty,
        waived_commission: 0,
        receipt_no: receiptNo
      }).catch(err => console.error('Error logging NPA waiver audit:', err));

      return { success: true, receiptNo, loss };
    } catch (e: any) {
      console.error('Error posting CD NPA write-off:', e);
      // Undo the rows already written so a retry does not leave half an entry behind
      if (inserted.length > 0) {
        await supabase.from('finance_cd_ledger_entries').delete().in('id', inserted);
      }
      return { success: false, error: e?.message || String(e) };
    }
  }

  async postStbdLedgerPayment(params: {
    loanId: string;
    customerId: string;
    customerName: string;
    loanIdStr: string;
    userName: string;
    payingInsts: number;
    principalPaid: number;
    commissionPaid: number;
    penaltyPaid: number;
    discount: number;
    waivedPenalty?: number;
    paymentDate: string;
    receiptNo: string;
    waiverReason?: string;
    waivedBy?: string;
    waivedDate?: string;
  }): Promise<{ success: boolean; error?: string }> {
    try {
      const entryDate = params.paymentDate;
      const totalAmount = params.principalPaid + params.commissionPaid + params.penaltyPaid;

      // 1. Post to finance_transactions (Daybook)
      const tx = await this.addTransaction({
        loan_id: params.loanId,
        type: 'Collection',
        amount: totalAmount,
        date: entryDate,
        remarks: `STBD Collection - ${params.receiptNo} (Inst: ${params.payingInsts}, Prin: ${params.principalPaid}, Comm: ${params.commissionPaid}, Pen: ${params.penaltyPaid})`,
        collected_by: params.userName,
        receipt_no: params.receiptNo
      });

      // Log transaction review entry asynchronously
      this.logTransactionForReview({
        loanId: params.loanId,
        sourceType: 'Loan Payment',
        sourceId: tx.id,
        receiptNo: params.receiptNo,
        transactionType: 'STBD Payment',
        transactionDate: entryDate,
        amount: totalAmount,
        penaltyAmount: params.penaltyPaid,
        interestAmount: params.commissionPaid,
        principalAmount: params.principalPaid,
        enteredBy: params.userName
      }).catch(err => console.error('Error logging STBD payment for review:', err));

      // 2. Post splits to finance_cashbook_entries
      await this.createCashbookEntry({
        entry_date: entryDate,
        account_number: params.loanIdStr,
        head_of_account: 'STBD A/c',
        particulars: `${params.customerName} - Installment Payment ${params.receiptNo}`,
        credit: params.principalPaid,
        debit: 0,
        created_by: params.userName
      });

      await this.createCashbookEntry({
        entry_date: entryDate,
        account_number: params.loanIdStr,
        head_of_account: 'STBD Commission A/c',
        particulars: `${params.customerName} - Commission Payment ${params.receiptNo}`,
        credit: params.commissionPaid,
        debit: 0,
        created_by: params.userName
      });

      if (params.penaltyPaid > 0) {
        await this.createCashbookEntry({
          entry_date: entryDate,
          account_number: params.loanIdStr,
          head_of_account: 'STBD PENALTY A/c',
          particulars: `${params.customerName} - Penalty Payment ${params.receiptNo}`,
          credit: params.penaltyPaid,
          debit: 0,
          created_by: params.userName
        });
      }

      // 3. Update Loan account metrics
      const { data: loan } = await supabase
        .from('finance_loans')
        .select('*')
        .eq('id', params.loanId)
        .single();

      if (!loan) throw new Error('Loan not found');

      const amount = Number(loan.amount);
      const period = Number(loan.duration_months);
      const installmentAmount = Number(loan.due_amount);
      const interestRate = Number(loan.interest_rate);

      // Capitalized interest
      const interestAmount = amount * (interestRate / 100) * period;
      const totalLoan = amount + interestAmount;

      const currentBalanceWithout = Number(loan.balance_without_interest ?? amount);
      const currentOnlyPremiumPaid = amount - currentBalanceWithout;

      const newOnlyPremiumPaid = currentOnlyPremiumPaid + params.principalPaid;
      const newIpaid = newOnlyPremiumPaid / (amount / period);
      const newPaidAmount = Math.min(totalLoan, financeCalculationService.roundRupee(newIpaid * installmentAmount));

      const newBalanceWithout = Math.max(0, amount - newOnlyPremiumPaid);
      const newBalanceWith = Math.max(0, totalLoan - newPaidAmount);

      const isClosed = newBalanceWithout <= 2 || newBalanceWith <= 2;

      const { error: updateError } = await supabase
        .from('finance_loans')
        .update({
          installments_paid: newIpaid,
          balance_without_interest: isClosed ? 0 : newBalanceWithout,
          balance_with_interest: isClosed ? 0 : newBalanceWith,
          status: isClosed ? 'Closed' : 'Active',
          updated_at: new Date().toISOString()
        })
        .eq('id', params.loanId);

      if (updateError) throw updateError;

      // Log waiver if any discount or penalty is waived
      if (params.discount > 0 || (params.waivedPenalty && params.waivedPenalty > 0)) {
        await this.addWaiverAudit({
          loan_id: params.loanId,
          waived_date: params.waivedDate || params.paymentDate,
          waived_by: params.waivedBy || params.userName,
          waiver_reason: params.waiverReason || 'Payment waiver adjustment',
          waived_interest: 0,
          waived_penalty: params.waivedPenalty || 0,
          waived_commission: params.discount,
          receipt_no: params.receiptNo
        });
      }

      return { success: true };
    } catch (e: any) {
      console.error('Error posting STBD payment:', e);
      return { success: false, error: e?.message || String(e) };
    }
  }

  /**
   * HP receipt (payment or close). The split is worked out by the HP engine from the loan terms and
   * every earlier receipt, so the screen cannot post a wrong split. One finance_transactions row per
   * receipt; the Day Book reads its split from the remarks (no separate cash book rows, which used to
   * list the same money twice).
   */
  async postHPReceipt(params: {
    loanId: string;
    kind: HPPaymentKind;
    date: string;
    amount: number;
    receiptNo: string;
    userName: string;
  }): Promise<{ success: boolean; error?: string; split?: HPSplit; closed?: boolean }> {
    try {
      if (!params.receiptNo) return { success: false, error: 'Receipt number is missing.' };
      const [{ data: loan, error: loanErr }, { data: txs, error: txErr }] = await Promise.all([
        supabase.from('finance_loans').select('*').eq('id', params.loanId).single(),
        supabase.from('finance_transactions').select('*').eq('loan_id', params.loanId)
      ]);
      if (loanErr) throw loanErr;
      if (txErr) throw txErr;
      if (!loan) return { success: false, error: 'Loan not found.' };
      if (String(loan.loan_category || '').trim().toUpperCase() !== 'HP') return { success: false, error: 'This is not an HP loan.' };
      const statusUp = String(loan.status || '').trim().toUpperCase();
      if (statusUp !== 'ACTIVE') return { success: false, error: `This loan is ${loan.status}; no more receipts can be taken.` };
      if ((txs || []).some((t: any) => (t.receipt_no || '') === params.receiptNo)) {
        return { success: false, error: `Receipt ${params.receiptNo} is already used on this loan.` };
      }

      const existing = hpPaymentsFromTransactions(txs || []);
      const result = previewHPPayment(loan, existing, { date: params.date, amount: params.amount, kind: params.kind });
      if (!result.ok) return { success: false, error: result.error };
      const split = result.split;
      const kind = result.after.splits[result.after.splits.length - 1].kind;
      const closed = result.after.status === 'Closed';

      const tx = await this.addTransaction({
        loan_id: params.loanId,
        type: 'Collection',
        amount: hpRound(params.amount),
        date: params.date,
        remarks: hpReceiptRemarks(kind, params.receiptNo, split),
        collected_by: params.userName,
        receipt_no: params.receiptNo
      } as any);

      this.logTransactionForReview({
        loanId: params.loanId,
        sourceType: 'Loan Payment',
        sourceId: tx.id,
        receiptNo: params.receiptNo,
        transactionType: kind === 'close' ? 'HP Close' : 'HP Payment',
        transactionDate: params.date,
        amount: hpRound(params.amount),
        penaltyAmount: split.penalty,
        interestAmount: hpRound(split.interest + split.lateInterest),
        principalAmount: split.principal,
        enteredBy: params.userName
      }).catch(err => console.error('Error logging HP receipt for review:', err));

      // Keep the summary columns on the loan in step (lists read them); amount stays the original loan
      const pos = result.after;
      const { error: updErr } = await runLoanWriteWithColumnFallback<any>(
        {
          installments_paid: pos.installmentsPaid,
          balance_without_interest: pos.principalBalance,
          balance_with_interest: hpRound(pos.installments.reduce((a, i) => a + i.balance, 0)),
          status: closed ? 'Closed' : 'Active',
          updated_at: new Date().toISOString()
        },
        row => supabase.from('finance_loans').update(row).eq('id', params.loanId).select().single()
      );
      if (updErr) throw updErr;

      return { success: true, split, closed };
    } catch (e: any) {
      console.error('Error posting HP receipt:', e);
      return { success: false, error: e?.message || String(e) };
    }
  }

  async postTbdLedgerPayment(params: {
    loanId: string;
    customerId: string;
    customerName: string;
    loanIdStr: string;
    userName: string;
    payingInsts: number;
    principalPaid: number;
    commissionPaid: number;
    penaltyPaid: number;
    discount: number;
    waivedPenalty?: number;
    paymentDate: string;
    receiptNo: string;
    isDirectDaysPayment?: boolean;
    waiverReason?: string;
    waivedBy?: string;
    waivedDate?: string;
  }): Promise<{ success: boolean; error?: string }> {
    try {
      const entryDate = params.paymentDate;
      const totalAmount = params.principalPaid + params.commissionPaid + params.penaltyPaid;

      // 1. Post to finance_transactions (Daybook)
      const tx = await this.addTransaction({
        loan_id: params.loanId,
        type: 'Collection',
        amount: totalAmount,
        date: entryDate,
        remarks: params.isDirectDaysPayment 
          ? `TBD Collection - ${params.receiptNo} (Direct Days Payment)`
          : `TBD Collection - ${params.receiptNo} (Days: ${params.payingInsts}, Prin: ${params.principalPaid}, Comm: ${params.commissionPaid}, Pen: ${params.penaltyPaid})`,
        collected_by: params.userName,
        receipt_no: params.receiptNo
      });

      // Log transaction review entry asynchronously
      this.logTransactionForReview({
        loanId: params.loanId,
        sourceType: 'Loan Payment',
        sourceId: tx.id,
        receiptNo: params.receiptNo,
        transactionType: 'TBD Payment',
        transactionDate: entryDate,
        amount: totalAmount,
        penaltyAmount: params.penaltyPaid,
        interestAmount: params.commissionPaid,
        principalAmount: params.principalPaid,
        enteredBy: params.userName
      }).catch(err => console.error('Error logging TBD payment for review:', err));

      if (params.isDirectDaysPayment) {
        // Direct days payment credits TBD A/c directly with full amount
        await this.createCashbookEntry({
          entry_date: entryDate,
          account_number: params.loanIdStr,
          head_of_account: 'TBD A/c',
          particulars: `${params.customerName} - Days Payment ${params.receiptNo}`,
          credit: totalAmount,
          debit: 0,
          created_by: params.userName
        });
      } else {
        // 2. Post splits to finance_cashbook_entries
        await this.createCashbookEntry({
          entry_date: entryDate,
          account_number: params.loanIdStr,
          head_of_account: 'TBD A/c',
          particulars: `${params.customerName} - Installment Payment ${params.receiptNo}`,
          credit: params.principalPaid,
          debit: 0,
          created_by: params.userName
        });

        await this.createCashbookEntry({
          entry_date: entryDate,
          account_number: params.loanIdStr,
          head_of_account: 'COMMISSION A/C',
          particulars: `${params.customerName} - Commission Payment ${params.receiptNo}`,
          credit: params.commissionPaid,
          debit: 0,
          created_by: params.userName
        });

        if (params.penaltyPaid > 0) {
          await this.createCashbookEntry({
            entry_date: entryDate,
            account_number: params.loanIdStr,
            head_of_account: 'Penalty A/c',
            particulars: `${params.customerName} - Penalty Payment ${params.receiptNo}`,
            credit: params.penaltyPaid,
            debit: 0,
            created_by: params.userName
          });
        }
      }

      // 3. Update Loan account metrics
      const { data: loan } = await supabase
        .from('finance_loans')
        .select('*')
        .eq('id', params.loanId)
        .single();

      if (!loan) throw new Error('Loan not found');

      const amount = Number(loan.amount);
      const period = Number(loan.period_days || 100);

      const currentBalanceWithout = Number(loan.balance_without_interest ?? amount);
      const currentOnlyPremiumPaid = amount - currentBalanceWithout;

      const newOnlyPremiumPaid = currentOnlyPremiumPaid + params.principalPaid;
      const newIpaid = newOnlyPremiumPaid / (amount / period);

      const newBalanceWithout = Math.max(0, amount - newOnlyPremiumPaid);
      const newBalanceWith = newBalanceWithout; // TBD has no capitalized interest

      const isClosed = newBalanceWithout <= 2;

      const { error: updateError } = await supabase
        .from('finance_loans')
        .update({
          installments_paid: newIpaid,
          balance_without_interest: isClosed ? 0 : newBalanceWithout,
          balance_with_interest: isClosed ? 0 : newBalanceWith,
          status: isClosed ? 'Closed' : 'Active',
          updated_at: new Date().toISOString()
        })
        .eq('id', params.loanId);

      if (updateError) throw updateError;

      // Log waiver if any discount or penalty is waived
      if (params.discount > 0 || (params.waivedPenalty && params.waivedPenalty > 0)) {
        await this.addWaiverAudit({
          loan_id: params.loanId,
          waived_date: params.waivedDate || params.paymentDate,
          waived_by: params.waivedBy || params.userName,
          waiver_reason: params.waiverReason || 'Payment waiver adjustment',
          waived_interest: 0,
          waived_penalty: params.waivedPenalty || 0,
          waived_commission: params.discount,
          receipt_no: params.receiptNo
        });
      }

      return { success: true };
    } catch (e: any) {
      console.error('Error posting TBD payment:', e);
      return { success: false, error: e?.message || String(e) };
    }
  }

  async getCDLedgerEntries(loanId: string): Promise<FinanceCDLedgerEntry[]> {
    try {
      const [{ data: nativeEntries, error: nativeError }, { data: legacyTransactions, error: legacyError }, { data: loanData }] = await Promise.all([
        supabase.from('finance_cd_ledger_entries').select('*').eq('loan_id', loanId).order('created_at', { ascending: true }),
        supabase.from('finance_transactions').select('*').eq('loan_id', loanId).order('date', { ascending: true }),
        supabase.from('finance_loans').select('*').eq('id', loanId).single()
      ]);

      if (nativeError) throw nativeError;
      if (legacyError) throw legacyError;

      const entries: FinanceCDLedgerEntry[] = nativeEntries || [];
      const legacy: any[] = legacyTransactions || [];

      const existingReceipts = new Set(entries.map(e => e.receipt_no).filter(Boolean));
      const mappedEntries: FinanceCDLedgerEntry[] = [];

      // Check if there's any disbursement transaction. If not, map from loan.
      // Also skip if a native original_loan entry already exists in finance_cd_ledger_entries (new loan flow).
      const hasNativeOriginalLoan = entries.some(e => e.entry_type === 'original_loan');
      const hasDisbursement = legacy.some(tx => tx.type === 'Disbursement');
      if (!hasDisbursement && !hasNativeOriginalLoan && loanData) {
         mappedEntries.push({
            id: `legacy-loan-${loanData.id}`,
            loan_id: loanData.id,
            customer_id: loanData.customer_id,
            account_name: 'CD A/C',
            entry_date: loanData.date,
            credit: 0,
            debit: Number(loanData.amount),
            receipt_no: null,
            particulars: 'Original Loan Disbursement',
            user_name: 'System',
            entry_type: 'original_loan',
            created_at: loanData.created_at || loanData.date
         });
      }

      for (const tx of legacy) {
        const remarks = tx.remarks || '';
        const match = remarks.match(/(REC-\d+|RC\d+)/i);
        const receiptNoFromRemarks = match ? match[0] : null;
        const txReceiptNo = tx.receipt_no || receiptNoFromRemarks;

        if (txReceiptNo && existingReceipts.has(txReceiptNo)) {
          continue;
        }

        if (tx.type === 'Disbursement') {
          // Skip if a native original_loan entry already exists — avoids duplicate disbursement rows
          if (hasNativeOriginalLoan) continue;
          mappedEntries.push({
            id: `legacy-${tx.id}`,
            loan_id: tx.loan_id,
            customer_id: '',
            account_name: 'CD A/C',
            entry_date: tx.date,
            credit: 0,
            debit: Number(tx.amount),
            receipt_no: null,
            particulars: 'Original Loan Disbursement',
            user_name: tx.collected_by || 'System',
            entry_type: 'original_loan',
            created_at: tx.created_at || tx.date
          });
        } else if (tx.type === 'Collection') {
          // If a native entry already matched this amount on this date, assume it's the same and skip
          // Note: a single collection tx might be split into native Penalty + native Interest rows, so sum them per receipt
          const txTime = new Date(tx.date).getTime();
          const exactDateNativeSum = entries
            .filter(e => new Date(e.entry_date).getTime() === txTime)
            .reduce((sum, e) => sum + Number(e.credit || 0), 0);

          const hasExactMatch = entries.some(e => new Date(e.entry_date).getTime() === txTime && Number(e.credit) === Number(tx.amount) && !e.receipt_no) ||
                                (exactDateNativeSum > 0 && Math.abs(exactDateNativeSum - Number(tx.amount)) < 10.00);

          if (!hasExactMatch) {
            mappedEntries.push({
              id: `legacy-${tx.id}`,
              loan_id: tx.loan_id,
              customer_id: '',
              account_name: null,
              entry_date: tx.date,
              credit: Number(tx.amount),
              debit: 0,
              receipt_no: txReceiptNo,
              particulars: tx.remarks || 'Legacy Payment',
              user_name: tx.collected_by || 'System',
              entry_type: 'Legacy Payment',
              created_at: tx.created_at || tx.date
            });
          }
        }
      }

      const finalEntries = [...entries, ...mappedEntries].sort((a, b) => new Date(a.entry_date).getTime() - new Date(b.entry_date).getTime());
      return finalEntries;
    } catch (err) {
      console.error('Error fetching CD ledger entries:', err);
      return [];
    }
  }

  async getCDInterestDetails(loanId: string): Promise<FinanceCDInterestDetail[]> {
    try {
      const { data, error } = await supabase.from('finance_cd_interest_details').select('*').eq('loan_id', loanId).order('created_at', { ascending: true });
      if (error) throw error;
      return data || [];
    } catch (err) {
      console.error('Error fetching CD interest details:', err);
      return [];
    }
  }

  async addNPARecord(payload: Partial<FinanceNPARecord>): Promise<FinanceNPARecord | null> {
    try {
      const { data, error } = await supabase.from('finance_npa_records').insert(payload).select().single();
      if (error) throw error;
      return data;
    } catch (err) {
      console.error('Error adding NPA record:', err);
      return null;
    }
  }

  async addWaiverAudit(payload: Partial<FinanceWaiverAudit>): Promise<FinanceWaiverAudit | null> {
    try {
      const { data, error } = await supabase.from('finance_loan_waiver_audits').insert(payload).select().single();
      if (error) throw error;
      return data;
    } catch (err) {
      console.error('Error adding waiver audit:', err);
      return null;
    }
  }

  async getWaiverAudits(loanId: string): Promise<FinanceWaiverAudit[]> {
    try {
      const { data, error } = await supabase.from('finance_loan_waiver_audits').select('*').eq('loan_id', loanId).order('created_at', { ascending: true });
      if (error) throw error;
      return data || [];
    } catch (err) {
      console.error('Error fetching waiver audits:', err);
      return [];
    }
  }

  async checkNPARecord(aadhaar: string): Promise<FinanceNPARecord | null> {
    try {
      if (!aadhaar) return null;
      const { data, error } = await supabase.from('finance_npa_records').select('*').eq('aadhaar', aadhaar).limit(1).maybeSingle();
      if (error) throw error;
      return data;
    } catch (err) {
      console.error('Error checking NPA record:', err);
      return null;
    }
  }

  async checkNPARecordByCustomer(customerId: string): Promise<FinanceNPARecord | null> {
    try {
      if (!customerId) return null;
      const { data, error } = await supabase.from('finance_npa_records').select('*').eq('customer_id', customerId).limit(1).maybeSingle();
      if (error) throw error;
      return data;
    } catch (err) {
      console.error('Error checking NPA record by customer ID:', err);
      return null;
    }
  }

  async addDocumentReturned(payload: Partial<FinanceDocumentReturned>): Promise<FinanceDocumentReturned | null> {
    try {
      const { data, error } = await supabase.from('finance_documents_returned').insert(payload).select().single();
      if (error) throw error;
      return data;
    } catch (err) {
      console.error('Error adding document returned record:', err);
      return null;
    }
  }

  async getCustomers(): Promise<FinanceCustomer[]> {
    try {
      return await fetchAllPages<FinanceCustomer>((from, to) =>
        supabase
          .from('finance_customers')
          .select('*')
          .order('name')
          .range(from, to)
      );
    } catch (error) {
      console.error('Error fetching finance customers:', error);
      return [];
    }
  }

  async searchCustomers(query: string): Promise<Partial<FinanceCustomer>[]> {
    try {
      if (!query || query.length < 2) return [];

      const { data, error } = await supabase
        .from('finance_customers')
        .select('id, customer_id, name, aadhaar, phone_1, phone_2, phone, father_name, father_husband_name, present_address, address, partner_name')
        .or(`name.ilike.%${query}%,customer_id.eq.${!isNaN(Number(query)) ? Number(query) : 0},phone.ilike.%${query}%,phone_1.ilike.%${query}%,phone_2.ilike.%${query}%,aadhaar.ilike.%${query}%`)
        .limit(10);

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error searching finance customers:', error);
      return [];
    }
  }

  async getCustomerById(id: string): Promise<FinanceCustomer | null> {
    try {
      const { data, error } = await supabase
        .from('finance_customers')
        .select('*')
        .eq('id', id)
        .single();
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error fetching finance customer by id:', error);
      return null;
    }
  }

  async createCustomer(customer: Omit<FinanceCustomer, 'id' | 'created_at' | 'updated_at'>): Promise<FinanceCustomer | null> {
    try {
      const { data, error } = await supabase
        .from('finance_customers')
        .insert([customer])
        .select()
        .single();
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error creating finance customer:', error);
      throw error;
    }
  }

  async updateCustomer(id: string, customer: Partial<FinanceCustomer>, editedBy: string, skipLogging?: boolean): Promise<FinanceCustomer | null> {
    try {
      const { data: oldData } = await supabase
        .from('finance_customers')
        .select('*')
        .eq('id', id)
        .single();

      // Explicit allowlist/DTO for customer updates
      const customerPatch: any = {};
      const allowedFields: Array<keyof FinanceCustomer> = [
        'name', 'phone', 'address', 'aadhaar', 'customer_photo_url',
        'fingerprint_url', 'fingerprint_template', 'fingerprint_added',
        'customer_fingerprint_template', 'customer_fingerprint_image_url',
        'customer_fingerprint_added', 'surety_fingerprint_template',
        'surety_fingerprint_image_url', 'surety_fingerprint_added',
        'father_husband_name', 'father_name', 'village', 'mandal', 'district',
        'aadhaar_address', 'aadhaar_village', 'aadhaar_mandal', 'aadhaar_district',
        'present_address', 'present_village', 'present_mandal', 'present_district',
        'phone_1', 'phone_2', 'phone2', 'partner_name'
      ];

      for (const field of allowedFields) {
        if (customer[field] !== undefined) {
          customerPatch[field] = customer[field];
        }
      }

      const { data, error } = await supabase
        .from('finance_customers')
        .update({ ...customerPatch, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;

      // Sync to finance_fingerprints
      if (customer.customer_fingerprint_template !== undefined) {
        await supabase
          .from('finance_fingerprints')
          .delete()
          .eq('customer_id', id)
          .eq('fingerprint_type', 'Customer');
        if (customer.customer_fingerprint_template) {
          await supabase
            .from('finance_fingerprints')
            .insert([{
              customer_id: id,
              fingerprint_type: 'Customer',
              fingerprint_template: customer.customer_fingerprint_template,
              fingerprint_image_url: customer.customer_fingerprint_image_url
            }]);
        }
      }
      if (customer.surety_fingerprint_template !== undefined) {
        await supabase
          .from('finance_fingerprints')
          .delete()
          .eq('customer_id', id)
          .eq('fingerprint_type', 'Surety');
        if (customer.surety_fingerprint_template) {
          await supabase
            .from('finance_fingerprints')
            .insert([{
              customer_id: id,
              fingerprint_type: 'Surety',
              fingerprint_template: customer.surety_fingerprint_template,
              fingerprint_image_url: customer.surety_fingerprint_image_url
            }]);
        }
      }

      if (oldData && !skipLogging) {
        await this.logEdit('finance_customers', id, oldData, data, editedBy);
      }
      return data;
    } catch (error) {
      console.error('Error updating finance customer:', error);
      return null;
    }
  }

  async deleteCustomer(id: string, deletedBy: string): Promise<boolean> {
    try {
      const { data: oldData } = await supabase
        .from('finance_customers')
        .select('*')
        .eq('id', id)
        .single();

      const { error } = await supabase
        .from('finance_customers')
        .delete()
        .eq('id', id);
      if (error) throw error;

      if (oldData) {
        await this.logDelete('finance_customers', id, oldData, deletedBy);
      }
      return true;
    } catch (error) {
      console.error('Error deleting finance customer:', error);
      return false;
    }
  }

  // --- Loans ---
  async getLoans(): Promise<(FinanceLoan & { customer: FinanceCustomer })[]> {
    try {
      return await fetchAllPages<any>((from, to) =>
        supabase
          .from('finance_loans')
          .select('id, loan_id, amount, date, status, loan_category, interest_rate, duration_months, customer_id, customer:finance_customers!customer_id(id, name, phone, partner_name)')
          .order('created_at', { ascending: false })
          .range(from, to)
      );
    } catch (error) {
      console.error('Error fetching finance loans:', error);
      return [];
    }
  }

  async getRecentLoans(limit: number = 5): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from('finance_loans')
        .select('id, loan_id, loan_category, due_type, amount, created_at, customer:finance_customers!customer_id(name)')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error fetching recent finance loans:', error);
      return [];
    }
  }

  async getCDLoansList(): Promise<any[]> {
    try {
      const data = await fetchAllPages<any>((from, to) =>
        supabase
          .from('finance_loans')
          .select(`
            id, loan_id, amount, date, status, npa_closed, loan_category, interest_rate, penalty_percent, duration_months,
            customer_id, guarantor_1_id, guarantor_2_id,
            customer:finance_customers!customer_id(id, name, phone, partner_name)
          `)
          .order('created_at', { ascending: false })
          .range(from, to)
      );
      if (!data || data.length === 0) return [];

      // Fetch customers to resolve guarantors in-memory to bypass missing DB foreign keys
      const customers = await fetchAllPages<any>((from, to) =>
        supabase
          .from('finance_customers')
          .select('id, name, phone')
          .range(from, to)
      );

      const customerMap = new Map();
      if (customers) {
        customers.forEach((c: any) => customerMap.set(c.id, c));
      }

      return data.map((loan: any) => ({
        ...loan,
        guarantor_1: loan.guarantor_1_id ? customerMap.get(loan.guarantor_1_id) : null,
        guarantor_2: loan.guarantor_2_id ? customerMap.get(loan.guarantor_2_id) : null,
      }));
    } catch (error) {
      console.error('Error fetching CD loans list:', error);
      return [];
    }
  }

  async getLoanById(id: string): Promise<(FinanceLoan & { customer: FinanceCustomer; transactions: FinanceTransaction[]; photos: FinancePhoto[]; dues: FinanceDue[]; documents: FinanceDocument[] }) | null> {
    try {
      const { data: loan, error: loanError } = await supabase
        .from('finance_loans')
        .select(`
          id, loan_id, loan_category, customer_id, amount, date, interest_rate, duration_months, due_type, due_amount,
          status, period_days, grace_days, penalty_percent, document_charges, surety_name, surety_phone, surety_aadhaar,
          surety_present_address, surety_relation, remarks, guarantor_1_id, guarantor_2_id,
          balance_with_interest, balance_without_interest, installments_paid,
          customer:finance_customers!customer_id(id, name, phone, phone2, address, aadhaar, customer_photo_url, father_husband_name, partner_name)
        `)
        .eq('id', id)
        .single();
      if (loanError) throw loanError;
      if (!loan) return null;

      const [txsRes, photosRes, duesRes, docsRes] = await Promise.all([
        supabase
          .from('finance_transactions')
          .select('id, date, amount, type, remarks, collected_by, receipt_no')
          .eq('loan_id', id)
          .order('date', { ascending: true }),
        supabase
          .from('finance_photos')
          .select('id, photo_type, photo_url')
          .eq('loan_id', id),
        supabase
          .from('finance_dues')
          .select('id, due_date, amount, paid_amount, status')
          .eq('loan_id', id)
          .order('due_date', { ascending: true }),
        (async () => {
          try {
            const { data } = await supabase
              .from('finance_documents')
              .select('id, file_name, file_url, created_at')
              .eq('loan_id', id)
              .order('created_at', { ascending: false });
            return data || [];
          } catch (_) {
            return [];
          }
        })()
      ]);

      return {
        ...loan,
        transactions: txsRes.data || [],
        photos: photosRes.data || [],
        dues: duesRes.data || [],
        documents: docsRes
      } as any;
    } catch (error) {
      console.error('Error fetching loan by id:', error);
      return null;
    }
  }

  /**
   * HP loan-date row in finance_transactions: installment 1 principal + document charges kept back.
   * The Day Book reads the split from its remarks (HP principal and HP DOCUMENT CHARGES credits).
   * Rewrites the row if one exists (used when an unpaid HP loan is edited).
   */
  async writeHPOpeningRow(loan: any, staffName: string): Promise<void> {
    const contract = buildHPContract(loan);
    const opening = hpOpening(contract);
    const amount = hpRound(opening.installment1Principal + opening.docCharges);
    const { data: rows } = await supabase
      .from('finance_transactions')
      .select('id, remarks')
      .eq('loan_id', loan.id)
      .eq('type', 'Collection');
    const existing = (rows || []).filter((r: any) => isHPOpeningRow(r));
    for (const r of existing) {
      const { error } = await supabase.from('finance_transactions').delete().eq('id', r.id);
      if (error) throw error;
    }
    if (amount > 0) {
      const { error } = await supabase.from('finance_transactions').insert([{
        loan_id: loan.id,
        date: loan.date,
        amount,
        type: 'Collection',
        collected_by: staffName,
        remarks: hpOpeningRemarks(contract)
      }]);
      if (error) throw error;
    }
  }

  async createLoan(
    loanData: Omit<FinanceLoan, 'id' | 'created_at' | 'updated_at' | 'status'>,
    customerData: { 
      id?: string; 
      name?: string; 
      phone?: string | null; 
      address?: string | null; 
      aadhaar?: string | null;
      customer_photo_url?: string | null;
      fingerprint_url?: string | null;
      fingerprint_template?: string | null;
      fingerprint_added?: boolean;
      customer_fingerprint_template?: string | null;
      customer_fingerprint_image_url?: string | null;
      customer_fingerprint_added?: boolean;
      surety_fingerprint_template?: string | null;
      surety_fingerprint_image_url?: string | null;
      surety_fingerprint_added?: boolean;
      father_husband_name?: string | null;
    },
    duesData: Omit<FinanceDue, 'id' | 'loan_id' | 'paid_amount' | 'status' | 'created_at' | 'updated_at'>[],
    photosData: { photo_type: 'Customer' | 'Surety'; photo_url: string }[],
    documentsData: Omit<FinanceLoanDocument, 'id' | 'loan_id' | 'created_at' | 'updated_at'>[] | undefined,
    staffName: string
  ): Promise<FinanceLoan | null> {
    try {
      let customerId = customerData.id;

      // Create customer if they don't exist
      if (!customerId) {
        const { data: customer, error: customerError } = await supabase
          .from('finance_customers')
          .insert([{
            name: customerData.name || '',
            phone: customerData.phone || '',
            address: customerData.address || '',
            aadhaar: customerData.aadhaar || null,
            customer_photo_url: customerData.customer_photo_url || null,
            fingerprint_url: customerData.fingerprint_url || null,
            fingerprint_template: customerData.fingerprint_template || null,
            fingerprint_added: customerData.fingerprint_added || false,
            customer_fingerprint_template: customerData.customer_fingerprint_template || null,
            customer_fingerprint_image_url: customerData.customer_fingerprint_image_url || null,
            customer_fingerprint_added: customerData.customer_fingerprint_added || false,
            surety_fingerprint_template: customerData.surety_fingerprint_template || null,
            surety_fingerprint_image_url: customerData.surety_fingerprint_image_url || null,
            surety_fingerprint_added: customerData.surety_fingerprint_added || false,
            father_husband_name: customerData.father_husband_name || null
          }])
          .select()
          .single();

        if (customerError) throw customerError;
        customerId = customer.id;
      } else {
        // If existing customer, update customer's photo/fingerprint if provided
        if (
          customerData.customer_photo_url || 
          customerData.fingerprint_url || 
          customerData.customer_fingerprint_template || 
          customerData.surety_fingerprint_template ||
          customerData.father_husband_name
        ) {
          const updatePayload: Partial<FinanceCustomer> = {};
          if (customerData.customer_photo_url) updatePayload.customer_photo_url = customerData.customer_photo_url;
          if (customerData.father_husband_name) updatePayload.father_husband_name = customerData.father_husband_name;
          if (customerData.fingerprint_url) {
            updatePayload.fingerprint_url = customerData.fingerprint_url;
            updatePayload.fingerprint_template = customerData.fingerprint_template;
            updatePayload.fingerprint_added = customerData.fingerprint_added;
          }
          if (customerData.customer_fingerprint_template) {
            updatePayload.customer_fingerprint_template = customerData.customer_fingerprint_template;
            updatePayload.customer_fingerprint_image_url = customerData.customer_fingerprint_image_url;
            updatePayload.customer_fingerprint_added = customerData.customer_fingerprint_added;
          }
          if (customerData.surety_fingerprint_template) {
            updatePayload.surety_fingerprint_template = customerData.surety_fingerprint_template;
            updatePayload.surety_fingerprint_image_url = customerData.surety_fingerprint_image_url;
            updatePayload.surety_fingerprint_added = customerData.surety_fingerprint_added;
          }
          await this.updateCustomer(customerId, updatePayload, staffName);
        }
      }

      // Create loan record
      const safeLoanData = { ...loanData };
      delete (safeLoanData as any).customer_fingerprint_template;
      delete (safeLoanData as any).customer_fingerprint_image_url;
      delete (safeLoanData as any).customer_fingerprint_added;
      delete (safeLoanData as any).surety_fingerprint_template;
      delete (safeLoanData as any).surety_fingerprint_image_url;
      delete (safeLoanData as any).surety_fingerprint_added;

      const loanInsertRow: Record<string, any> = {
          ...safeLoanData,
          customer_id: customerId,
          status: 'Active',
          customer_photo_url: loanData.customer_photo_url || customerData.customer_photo_url || null,
          surety_photo_url: loanData.surety_photo_url || null,
          fingerprint_url: loanData.fingerprint_url || customerData.fingerprint_url || null,
          fingerprint_template: loanData.fingerprint_template || customerData.fingerprint_template || null,
          fingerprint_added: loanData.fingerprint_added || customerData.fingerprint_added || false,
          father_husband_name: loanData.father_husband_name || customerData.father_husband_name || null,
          loan_category: loanData.loan_category || 'Regular'
        };
      const { data: loan, error: loanError } = await runLoanWriteWithColumnFallback<any>(
        loanInsertRow,
        row => supabase.from('finance_loans').insert([row]).select().single()
      );

      if (loanError) throw loanError;
      if (!loan) throw new Error('Loan was not saved');
      const savedCategory = String(loan.loan_category || loanInsertRow.loan_category || '').trim().toUpperCase();

      // Create disbursement transaction
      const { error: txError } = await supabase
        .from('finance_transactions')
        .insert([{
          loan_id: loan.id,
          date: loan.date,
          amount: loan.amount,
          type: 'Disbursement',
          collected_by: staffName,
          remarks: 'Loan disbursed'
        }]);

      if (txError) throw txError;

      // HP: installment 1 principal and the document charges are kept back on the loan date
      if (savedCategory === 'HP') {
        await this.writeHPOpeningRow(loan, staffName);
      }

      // --- Write immutable CD ledger opening rows ---
      // These rows are fixed at disbursement time and must NEVER be updated or recalculated.
      // Never for an HP loan: these rows would show it in the Day Book as a CD loan, take one
      // month of CD interest at disbursement and count the disbursement twice (here and in
      // finance_transactions above). HP keeps its own records in finance_transactions.
      if (savedCategory !== 'HP') {
        // 1. Original Loan Disbursement (debit row)
        await supabase.from('finance_cd_ledger_entries').insert([{
          loan_id: loan.id,
          customer_id: customerId,
          account_name: 'CD A/C',
          entry_date: loan.date,
          credit: 0,
          debit: Number(loan.amount),
          receipt_no: '-',
          particulars: 'Original Loan Disbursement',
          user_name: staffName,
          entry_type: 'original_loan'
        }]);

        // 2. Opening CD Commission (fixed at disbursement; never recalculated)
        const _commRate = Number(loan.interest_rate) || 3;
        const pDays = (loan.period_days && Number(loan.period_days) > 0) ? Number(loan.period_days) : 30;
        const _commAmount = Number(((Number(loan.amount) * (_commRate / 100) * pDays) / 30).toFixed(2));
        if (_commAmount > 0) {
          await supabase.from('finance_cd_ledger_entries').insert([{
            loan_id: loan.id,
            customer_id: customerId,
            account_name: 'CD COMMISSION A/C',
            entry_date: loan.date,
            credit: _commAmount,
            debit: 0,
            receipt_no: '-',
            particulars: 'Opening CD Commission Charged',
            user_name: staffName,
            entry_type: 'opening_commission'
          }]);
        }

        // 3. Document Charges (fixed at disbursement; never recalculated)
        const _docCharges = Number(loan.document_charges) || 0;
        if (_docCharges > 0) {
          await supabase.from('finance_cd_ledger_entries').insert([{
            loan_id: loan.id,
            customer_id: customerId,
            account_name: 'CD DOCUMENT CHARGES A/C',
            entry_date: loan.date,
            credit: _docCharges,
            debit: 0,
            receipt_no: '-',
            particulars: 'Document Charges Collected',
            user_name: staffName,
            entry_type: 'document_charge'
          }]);
        }
      }
      // --- End of opening rows ---

      // Create dues schedule
      if (duesData && duesData.length > 0) {
        const formattedDues = duesData.map(due => ({
          loan_id: loan.id,
          due_date: due.due_date,
          amount: due.amount,
          paid_amount: 0,
          status: 'Pending'
        }));

        const { error: duesError } = await supabase
          .from('finance_dues')
          .insert(formattedDues);

        if (duesError) throw duesError;
      }

      // Save photos
      if (photosData && photosData.length > 0) {
        const formattedPhotos = photosData.map(photo => ({
          loan_id: loan.id,
          photo_type: photo.photo_type,
          photo_url: photo.photo_url
        }));

        const { error: photosError } = await supabase
          .from('finance_photos')
          .insert(formattedPhotos);

        if (photosError) throw photosError;
      }

      // Save documents
      if (documentsData && documentsData.length > 0) {
        const formattedDocs = documentsData.map(doc => ({
          ...doc,
          loan_id: loan.id
        }));

        const { error: docsError } = await supabase
          .from('finance_loan_documents')
          .insert(formattedDocs);

        if (docsError) throw docsError;
      }

      // Save fingerprints to finance_fingerprints table
      if (loanData.customer_fingerprint_template || customerData.customer_fingerprint_template) {
        await supabase
          .from('finance_fingerprints')
          .insert([{
            customer_id: customerId,
            loan_id: loan.id,
            fingerprint_type: 'Customer',
            fingerprint_template: loanData.customer_fingerprint_template || customerData.customer_fingerprint_template,
            fingerprint_image_url: loanData.customer_fingerprint_image_url || customerData.customer_fingerprint_image_url
          }]);
      }
      if (loanData.surety_fingerprint_template || customerData.surety_fingerprint_template) {
        await supabase
          .from('finance_fingerprints')
          .insert([{
            customer_id: customerId,
            loan_id: loan.id,
            fingerprint_type: 'Surety',
            fingerprint_template: loanData.surety_fingerprint_template || customerData.surety_fingerprint_template,
            fingerprint_image_url: loanData.surety_fingerprint_image_url || customerData.surety_fingerprint_image_url
          }]);
      }

      return loan;
    } catch (error) {
      console.error('Error creating finance loan:', error);
      throw error;
    }
  }

  async updateLoan(id: string, loan: Partial<FinanceLoan>, editedBy: string, skipLogging?: boolean): Promise<FinanceLoan | null> {
    try {
      const { data: oldData } = await supabase
        .from('finance_loans')
        .select('*')
        .eq('id', id)
        .single();

      if (!oldData) throw new Error('Loan not found');

      // ── CORRECT SERVER-SIDE LOCK DETECTION ───────────────────────────────
      // Lock protected fields ONLY when genuine customer repayment activity
      // exists. System-generated opening entries (original_loan,
      // opening_commission, document_charge) must NOT trigger the lock.

      // 1. Detect genuine transaction/ledger activity
      const [{ count: cdNonOpeningCount }, { count: txNonDisbCount }, { count: cdInterestCount }, { count: duesPaidCount }] = await Promise.all([
        supabase
          .from('finance_cd_ledger_entries')
          .select('*', { count: 'exact', head: true })
          .eq('loan_id', id)
          .not('entry_type', 'in', '(original_loan,opening_commission,document_charge)'),
        supabase
          .from('finance_transactions')
          .select('*', { count: 'exact', head: true })
          .eq('loan_id', id)
          .neq('type', 'Disbursement'),
        supabase
          .from('finance_cd_interest_details')
          .select('*', { count: 'exact', head: true })
          .eq('loan_id', id),
        supabase
          .from('finance_dues')
          .select('*', { count: 'exact', head: true })
          .eq('loan_id', id)
          .gt('paid_amount', 0)
      ]);

      // An HP loan's opening row (installment 1 kept at disbursement) is not a repayment
      let txRepaymentCount = txNonDisbCount || 0;
      if (txRepaymentCount > 0 && String(oldData.loan_category || '').trim().toUpperCase() === 'HP') {
        const { count: hpOpeningCount } = await supabase
          .from('finance_transactions')
          .select('*', { count: 'exact', head: true })
          .eq('loan_id', id)
          .like('remarks', `${HP_OPENING_PREFIX}%`);
        txRepaymentCount = Math.max(0, txRepaymentCount - (hpOpeningCount || 0));
      }

      const hasCustomerRepaymentActivity =
        (cdNonOpeningCount || 0) > 0 ||
        txRepaymentCount > 0 ||
        (cdInterestCount || 0) > 0 ||
        (duesPaidCount || 0) > 0;

      if (hasCustomerRepaymentActivity) {
        // Compare protected fields — throw only if the caller is trying to change them
        if (loan.date !== undefined && loan.date !== oldData.date) {
          throw new Error(`CD_CONTRACT_FIELD_IMMUTABLE: Core loan fields cannot be edited because customer repayment activity already exists for ${oldData.loan_id}.`);
        }
        if (loan.amount !== undefined && Number(loan.amount) !== Number(oldData.amount)) {
          throw new Error(`CD_CONTRACT_FIELD_IMMUTABLE: Core loan fields cannot be edited because customer repayment activity already exists for ${oldData.loan_id}.`);
        }
        if (loan.interest_rate !== undefined && Number(loan.interest_rate) !== Number(oldData.interest_rate)) {
          throw new Error(`CD_CONTRACT_FIELD_IMMUTABLE: Core loan fields cannot be edited because customer repayment activity already exists for ${oldData.loan_id}.`);
        }
        const oldPenaltyPercent = oldData.penalty_percent !== null && oldData.penalty_percent !== undefined ? oldData.penalty_percent : 0.75;
        const newPenaltyPercent = loan.penalty_percent !== undefined ? loan.penalty_percent : (loan as any).penalty_rate;
        if (newPenaltyPercent !== undefined && Number(newPenaltyPercent) !== Number(oldPenaltyPercent)) {
          throw new Error(`CD_CONTRACT_FIELD_IMMUTABLE: Core loan fields cannot be edited because customer repayment activity already exists for ${oldData.loan_id}.`);
        }
        if (loan.period_days !== undefined && loan.period_days !== oldData.period_days) {
          throw new Error(`CD_CONTRACT_FIELD_IMMUTABLE: Core loan fields cannot be edited because customer repayment activity already exists for ${oldData.loan_id}.`);
        }
        if (loan.duration_months !== undefined && Number(loan.duration_months) !== Number(oldData.duration_months)) {
          throw new Error(`CD_CONTRACT_FIELD_IMMUTABLE: Core loan fields cannot be edited because customer repayment activity already exists for ${oldData.loan_id}.`);
        }
        if (loan.document_charges !== undefined && Number(loan.document_charges) !== Number(oldData.document_charges || 0)) {
          throw new Error(`CD_CONTRACT_FIELD_IMMUTABLE: Core loan fields cannot be edited because customer repayment activity already exists for ${oldData.loan_id}.`);
        }
        if (loan.partner_id !== undefined && (loan.partner_id || null) !== (oldData.partner_id || null)) {
          throw new Error(`CD_CONTRACT_FIELD_IMMUTABLE: Core loan fields cannot be edited because customer repayment activity already exists for ${oldData.loan_id}.`);
        }
        if (loan.guarantor_1_id !== undefined && (loan.guarantor_1_id || null) !== (oldData.guarantor_1_id || null)) {
          throw new Error(`CD_CONTRACT_FIELD_IMMUTABLE: Core loan fields cannot be edited because customer repayment activity already exists for ${oldData.loan_id}.`);
        }
        if (loan.guarantor_2_id !== undefined && (loan.guarantor_2_id || null) !== (oldData.guarantor_2_id || null)) {
          throw new Error(`CD_CONTRACT_FIELD_IMMUTABLE: Core loan fields cannot be edited because customer repayment activity already exists for ${oldData.loan_id}.`);
        }
        if (loan.loan_category !== undefined && loan.loan_category !== oldData.loan_category) {
          throw new Error(`CD_CONTRACT_FIELD_IMMUTABLE: Core loan fields cannot be edited because customer repayment activity already exists for ${oldData.loan_id}.`);
        }
      }

      // Explicit allowlist/DTO for loan updates
      const loanPatch: any = {};
      const allowedFields: Array<keyof FinanceLoan> = [
        'surety_name', 'surety_phone', 'surety_aadhaar', 'remarks',
        'surety_present_address', 'surety_relation', 'status',
        'customer_photo_url', 'surety_photo_url', 'fingerprint_url',
        'fingerprint_template', 'fingerprint_added', 'customer_fingerprint_template',
        'customer_fingerprint_image_url', 'customer_fingerprint_added',
        'surety_fingerprint_template', 'surety_fingerprint_image_url',
        'surety_fingerprint_added', 'guarantor_1_id', 'guarantor_2_id',
        'grace_days', 'document_charges', 'npa_closed', 'dc_status',
        'partner_id', 'partner_name',
        // Fields allowed only if protected criteria passes
        'date', 'amount', 'interest_rate', 'duration_months', 'due_type',
        'due_amount', 'penalty_percent', 'period_days', 'loan_category'
      ];

      for (const field of allowedFields) {
        if (loan[field] !== undefined) {
          loanPatch[field] = loan[field];
        }
      }

      const { data, error } = await runLoanWriteWithColumnFallback<any>(
        { ...loanPatch, updated_at: new Date().toISOString() },
        row => supabase.from('finance_loans').update(row).eq('id', id).select().single()
      );
      if (error) throw error;

      // Sync to finance_fingerprints
      if (loan.customer_fingerprint_template !== undefined) {
        await supabase
          .from('finance_fingerprints')
          .delete()
          .eq('loan_id', id)
          .eq('fingerprint_type', 'Customer');
        if (loan.customer_fingerprint_template) {
          await supabase
            .from('finance_fingerprints')
            .insert([{
              customer_id: oldData?.customer_id,
              loan_id: id,
              fingerprint_type: 'Customer',
              fingerprint_template: loan.customer_fingerprint_template,
              fingerprint_image_url: loan.customer_fingerprint_image_url
            }]);
        }
      }
      if (loan.surety_fingerprint_template !== undefined) {
        await supabase
          .from('finance_fingerprints')
          .delete()
          .eq('loan_id', id)
          .eq('fingerprint_type', 'Surety');
        if (loan.surety_fingerprint_template) {
          await supabase
            .from('finance_fingerprints')
            .insert([{
              customer_id: oldData?.customer_id,
              loan_id: id,
              fingerprint_type: 'Surety',
              fingerprint_template: loan.surety_fingerprint_template,
              fingerprint_image_url: loan.surety_fingerprint_image_url
            }]);
        }
      }

      // Determine if there has been any financial activity on this loan.
      const [{ data: dbEntries }] = await Promise.all([
        supabase.from('finance_cd_ledger_entries').select('id, entry_type').eq('loan_id', id),
        supabase.from('finance_transactions').select('id, type').eq('loan_id', id),
        supabase.from('finance_cd_interest_details').select('id').eq('loan_id', id)
      ]);

      // 1. Sync Disbursement transaction in finance_transactions
      await supabase
        .from('finance_transactions')
        .update({
          amount: Number(data.amount),
          date: data.date
        })
        .eq('loan_id', id)
        .eq('type', 'Disbursement');

      // 1b. HP: rewrite the loan-date row (installment 1 + document charges) while nothing is paid yet
      if (String(data.loan_category || '').trim().toUpperCase() === 'HP' && !hasCustomerRepaymentActivity) {
        await this.writeHPOpeningRow(data, editedBy);
      }

      // 2. Sync native finance_cd_ledger_entries (for CD loans)
      if (data.loan_category === 'CD') {
        const commRate = Number(data.interest_rate) || 3;
        const pDays = (data.period_days && Number(data.period_days) > 0) ? Number(data.period_days) : 30;
        const commAmount = Number(((Number(data.amount) * (commRate / 100) * pDays) / 30).toFixed(2));
        const docCharges = Number(data.document_charges) || 0;

        const existingEntries = dbEntries || [];

        // original_loan entry
        const origEntry = existingEntries.find((e: any) => e.entry_type === 'original_loan');
        if (origEntry) {
          await supabase
            .from('finance_cd_ledger_entries')
            .update({
              debit: Number(data.amount),
              date: data.date,
              entry_date: data.date
            })
            .eq('id', origEntry.id);
        } else {
          await supabase.from('finance_cd_ledger_entries').insert([{
            loan_id: id,
            customer_id: data.customer_id,
            account_name: 'CD A/C',
            date: data.date,
            entry_date: data.date,
            credit: 0,
            debit: Number(data.amount),
            receipt_no: '-',
            particulars: 'Original Loan Disbursement',
            user_name: editedBy,
            entry_type: 'original_loan',
            total_paid: 0,
            book_id: data.book_id
          }]);
        }

        // opening_commission entry
        const commEntry = existingEntries.find((e: any) => 
          e.entry_type === 'opening_commission' || 
          e.entry_type === 'Commission'
        );
        if (commEntry) {
          if (commAmount > 0) {
            await supabase
              .from('finance_cd_ledger_entries')
              .update({
                credit: commAmount,
                date: data.date,
                entry_date: data.date
              })
              .eq('id', commEntry.id);
          } else {
            await supabase
              .from('finance_cd_ledger_entries')
              .delete()
              .eq('id', commEntry.id);
          }
        } else if (commAmount > 0) {
          await supabase.from('finance_cd_ledger_entries').insert([{
            loan_id: id,
            customer_id: data.customer_id,
            account_name: 'CD COMMISSION A/C',
            date: data.date,
            entry_date: data.date,
            credit: commAmount,
            debit: 0,
            receipt_no: '-',
            particulars: 'Opening CD Commission Charged',
            user_name: editedBy,
            entry_type: 'opening_commission',
            total_paid: 0,
            book_id: data.book_id
          }]);
        }

        // document_charge entry
        const docEntry = existingEntries.find((e: any) => 
          e.entry_type === 'document_charge' || 
          (e.account_name || '').toLowerCase() === 'cd document charges a/c'
        );
        if (docEntry) {
          if (docCharges > 0) {
            await supabase
              .from('finance_cd_ledger_entries')
              .update({
                credit: docCharges,
                date: data.date,
                entry_date: data.date
              })
              .eq('id', docEntry.id);
          } else {
            await supabase
              .from('finance_cd_ledger_entries')
              .delete()
              .eq('id', docEntry.id);
          }
        } else if (docCharges > 0) {
          await supabase.from('finance_cd_ledger_entries').insert([{
            loan_id: id,
            customer_id: data.customer_id,
            account_name: 'CD DOCUMENT CHARGES A/C',
            date: data.date,
            entry_date: data.date,
            credit: docCharges,
            debit: 0,
            receipt_no: '-',
            particulars: 'Document Charges Collected',
            user_name: editedBy,
            entry_type: 'document_charge',
            total_paid: 0,
            book_id: data.book_id
          }]);
        }
      }

      // 3. Delete and regenerate dues schedule in finance_dues
      await supabase
        .from('finance_dues')
        .delete()
        .eq('loan_id', id);

      let duesCount = 0;
      let dueAmount = 0;
      const isHPLoan = String(data.loan_category || '').trim().toUpperCase() === 'HP';

      if (isHPLoan) {
        // HP has no dues rows: its installments are worked out from the loan terms (hpLedgerEngine)
        duesCount = 0;
      } else if (data.loan_category === 'CD') {
        duesCount = data.period_days || data.duration_months || 30;
        dueAmount = 0;
      } else {
        if (data.due_type === 'Daily') {
          duesCount = data.duration_months * 30;
        } else if (data.due_type === 'Weekly') {
          duesCount = Math.round(data.duration_months * 4.33);
        } else {
          duesCount = data.duration_months;
        }
        dueAmount = data.due_amount;
      }

      const duesList = [];
      for (let i = 0; i < duesCount; i++) {
        let dDateStr = '';
        if (data.loan_category === 'CD' || data.due_type === 'Daily') {
          // CD inclusive-cycle: Day 1 = loanDate (i=0), Day N = loanDate + (N-1) (i=N-1)
          dDateStr = financeCalculationService.addCalendarDays(data.date, i);
        } else if (data.due_type === 'Weekly') {
          dDateStr = financeCalculationService.addCalendarDays(data.date, i * 7);
        } else {
          // Monthly timezone-independent
          const { year, month, day } = financeCalculationService.parseDateParts(data.date);
          const dDate = new Date(Date.UTC(year, month - 1 + i, day));
          const y = dDate.getUTCFullYear();
          const m = String(dDate.getUTCMonth() + 1).padStart(2, '0');
          const dd = String(dDate.getUTCDate()).padStart(2, '0');
          dDateStr = `${y}-${m}-${dd}`;
        }
        duesList.push({
          loan_id: id,
          due_date: dDateStr,
          amount: dueAmount,
          paid_amount: 0,
          status: 'Pending',
          book_id: data.book_id
        });
      }

      if (duesList.length > 0) {
        const { error: insertDuesError } = await supabase
          .from('finance_dues')
          .insert(duesList);
        if (insertDuesError) throw insertDuesError;
      }

      // Reallocate dues sequentially for non-CD loans (HP has none)
      if (data.loan_category !== 'CD' && !isHPLoan) {
        await this.recalculateDuesForLoan(id);
      }

      // 4. Sync finance_npa_records if exists
      const { data: npaRecord } = await supabase
        .from('finance_npa_records')
        .select('*')
        .eq('loan_id', id)
        .maybeSingle();

      if (npaRecord) {
        const newLiability = Number(data.amount) + Number(npaRecord.interest_due || 0) + Number(npaRecord.penalty_due || 0);
        await supabase
          .from('finance_npa_records')
          .update({
            loan_amount: Number(data.amount),
            balance_amount: Number(data.amount),
            total_liability: newLiability,
            waived_amount: Math.max(0, newLiability - Number(npaRecord.settlement_amount || 0))
          })
          .eq('id', npaRecord.id);
      }

      if (oldData && !skipLogging) {
        await this.logEdit('finance_loans', id, oldData, data, editedBy);
      }
      return data;
    } catch (error: any) {
      console.error('Error updating finance loan:', error);
      if (error?.message && error.message.includes('CD_CONTRACT_FIELD_IMMUTABLE')) {
        throw error;
      }
      return null;
    }
  }

  async deleteLoan(id: string, deletedBy: string): Promise<boolean> {
    try {
      const { data: oldData } = await supabase
        .from('finance_loans')
        .select('*')
        .eq('id', id)
        .single();

      const { error } = await supabase
        .from('finance_loans')
        .delete()
        .eq('id', id);
      if (error) throw error;

      if (oldData) {
        await this.logDelete('finance_loans', id, oldData, deletedBy);
      }
      return true;
    } catch (error) {
      console.error('Error deleting finance loan:', error);
      return false;
    }
  }

  // --- Transactions (Collections & Disbursements) ---
  async getTransactions(filters?: { startDate?: string; endDate?: string }): Promise<(FinanceTransaction & { loan: FinanceLoan & { customer: FinanceCustomer } })[]> {
    try {
      let query = supabase
        .from('finance_transactions')
        .select(`
          id, date, amount, type, remarks, collected_by, receipt_no, loan_id,
          loan:finance_loans(
            id, loan_id, loan_category, amount, customer_id,
            customer:finance_customers!customer_id(id, name, phone)
          )
        `)
        .order('date', { ascending: false })
        .order('created_at', { ascending: false });

      if (filters?.startDate) {
        query = query.gte('date', filters.startDate);
      }
      if (filters?.endDate) {
        query = query.lte('date', filters.endDate);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data as any) || [];
    } catch (error) {
      console.error('Error fetching finance transactions:', error);
      return [];
    }
  }

  async createTransaction(transaction: Omit<FinanceTransaction, 'id' | 'created_at' | 'updated_at'>, _editedBy: string): Promise<FinanceTransaction | null> {
    try {
      const { data, error } = await supabase
        .from('finance_transactions')
        .insert([transaction])
        .select()
        .single();
      if (error) throw error;

      // Recalculate dues schedule correctly allocated
      if (transaction.type === 'Collection') {
        await this.recalculateDuesForLoan(transaction.loan_id);
      }

      return data;
    } catch (error) {
      console.error('Error creating finance transaction:', error);
      return null;
    }
  }

  async deleteTransaction(id: string, deletedBy: string): Promise<boolean> {
    try {
      const { data: oldData } = await supabase
        .from('finance_transactions')
        .select('*')
        .eq('id', id)
        .single();

      if (!oldData) return false;

      const { error } = await supabase
        .from('finance_transactions')
        .delete()
        .eq('id', id);
      if (error) throw error;

      await this.logDelete('finance_transactions', id, oldData, deletedBy);

      // Log transaction review for deletion
      await this.logTransactionForReview({
        loanId: oldData.loan_id,
        sourceType: 'Loan Payment',
        sourceId: id,
        receiptNo: oldData.receipt_no,
        transactionType: (oldData.type || 'Collection') + ' Deletion',
        transactionDate: oldData.date,
        amount: Number(oldData.amount),
        enteredBy: deletedBy,
        actionType: 'DELETE'
      }).catch(err => console.error('Failed to log delete review:', err));

      // Recalculate dues allocation if deleting a collection
      if (oldData.type === 'Collection') {
        await this.recalculateDuesForLoan(oldData.loan_id);
      }

      return true;
    } catch (error) {
      console.error('Error deleting finance transaction:', error);
      return false;
    }
  }

  async logCDTransactionEdit(params: {
    loanId: string;
    transactionId: string;
    oldData: any;
    newData: any;
    editedBy: string;
    reason: string;
  }): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('finance_cd_transaction_edit_logs')
        .insert({
          loan_id: params.loanId,
          transaction_id: params.transactionId,
          old_data: params.oldData,
          new_data: params.newData,
          edited_by: params.editedBy,
          reason: params.reason
        });

      if (error) throw error;
      return true;
    } catch (err) {
      console.error('Error logging CD transaction edit:', err);
      return false;
    }
  }

  // Helper method: Reset and recalculate dues payments sequentially for a loan
  async recalculateDuesForLoan(loanId: string): Promise<void> {
    try {
      // 1. Get all Collections transactions for the loan
      const { data: collections, error: collectionsError } = await supabase
        .from('finance_transactions')
        .select('amount')
        .eq('loan_id', loanId)
        .eq('type', 'Collection')
        .order('date', { ascending: true })
        .order('created_at', { ascending: true });

      if (collectionsError) throw collectionsError;

      // Sum of all collections
      let totalCollected = (collections || []).reduce((sum, tx) => sum + Number(tx.amount), 0);

      // 2. Get all dues for this loan
      const { data: dues, error: duesError } = await supabase
        .from('finance_dues')
        .select('*')
        .eq('loan_id', loanId)
        .order('due_date', { ascending: true });

      if (duesError) throw duesError;
      if (!dues || dues.length === 0) return;

      // 3. Sequentially allocate the totalCollected amount
      const updatedDues = dues.map(due => {
        const dueAmount = Number(due.amount);
        let paidAmount = 0;
        let status: 'Pending' | 'Paid' | 'Partially Paid' = 'Pending';

        if (totalCollected >= dueAmount) {
          paidAmount = dueAmount;
          status = 'Paid';
          totalCollected -= dueAmount;
        } else if (totalCollected > 0) {
          paidAmount = totalCollected;
          status = 'Partially Paid';
          totalCollected = 0;
        }

        return {
          id: due.id,
          paid_amount: paidAmount,
          status: status,
          updated_at: new Date().toISOString()
        };
      });

      // 4. Update each due record in Supabase via bulk RPC
      const { error: updateError } = await supabase
        .schema('finance')
        .rpc('bulk_update_dues', {
          dues_data: updatedDues
        });
      if (updateError) throw updateError;

      console.log(`✅ Recalculated dues for loan ${loanId}. Remaining collections: ${totalCollected}`);
    } catch (error) {
      console.error('Error recalculating dues for loan:', error);
    }
  }

  // --- Capital Entries ---
  async getCapitalEntries(): Promise<(FinanceCapitalEntry & { partner: FinancePartner })[]> {
    try {
      const { data, error } = await supabase
        .from('finance_capital_entries')
        .select('*, partner:finance_partners(*)')
        .order('entry_date', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error fetching finance capital entries:', error);
      return [];
    }
  }

  async createCapitalEntry(entry: Omit<FinanceCapitalEntry, 'id' | 'created_at' | 'updated_at'>): Promise<FinanceCapitalEntry | null> {
    try {
      const creditAmt = Number(entry.credit) || 0;
      const debitAmt = Number(entry.debit) || 0;
      const amount = creditAmt > 0 ? creditAmt : debitAmt;
      const type = creditAmt > 0 ? 'Credit' : 'Debit';
      const fullPayload = {
        ...entry,
        amount,
        type
      };
      const { data, error } = await supabase
        .from('finance_capital_entries')
        .insert([fullPayload])
        .select()
        .single();
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error creating finance capital entry:', error);
      return null;
    }
  }

  async createCapitalEntries(entries: Omit<FinanceCapitalEntry, 'id' | 'created_at' | 'updated_at'>[]): Promise<FinanceCapitalEntry[] | null> {
    try {
      const processed = entries.map(entry => {
        const creditAmt = Number(entry.credit) || 0;
        const debitAmt = Number(entry.debit) || 0;
        const amount = creditAmt > 0 ? creditAmt : debitAmt;
        const type = creditAmt > 0 ? 'Credit' : 'Debit';
        return {
          ...entry,
          amount,
          type
        };
      });
      const { data, error } = await supabase
        .from('finance_capital_entries')
        .insert(processed)
        .select();
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error creating bulk finance capital entries:', error);
      return null;
    }
  }

  async updateCapitalEntry(
    id: string,
    entry: Partial<Omit<FinanceCapitalEntry, 'id' | 'created_at' | 'updated_at'>>,
    updatedBy: string
  ): Promise<FinanceCapitalEntry | null> {
    try {
      const { data: oldData } = await supabase
        .from('finance_capital_entries')
        .select('*')
        .eq('id', id)
        .single();

      let amount = entry.amount;
      let type = entry.type;

      if (entry.credit !== undefined || entry.debit !== undefined) {
        const creditAmt = Number(entry.credit !== undefined ? entry.credit : (oldData?.credit || 0)) || 0;
        const debitAmt = Number(entry.debit !== undefined ? entry.debit : (oldData?.debit || 0)) || 0;
        amount = creditAmt > 0 ? creditAmt : debitAmt;
        type = creditAmt > 0 ? 'Credit' : 'Debit';
      }

      const fullPayload = {
        ...entry,
        ...(amount !== undefined ? { amount } : {}),
        ...(type !== undefined ? { type } : {})
      };

      const { data, error } = await supabase
        .from('finance_capital_entries')
        .update(fullPayload)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;

      if (oldData && data) {
        await this.logEdit('finance_capital_entries', id, oldData, data, updatedBy);
      }
      return data;
    } catch (error) {
      console.error('Error updating finance capital entry:', error);
      return null;
    }
  }

  async deleteCapitalEntry(id: string, deletedBy: string): Promise<boolean> {
    try {
      const { data: oldData } = await supabase
        .from('finance_capital_entries')
        .select('*')
        .eq('id', id)
        .single();

      const { error } = await supabase
        .from('finance_capital_entries')
        .delete()
        .eq('id', id);
      if (error) throw error;

      if (oldData) {
        await this.logDelete('finance_capital_entries', id, oldData, deletedBy);
      }
      return true;
    } catch (error) {
      console.error('Error deleting finance capital entry:', error);
      return false;
    }
  }

  // --- Photos ---
  async addPhoto(photo: Omit<FinancePhoto, 'id' | 'created_at'>): Promise<FinancePhoto | null> {
    try {
      const { data, error } = await supabase
        .from('finance_photos')
        .insert([photo])
        .select()
        .single();
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error adding photo:', error);
      return null;
    }
  }

  // --- Documents ---
  async getLoanDocuments(loanId: string): Promise<FinanceLoanDocument[]> {
    try {
      const { data, error } = await supabase
        .from('finance_loan_documents')
        .select('*')
        .eq('loan_id', loanId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error fetching finance loan documents:', error);
      return [];
    }
  }

  async getDocuments(loanId: string): Promise<FinanceDocument[]> {
    try {
      const { data, error } = await supabase
        .from('finance_documents')
        .select('*')
        .eq('loan_id', loanId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error fetching finance documents:', error);
      return [];
    }
  }

  async addDocument(doc: Omit<FinanceDocument, 'id' | 'created_at'>): Promise<FinanceDocument | null> {
    try {
      const { data, error } = await supabase
        .from('finance_documents')
        .insert([doc])
        .select()
        .single();
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error adding finance document:', error);
      return null;
    }
  }

  async addLoanDocument(doc: {
    loan_id: string;
    category: string;
    document_name: string;
    remarks?: string | null;
    file_url: string | null;
    is_submitted?: boolean;
  }): Promise<any> {
    try {
      const { data, error } = await supabase
        .from('finance_loan_documents')
        .insert([{
          loan_id: doc.loan_id,
          category: doc.category,
          document_name: doc.document_name,
          remarks: doc.remarks || null,
          file_url: doc.file_url,
          is_submitted: doc.is_submitted ?? true
        }])
        .select()
        .single();
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error adding finance loan document:', error);
      return null;
    }
  }

  async deleteDocument(id: string): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('finance_loan_documents')
        .delete()
        .eq('id', id);
      if (error) throw error;
      return true;
    } catch (error) {
      console.error('Error deleting finance document:', error);
      return false;
    }
  }


  // --- Audit Logs ---
  async logEdit(tableName: string, recordId: string, oldValues: any, newValues: any, editedBy: string): Promise<void> {
    try {
      const isCreate = !oldValues || Object.keys(oldValues || {}).length === 0;

      if (isCreate) {
        // Record Creation (Insert Operation) - We no longer log this to Edited Logs
        // Per requirements: CREATE -> Activity Log (or separate Created Logs)
        // UPDATE -> Edited Logs ONLY. A CREATE operation must NEVER appear inside Edited Logs.
        return;
      }

      // Record Update Operation - Diff fields & ignore no-ops / metadata
      const ignoredKeys = new Set([
        'id', 'created_at', 'updated_at', 'deleted_at', 'customer_id',
        'fingerprint_url', 'fingerprint_template', 'fingerprint_added',
        'customer_fingerprint_template', 'customer_fingerprint_image_url',
        'customer_fingerprint_added', 'surety_fingerprint_template',
        'surety_fingerprint_image_url', 'surety_fingerprint_added',
        'photo_url', 'customer_photo_url', 'surety_photo_url',
        'fingerprint_status', 'fingerprint_id',
      ]);

      const changedOld: Record<string, any> = {};
      const changedNew: Record<string, any> = {};
      let hasRealChanges = false;

      const allKeys = Array.from(new Set([...Object.keys(oldValues || {}), ...Object.keys(newValues || {})]));

      for (const key of allKeys) {
        if (ignoredKeys.has(key)) continue;

        const oldV = oldValues ? oldValues[key] : undefined;
        const newV = newValues ? newValues[key] : undefined;

        const oldStr = (oldV === null || oldV === undefined) ? '' : (typeof oldV === 'object' ? JSON.stringify(oldV) : String(oldV).trim());
        const newStr = (newV === null || newV === undefined) ? '' : (typeof newV === 'object' ? JSON.stringify(newV) : String(newV).trim());

        if (oldStr !== newStr && (oldStr !== '' || newStr !== '')) {
          changedOld[key] = oldV;
          changedNew[key] = newV;
          hasRealChanges = true;
        }
      }

      // Ignore saves where no actual business value changed
      if (!hasRealChanges) {
        return;
      }

      await supabase
        .from('finance_edited_logs')
        .insert([{
          table_name: tableName,
          record_id: recordId,
          old_values: changedOld,
          new_values: changedNew,
          edited_by: editedBy
        }]);
    } catch (error) {
      console.error('Error writing edit log:', error);
    }
  }

  async logCreate(tableName: string, recordId: string, initialValues: any, createdBy: string): Promise<void> {
    return this.logEdit(tableName, recordId, {}, initialValues, createdBy);
  }

  async logDelete(tableName: string, recordId: string, oldValues: any, deletedBy: string): Promise<void> {
    try {
      await supabase
        .from('finance_deleted_logs')
        .insert([{
          table_name: tableName,
          record_id: recordId,
          old_values: oldValues,
          deleted_by: deletedBy
        }]);
    } catch (error) {
      console.error('Error writing delete log:', error);
    }
  }

  async getEditedLogs(): Promise<FinanceEditedLog[]> {
    try {
      const { data, error } = await supabase
        .from('finance_edited_logs')
        .select('*')
        .order('edited_at', { ascending: false });
      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error fetching edited logs:', error);
      return [];
    }
  }

  async getDeletedLogs(): Promise<FinanceDeletedLog[]> {
    try {
      const { data, error } = await supabase
        .from('finance_deleted_logs')
        .select('*')
        .order('deleted_at', { ascending: false });
      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error fetching deleted logs:', error);
      return [];
    }
  }

  // --- User Access & Permissions Management ---
  async getFinanceUsersPermissions(): Promise<Record<string, string[]>> {
    try {
      const { data, error } = await supabase
        .from('finance_user_permissions')
        .select('user_id, feature_key');
      if (error) throw error;

      const map: Record<string, string[]> = {};
      (data || []).forEach(row => {
        if (!map[row.user_id]) {
          map[row.user_id] = [];
        }
        if (row.feature_key) {
          map[row.user_id].push(row.feature_key);
        }
      });
      return map;
    } catch (error) {
      console.error('Error fetching user permissions:', error);
      return {};
    }
  }

  async updateFinanceUserPermissions(userId: string, featureKeys: string[]): Promise<boolean> {
    try {
      // 1. Delete all existing finance permissions for this user
      const { error: deleteError } = await supabase
        .from('finance_user_permissions')
        .delete()
        .eq('user_id', userId);

      if (deleteError) throw deleteError;

      // 2. Insert new permissions if there are any
      if (featureKeys.length > 0) {
        const rows = featureKeys.map(key => ({
          user_id: userId,
          feature_key: key
        }));

        const { error: insertError } = await supabase
          .from('finance_user_permissions')
          .insert(rows);

        if (insertError) throw insertError;
      }

      return true;
    } catch (error) {
      console.error('Error updating finance user permissions:', error);
      return false;
    }
  }

  async restoreDeletedRecord(logId: string, tableName: string, oldValues: any, _staffName: string): Promise<boolean> {
    try {
      const { error: insertError } = await supabase
        .from(tableName)
        .insert([oldValues]);
      if (insertError) throw insertError;

      const { error: logDeleteError } = await supabase
        .from('finance_deleted_logs')
        .delete()
        .eq('id', logId);
      if (logDeleteError) throw logDeleteError;

      // A restored loan payment must flow back through the ledger and every report
      if (tableName === 'finance_transactions' && oldValues?.type === 'Collection' && oldValues?.loan_id) {
        const rebuilt = await cdLedgerRebuildService.rebuildCDLoanLifecycle(oldValues.loan_id, 'FULL_RECALCULATE');
        if (!rebuilt.success) throw new Error(rebuilt.error || 'Recalculation after restore failed');
      }

      return true;
    } catch (error) {
      console.error('Error restoring deleted record:', error);
      return false;
    }
  }

  // --- Cashbook Accounts ---
  async getCashbookAccounts(): Promise<FinanceCashbookAccount[]> {
    try {
      const { data, error } = await supabase
        .from('finance_cashbook_accounts')
        .select('*')
        .order('account_name');
      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error fetching cashbook accounts:', error);
      return [];
    }
  }

  async createCashbookAccount(account: Omit<FinanceCashbookAccount, 'id' | 'created_at'>): Promise<FinanceCashbookAccount | null> {
    try {
      const { data, error } = await supabase
        .from('finance_cashbook_accounts')
        .insert([account])
        .select()
        .single();
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error creating cashbook account:', error);
      return null;
    }
  }

  async updateCashbookAccount(
    id: string, 
    account: { 
      account_name: string; 
      report_classification: 'BALANCE_SHEET' | 'PROFIT_AND_LOSS';
      report_section: 'BALANCE_SHEET' | 'PROFIT_AND_LOSS';
      category: string;
    }
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // 1. Get old name
      const { data: oldAcc } = await supabase
        .from('finance_cashbook_accounts')
        .select('account_name')
        .eq('id', id)
        .single();

      if (!oldAcc) {
        return { success: false, error: 'Account not found' };
      }

      // 2. Check duplicates if name changed
      if (oldAcc.account_name.toUpperCase() !== account.account_name.toUpperCase()) {
        const { data: duplicate } = await supabase
          .from('finance_cashbook_accounts')
          .select('id')
          .eq('account_name', account.account_name)
          .maybeSingle();

        if (duplicate) {
          return { success: false, error: 'An account with this name already exists.' };
        }
      }

      // 3. Update account
      const { error: updateErr } = await supabase
        .from('finance_cashbook_accounts')
        .update({
          account_name: account.account_name,
          report_classification: account.report_classification,
          report_section: account.report_section,
          category: account.category
        })
        .eq('id', id);

      if (updateErr) throw updateErr;

      // 4. Propagate name changes to existing cashbook entries
      await supabase
        .from('finance_cashbook_entries')
        .update({
          head_of_account: account.account_name
        })
        .eq('head_of_account', oldAcc.account_name);

      return { success: true };
    } catch (error: any) {
      console.error('Error updating cashbook account:', error);
      return { success: false, error: error.message || 'Unknown error occurred' };
    }
  }

  async deleteCashbookAccount(id: string): Promise<{ success: boolean; error?: string }> {
    try {
      // 1. Get the account name first
      const { data: acc } = await supabase
        .from('finance_cashbook_accounts')
        .select('account_name')
        .eq('id', id)
        .single();
      
      if (!acc) {
        return { success: false, error: 'Account not found' };
      }

      // 2. Check if there are any cashbook entries using this account name
      const { data: entries } = await supabase
        .from('finance_cashbook_entries')
        .select('id')
        .eq('head_of_account', acc.account_name)
        .limit(1);

      if (entries && entries.length > 0) {
        return { success: false, error: 'Cannot delete account: It has entries in cash book. Please delete all entries first.' };
      }

      const { error } = await supabase
        .from('finance_cashbook_accounts')
        .delete()
        .eq('id', id);
      if (error) throw error;
      return { success: true };
    } catch (error: any) {
      console.error('Error deleting cashbook account:', error);
      return { success: false, error: error.message || 'Unknown error occurred' };
    }
  }

  // --- Cashbook Entries ---
  async getCashbookEntries(bookId?: string | null, startDate?: string, endDate?: string): Promise<FinanceCashbookEntry[]> {
    try {
      return await fetchAllPages<FinanceCashbookEntry>((from, to) => {
        let query = supabase.from('finance_cashbook_entries').select('*');
        if (bookId) {
          query = query.eq('book_id', bookId);
        }
        if (startDate) {
          query = query.gte('entry_date', startDate);
        }
        if (endDate) {
          query = query.lte('entry_date', endDate);
        }
        return query
          .order('entry_date', { ascending: false })
          .order('created_at', { ascending: false })
          .range(from, to);
      });
    } catch (error) {
      console.error('Error fetching cashbook entries:', error);
      return [];
    }
  }

  async createCashbookEntry(
    entry: Omit<FinanceCashbookEntry, 'id' | 'created_at' | 'updated_at'>,
    isManualEntry: boolean = false
  ): Promise<FinanceCashbookEntry | null> {
    try {
      const { data, error } = await supabase
        .from('finance_cashbook_entries')
        .insert([entry])
        .select()
        .single();
      if (error) throw error;

      if (data && isManualEntry) {
        const amt = Number(data.credit || 0) + Number(data.debit || 0);
        await this.logTransactionForReview({
          loanId: null,
          sourceType: 'Day Book Entry',
          sourceId: data.id,
          receiptNo: data.account_number || null,
          transactionType: 'Day Book Entry',
          transactionDate: data.entry_date,
          amount: amt,
          enteredBy: data.created_by || 'Staff'
        });
      }

      return data;
    } catch (error) {
      console.error('Error creating cashbook entry:', error);
      return null;
    }
  }


  async updateCashbookEntry(id: string, entry: Partial<FinanceCashbookEntry>, editedBy: string): Promise<FinanceCashbookEntry | null> {
    try {
      const { data: oldData } = await supabase
        .from('finance_cashbook_entries')
        .select('*')
        .eq('id', id)
        .single();

      const { data, error } = await supabase
        .from('finance_cashbook_entries')
        .update({ ...entry, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;

      if (oldData) {
        await this.logEdit('finance_cashbook_entries', id, oldData, data, editedBy);
      }
      return data;
    } catch (error) {
      console.error('Error updating cashbook entry:', error);
      return null;
    }
  }

  async approveCashbookEntry(id: string, approvedBy: string): Promise<FinanceCashbookEntry | null> {
    try {
      const { data, error } = await supabase
        .from('finance_cashbook_entries')
        .update({
          status: 'APPROVED',
          approved_by: approvedBy,
          approved_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error approving cashbook entry:', error);
      return null;
    }
  }

  async deleteCashbookEntry(id: string, deletedBy: string): Promise<boolean> {
    try {
      const { data: oldData } = await supabase
        .from('finance_cashbook_entries')
        .select('*')
        .eq('id', id)
        .single();

      const { error } = await supabase
        .from('finance_cashbook_entries')
        .delete()
        .eq('id', id);
      if (error) throw error;

      if (oldData) {
        await this.logDelete('finance_cashbook_entries', id, oldData, deletedBy);
      }
      return true;
    } catch (error) {
      console.error('Error deleting cashbook entry:', error);
      return false;
    }
  }

  async deleteAllCashbookEntries(deletedBy: string): Promise<boolean> {
    try {
      const { data: oldData } = await supabase
        .from('finance_cashbook_entries')
        .select('*');

      const { error } = await supabase
        .from('finance_cashbook_entries')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000');
      if (error) throw error;

      if (oldData && oldData.length > 0) {
        for (const row of oldData) {
          await this.logDelete('finance_cashbook_entries', row.id, row, deletedBy);
        }
      }
      return true;
    } catch (error) {
      console.error('Error deleting all cashbook entries:', error);
      return false;
    }
  }

  async clearCashbook(deletedBy: string): Promise<boolean> {
    return this.deleteAllCashbookEntries(deletedBy);
  }

  // Module-level cache for legacy book UUIDs
  private cachedRegBookId: string | null = null;
  private cachedItrBookId: string | null = null;

  async getLegacyBookId(mode: 'REGULAR' | 'ITR'): Promise<string | null> {
    if (mode === 'REGULAR' && this.cachedRegBookId) return this.cachedRegBookId;
    if (mode === 'ITR' && this.cachedItrBookId) return this.cachedItrBookId;
    
    try {
      const code = mode === 'REGULAR' ? 'REG-LEGACY' : 'ITR-LEGACY';
      const { data, error: _error } = await supabase
        .from('books')
        .select('id')
        .eq('book_code', code)
        .maybeSingle();
        
      if (data) {
        if (mode === 'REGULAR') this.cachedRegBookId = data.id;
        else this.cachedItrBookId = data.id;
        return data.id;
      }
      return null;
    } catch (e) {
      console.error(`Error resolving book id for ${mode}:`, e);
      return null;
    }
  }

  // --- Transaction Reviews (Admin Approvals) ---
  async logTransactionForReview(params: {
    loanId: string | null;
    sourceType: 'Loan Payment' | 'Day Book Entry';
    sourceId: string;
    receiptNo?: string | null;
    transactionType: string;
    transactionDate: string;
    amount: number;
    penaltyAmount?: number;
    interestAmount?: number;
    principalAmount?: number;
    enteredBy: string;
    bookId?: string | null;
    financeMode?: 'REGULAR' | 'ITR';
    actionType?: 'CREATE' | 'EDIT' | 'DELETE';
  }): Promise<boolean> {
    try {
      let bookId = params.bookId || null;
      let financeMode = params.financeMode;

      if (params.loanId && (!bookId || !financeMode)) {
        const { data: loan } = await supabase
          .from('finance_loans')
          .select('book_id')
          .eq('id', params.loanId)
          .single();
        if (loan) {
          bookId = loan.book_id;
        }
      }

      if (!financeMode) {
        if (bookId) {
          await this.getLegacyBookId('REGULAR'); // warm cache; return value not needed
          const itrId = await this.getLegacyBookId('ITR');
          if (bookId === itrId) {
            financeMode = 'ITR';
          } else {
            financeMode = 'REGULAR';
          }
        } else {
          financeMode = 'REGULAR';
        }
      }

      if (!bookId && financeMode) {
        bookId = await this.getLegacyBookId(financeMode);
      }

      const payload = {
        book_id: bookId,
        finance_mode: financeMode,
        source_type: params.sourceType,
        source_id: params.sourceId,
        loan_id: params.loanId || null,
        receipt_number: params.receiptNo || null,
        transaction_type: params.transactionType,
        transaction_date: params.transactionDate.includes('T') ? params.transactionDate.split('T')[0] : params.transactionDate,
        amount: params.amount,
        penalty_amount: params.penaltyAmount || 0,
        interest_amount: params.interestAmount || 0,
        principal_amount: params.principalAmount || 0,
        entered_by: params.enteredBy,
        review_status: 'PENDING',
        action_type: params.actionType || 'CREATE'
      };
      
      const { error } = await supabase
        .from('finance_transaction_reviews')
        .insert([payload]);
        
      if (error) {
        if (error.code === '23505') {
          return true; // Already logged
        }
        throw error;
      }
      return true;
    } catch (error) {
      console.error('Error logging transaction for review:', error);
      return false;
    }
  }

  async getTransactionReviews(filters?: {
    status?: 'PENDING' | 'APPROVED' | 'ALL' | 'REJECTED';
    date?: string;
    enteredBy?: string;
    loanType?: string;
    accountNo?: string;
    receiptNo?: string;
    actionType?: 'ALL' | 'EDIT' | 'DELETE' | 'CREATE';
    fromDate?: string;
    toDate?: string;
  }): Promise<FinanceTransactionReview[]> {
    try {
      let query = supabase.from('finance_transaction_reviews').select('*, finance_loans(loan_id, loan_category, customer:finance_customers(name))');
      
      if (filters) {
        if (filters.status && filters.status !== 'ALL') {
          query = query.eq('review_status', filters.status);
        }
        if (filters.date) {
          query = query.eq('transaction_date', filters.date);
        }
        if (filters.status === 'APPROVED' && (filters.fromDate || filters.toDate)) {
          if (filters.fromDate && filters.toDate) {
            const fromTs = `${filters.fromDate}T00:00:00`;
            const toTs = `${filters.toDate}T23:59:59`;
            query = query.or(`and(transaction_date.gte.${filters.fromDate},transaction_date.lte.${filters.toDate}),and(approved_at.gte.${fromTs},approved_at.lte.${toTs})`);
          } else if (filters.fromDate) {
            const fromTs = `${filters.fromDate}T00:00:00`;
            query = query.or(`transaction_date.gte.${filters.fromDate},approved_at.gte.${fromTs}`);
          } else if (filters.toDate) {
            const toTs = `${filters.toDate}T23:59:59`;
            query = query.or(`transaction_date.lte.${filters.toDate},approved_at.lte.${toTs}`);
          }
        } else {
          if (filters.fromDate) {
            query = query.gte('transaction_date', filters.fromDate);
          }
          if (filters.toDate) {
            query = query.lte('transaction_date', filters.toDate);
          }
        }
        if (filters.enteredBy) {
          query = query.ilike('entered_by', `%${filters.enteredBy}%`);
        }
        if (filters.receiptNo) {
          query = query.ilike('receipt_number', `%${filters.receiptNo}%`);
        }
        if (filters.loanType) {
          query = query.eq('transaction_type', filters.loanType);
        }
        if (filters.actionType && filters.actionType !== 'ALL') {
          query = query.eq('action_type', filters.actionType);
        }
      }
      
      // The API returns at most 1000 rows per request, so read page by page
      const ordered = query.order('created_at', { ascending: false });
      let data: any[] = [];
      for (let page = 0; page < 200; page++) {
        const { data: chunk, error } = await ordered.range(page * 1000, page * 1000 + 999);
        if (error) throw error;
        data = data.concat(chunk || []);
        if (!chunk || chunk.length < 1000) break;
      }

      let result = data || [];
      if (filters?.accountNo) {
        const search = filters.accountNo.toLowerCase();
        result = result.filter((r: any) => {
          const lId = r.finance_loans?.loan_id || '';
          return lId.toLowerCase().includes(search) || r.source_id.toLowerCase().includes(search);
        });
      }
      
      return result as unknown as FinanceTransactionReview[];
    } catch (error) {
      console.error('Error fetching transaction reviews:', error);
      throw error;
    }
  }

  async getPendingReviews(): Promise<FinanceTransactionReview[]> {
    try {
      const { data, error } = await supabase
        .from('finance_transaction_reviews')
        .select('*')
        .eq('review_status', 'PENDING');
      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error fetching pending reviews:', error);
      return [];
    }
  }

  async getPendingApprovalsCount(): Promise<number> {
    try {
      const { count, error } = await supabase
        .from('finance_transaction_reviews')
        .select('*', { count: 'exact', head: true })
        .eq('review_status', 'PENDING');
      if (error) throw error;
      return count || 0;
    } catch (error) {
      console.error('Error fetching pending reviews count:', error);
      return 0;
    }
  }

  async getTransactionReviewDetails(reviewId: string): Promise<any[]> {
    try {
      const { data: review, error: fetchErr } = await supabase
        .from('finance_transaction_reviews')
        .select('*, finance_loans(*)')
        .eq('id', reviewId)
        .single();
        
      if (fetchErr || !review) throw fetchErr || new Error('Review record not found');
      
      const details: any[] = [];
      const loanId = review.loan_id;
      const loanIdStr = review.finance_loans?.loan_id || '';
      const receiptNo = review.receipt_number;

      if (loanId && (review.transaction_type.startsWith('CD') || review.source_type === 'Loan Payment')) {
        const { data: cdEntries } = await supabase
          .from('finance_cd_ledger_entries')
          .select('*')
          .eq('loan_id', loanId)
          .eq('receipt_no', receiptNo);
          
        if (cdEntries && cdEntries.length > 0) {
          cdEntries.forEach(entry => {
            details.push({
              date: entry.entry_date,
              account_name: entry.account_name,
              particulars: entry.particulars,
              debit: Number(entry.debit || 0),
              credit: Number(entry.credit || 0),
              entered_by: entry.user_name || review.entered_by,
              status: review.review_status
            });
          });
        }
      }

      if (loanId) {
        const { data: cbEntries } = await supabase
          .from('finance_cashbook_entries')
          .select('*')
          .eq('account_number', loanIdStr);
          
        if (cbEntries && cbEntries.length > 0) {
          const filtered = cbEntries.filter(entry => {
            const hasReceipt = receiptNo && entry.particulars?.includes(receiptNo);
            const hasDate = entry.entry_date === review.transaction_date;
            return hasReceipt || hasDate;
          });
          
          filtered.forEach(entry => {
            if (!details.some(d => d.particulars === entry.particulars && d.credit === Number(entry.credit || 0) && d.debit === Number(entry.debit || 0))) {
              details.push({
                date: entry.entry_date,
                account_name: entry.head_of_account,
                particulars: entry.particulars,
                debit: Number(entry.debit || 0),
                credit: Number(entry.credit || 0),
                entered_by: entry.created_by || review.entered_by,
                status: review.review_status
              });
            }
          });
        }
      } else if (review.source_type === 'Day Book Entry' || review.transaction_type === 'Day Book Entry') {
        const { data: entry } = await supabase
          .from('finance_cashbook_entries')
          .select('*')
          .eq('id', review.source_id)
          .single();
          
        if (entry) {
          details.push({
            date: entry.entry_date,
            account_name: entry.head_of_account,
            particulars: entry.particulars,
            debit: Number(entry.debit || 0),
            credit: Number(entry.credit || 0),
            entered_by: entry.created_by || review.entered_by,
            status: review.review_status
          });
        }
      }

      return details;
    } catch (e) {
      console.error('Error fetching transaction review details:', e);
      return [];
    }
  }

  async approveTransactionsBulk(params: {
    transactionIds: string[];
    approvedBy: string;
  }): Promise<{
    requested: number;
    approved: number;
    skipped: number;
    failed: number;
    failures: Array<{ transactionId: string; receiptNo?: string; reason: string }>;
  }> {
    const result = {
      requested: params.transactionIds.length,
      approved: 0,
      skipped: 0,
      failed: 0,
      failures: [] as Array<{ transactionId: string; receiptNo?: string; reason: string }>
    };

    if (params.transactionIds.length === 0) return result;

    try {
      // 1. Fetch valid pending reviews
      const { data: reviews, error: fetchErr } = await supabase
        .from('finance_transaction_reviews')
        .select('*')
        .in('id', params.transactionIds);

      if (fetchErr) throw fetchErr;
      
      // Separate already processed ones
      const pendingReviews = reviews?.filter(r => r.review_status === 'PENDING') || [];
      const nonPendingReviews = reviews?.filter(r => r.review_status !== 'PENDING') || [];
      const foundIds = new Set(reviews?.map(r => r.id) || []);
      
      result.skipped += nonPendingReviews.length;
      params.transactionIds.forEach(id => {
        if (!foundIds.has(id)) {
          result.skipped++; // missing record
        }
      });

      // 2. Sort chronologically
      pendingReviews.sort((a, b) => {
        const dateA = new Date(a.transaction_date).getTime();
        const dateB = new Date(b.transaction_date).getTime();
        if (dateA !== dateB) return dateA - dateB;
        
        const createdA = new Date(a.created_at).getTime();
        const createdB = new Date(b.created_at).getTime();
        if (createdA !== createdB) return createdA - createdB;
        
        return a.id.localeCompare(b.id);
      });

      // 3. Process canonical logic per review
      const now = new Date().toISOString();
      const affectedCdLoanIds = new Set<string>();

      for (const review of pendingReviews) {
        try {
          const { error: updateReviewErr } = await supabase
            .from('finance_transaction_reviews')
            .update({
              review_status: 'APPROVED',
              approved_by: params.approvedBy,
              approved_at: now,
              updated_at: now
            })
            .eq('id', review.id);

          if (updateReviewErr) throw updateReviewErr;

          if (review.source_type === 'Day Book Entry') {
            const { error: updateCashbookErr } = await supabase
              .from('finance_cashbook_entries')
              .update({
                status: 'APPROVED',
                approved_by: params.approvedBy,
                approved_at: now,
                updated_at: now
              })
              .eq('id', review.source_id);

            if (updateCashbookErr) {
              await supabase
                .from('finance_transaction_reviews')
                .update({
                  review_status: 'PENDING',
                  approved_by: null,
                  approved_at: null,
                  updated_at: now
                })
                .eq('id', review.id);
              throw updateCashbookErr;
            }
          }

          result.approved++;

          // Track CD loans for rebuilding
          if (review.loan_id && review.transaction_type && review.transaction_type.startsWith('CD ')) {
            affectedCdLoanIds.add(review.loan_id);
          }

        } catch (err: any) {
          result.failed++;
          result.failures.push({
            transactionId: review.id,
            receiptNo: review.receipt_number || 'N/A',
            reason: err?.message || 'Unknown error'
          });
        }
      }

      // 4. Grouped CD Rebuild
      for (const loanId of affectedCdLoanIds) {
        try {
          console.log(`[Bulk Approval] Rebuilding affected CD loan: ${loanId}`);
          await cdLedgerRebuildService.rebuildCDLoanLifecycle(loanId, 'FULL_RECALCULATE');
        } catch (err: any) {
           console.error(`Error rebuilding CD loan ${loanId} after bulk approval:`, err);
        }
      }

      return result;

    } catch (error: any) {
      console.error('Error in approveTransactionsBulk:', error);
      // Entire operation failed unexpectedly
      result.failed += params.transactionIds.length - result.approved - result.skipped;
      result.failures.push({
        transactionId: 'ALL',
        reason: error?.message || 'Fatal bulk operation error'
      });
      return result;
    }
  }

  async approveTransactionReview(reviewId: string, approvedBy: string): Promise<boolean> {
    try {
      const { data: review, error: fetchErr } = await supabase
        .from('finance_transaction_reviews')
        .select('*')
        .eq('id', reviewId)
        .single();
        
      if (fetchErr || !review) throw fetchErr || new Error('Review record not found');
      
      const now = new Date().toISOString();
      
      const { error: updateReviewErr } = await supabase
        .from('finance_transaction_reviews')
        .update({
          review_status: 'APPROVED',
          approved_by: approvedBy,
          approved_at: now,
          updated_at: now
        })
        .eq('id', reviewId);
        
      if (updateReviewErr) throw updateReviewErr;
      
      if (review.source_type === 'Day Book Entry') {
        const { error: updateCashbookErr } = await supabase
          .from('finance_cashbook_entries')
          .update({
            status: 'APPROVED',
            approved_by: approvedBy,
            approved_at: now,
            updated_at: now
          })
          .eq('id', review.source_id);
          
        if (updateCashbookErr) {
          await supabase
            .from('finance_transaction_reviews')
            .update({
              review_status: 'PENDING',
              approved_by: null,
              approved_at: null,
              updated_at: now
            })
            .eq('id', reviewId);
          throw updateCashbookErr;
        }
      }
      
      return true;
    } catch (error) {
      console.error('Error approving transaction review:', error);
      return false;
    }
  }

  async rejectTransactionReview(reviewId: string, rejectedBy: string): Promise<boolean> {
    try {
      const { data: review, error: fetchErr } = await supabase
        .from('finance_transaction_reviews')
        .select('*')
        .eq('id', reviewId)
        .single();
        
      if (fetchErr || !review) throw fetchErr || new Error('Review record not found');
      
      const now = new Date().toISOString();
      
      const { error: updateReviewErr } = await supabase
        .from('finance_transaction_reviews')
        .update({
          review_status: 'REJECTED',
          approved_by: rejectedBy,
          approved_at: now,
          updated_at: now
        })
        .eq('id', reviewId);
        
      if (updateReviewErr) throw updateReviewErr;
      
      if (review.source_type === 'Day Book Entry') {
        const { error: updateCashbookErr } = await supabase
          .from('finance_cashbook_entries')
          .update({
            status: 'REJECTED',
            approved_by: rejectedBy,
            approved_at: now,
            updated_at: now
          })
          .eq('id', review.source_id);
          
        if (updateCashbookErr) {
          await supabase
            .from('finance_transaction_reviews')
            .update({
              review_status: 'PENDING',
              approved_by: null,
              approved_at: null,
              updated_at: now
            })
            .eq('id', reviewId);
          throw updateCashbookErr;
        }
      }
      
      return true;
    } catch (error) {
      console.error('Error rejecting transaction review:', error);
      return false;
    }
  }

  // --- Utility for Calendar Indicators ---
  async getAllFinanceEntryDates(): Promise<{ c_date: string }[]> {
    try {
      const results = await Promise.all([
        supabase.from('finance_cd_ledger_entries').select('entry_date').neq('account_name', 'CD Amount Paid'),
        supabase.from('finance_cashbook_entries').select('entry_date'),
        supabase.from('finance_capital_entries').select('entry_date')
      ]);

      const datesSet = new Set<string>();

      const addDate = (d: any) => {
        if (typeof d === 'string') {
          if (d.includes('T')) {
            const dateObj = new Date(d);
            if (!isNaN(dateObj.getTime())) {
               const y = dateObj.getFullYear();
               const m = String(dateObj.getMonth() + 1).padStart(2, '0');
               const day = String(dateObj.getDate()).padStart(2, '0');
               datesSet.add(`${y}-${m}-${day}`);
               return;
            }
          }
          const match = d.match(/^(\d{4}-\d{2}-\d{2})/);
          if (match) {
            datesSet.add(match[1]);
          }
        }
      };

      results[0].data?.forEach(r => addDate(r.entry_date));
      results[1].data?.forEach(r => addDate(r.entry_date));
      results[2].data?.forEach(r => addDate(r.entry_date));

      return Array.from(datesSet).map(d => ({ c_date: d }));
    } catch (error) {
      console.error('Error fetching finance entry dates:', error);
      return [];
    }
  }

  async getAllTransactionReviewDates(): Promise<{ c_date: string }[]> {
    try {
      const results = await Promise.all([
        supabase.from('finance_transaction_reviews').select('transaction_date, created_at'),
        supabase.from('finance_cd_ledger_entries').select('entry_date'),
        supabase.from('finance_cashbook_entries').select('entry_date'),
        supabase.from('finance_capital_entries').select('entry_date')
      ]);

      const datesSet = new Set<string>();
      const addDate = (d: any) => {
        if (!d) return;
        const str = String(d);
        const match = str.match(/^(\d{4}-\d{2}-\d{2})/);
        if (match) {
          datesSet.add(match[1]);
        } else if (str.includes('T')) {
          const dateObj = new Date(str);
          if (!isNaN(dateObj.getTime())) {
            const y = dateObj.getFullYear();
            const m = String(dateObj.getMonth() + 1).padStart(2, '0');
            const day = String(dateObj.getDate()).padStart(2, '0');
            datesSet.add(`${y}-${m}-${day}`);
          }
        }
      };

      results[0].data?.forEach((r: any) => { addDate(r.transaction_date); addDate(r.created_at); });
      results[1].data?.forEach((r: any) => addDate(r.entry_date));
      results[2].data?.forEach((r: any) => addDate(r.entry_date));
      results[3].data?.forEach((r: any) => addDate(r.entry_date));

      return Array.from(datesSet).map(d => ({ c_date: d }));
    } catch (err) {
      console.error('Error fetching transaction review dates:', err);
      return [];
    }
  }

  async getUnifiedLedgerEntries(filters?: { startDate?: string; endDate?: string }): Promise<UnifiedLedgerEntry[]> {
    try {
      // 1. Fetch CD Ledger Entries
      let cdQuery = supabase
        .from('finance_cd_ledger_entries')
        .select('*, loan:finance_loans(loan_id)')
        .neq('account_name', 'CD Amount Paid');
      
      // 2. Fetch Cashbook Entries (Approved only)
      let cbQuery = supabase
        .from('finance_cashbook_entries')
        .select('*');
        
      // 3. Fetch Capital Entries
      let capQuery = supabase
        .from('finance_capital_entries')
        .select('*, partner:finance_partners(name)');

      if (filters?.startDate) {
        cdQuery = cdQuery.gte('entry_date', filters.startDate);
        cbQuery = cbQuery.gte('entry_date', filters.startDate);
        capQuery = capQuery.gte('entry_date', filters.startDate);
      }
      if (filters?.endDate) {
        cdQuery = cdQuery.lte('entry_date', filters.endDate);
        cbQuery = cbQuery.lte('entry_date', filters.endDate);
        capQuery = capQuery.lte('entry_date', filters.endDate);
      }

      const [cdRes, cbRes, capRes] = await Promise.all([cdQuery, cbQuery, capQuery]);

      if (cdRes.error) throw cdRes.error;
      if (cbRes.error) throw cbRes.error;
      if (capRes.error) throw capRes.error;

      const unifiedEntries: UnifiedLedgerEntry[] = [];

      // Process CD entries
      (cdRes.data || []).forEach((entry: any) => {
        let head = entry.account_name || 'CD A/C';
        if (head === 'CD COMMISSION A/C') head = 'CD INTEREST';
        else if (head === 'CD A/C' || head === 'CD PRINCIPAL') head = 'CD DISBURSEMENT';
        else if (head === 'CD DOCUMENT CHARGES A/C') head = 'CD DOCUMENT CHARGES';
        else if (head === 'PENALTY A/C') head = 'CD PENALTY';

        unifiedEntries.push({
          id: entry.id,
          date: entry.entry_date,
          account_number: entry.loan?.loan_id || 'CD',
          head_of_account: head,
          debit: Number(entry.debit) || 0,
          credit: Number(entry.credit) || 0,
          particulars: entry.particulars || '',
          user: entry.user_name || 'Staff',
          category: 'CD'
        });
      });

      // Process Cashbook entries
      (cbRes.data || []).forEach((cb: any) => {
        const head = cb.head_of_account || '';
        const accNo = cb.account_number || '';
        let category: UnifiedLedgerEntry['category'] = 'OTHER';

        const upperHead = head.toUpperCase();
        const upperAccNo = accNo.toUpperCase();

        if (upperHead.includes('HP')) {
          category = 'HP';
        } else if (upperHead.includes('STBD')) {
          category = 'STBD';
        } else if (upperHead.includes('TBD')) {
          category = 'TBD';
        } else if (upperHead === 'COMMISSION A/C' || upperHead === 'PENALTY A/C' || upperHead === 'HP COMMISSION A/C' || upperHead === 'HP PENALTY A/C' || upperHead === 'STBD COMMISSION A/C' || upperHead === 'STBD PENALTY A/C') {
          if (upperAccNo.startsWith('TBD')) category = 'TBD';
          else if (upperAccNo.startsWith('STBD')) category = 'STBD';
          else if (upperAccNo.startsWith('HP')) category = 'HP';
        } else if (upperHead === 'BANK' || upperHead.includes('BANK')) {
          category = 'BANK';
        } else if (upperHead === 'SALARY' || upperHead.includes('SALARY')) {
          category = 'SALARY';
        } else if (upperHead === 'EXPENSE' || upperHead === 'EXPENDITURE' || upperHead.includes('EXPENSE') || upperHead.includes('EXPENDITURE')) {
          category = 'EXPENSE';
        } else if (upperHead === 'CAPITAL' || upperHead.includes('CAPITAL')) {
          category = 'CAPITAL';
        } else if (upperHead === 'LIABILITIES' || upperHead.includes('LIABILITY')) {
          category = 'LIABILITIES';
        }

        unifiedEntries.push({
          id: cb.id,
          date: cb.entry_date,
          account_number: cb.account_number || '—',
          head_of_account: head,
          debit: Number(cb.debit) || 0,
          credit: Number(cb.credit) || 0,
          particulars: cb.particulars || '',
          user: cb.created_by || 'Staff',
          category
        });
      });

      // Process Capital entries
      (capRes.data || []).forEach((cap: any) => {
        unifiedEntries.push({
          id: cap.id,
          date: cap.entry_date,
          account_number: cap.partner?.name || cap.partner_name || 'Partner',
          head_of_account: 'CAPITAL',
          debit: Number(cap.debit) || 0,
          credit: Number(cap.credit) || 0,
          particulars: cap.particulars || 'Capital Entry',
          user: cap.created_by || 'Staff',
          category: 'CAPITAL'
        });
      });

      // Sort by date, then ID/created_at fallback
      return unifiedEntries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    } catch (error) {
      console.error('Error fetching unified ledger entries:', error);
      return [];
    }
  }

  async getFollowUps(filters?: { loanId?: string; staff?: string; date?: string }): Promise<FinanceLoanPaymentFollowup[]> {
    try {
      let query = supabase
        .from('finance_loan_payment_followups')
        .select(`
          *,
          loan:finance_loans(
            id,
            loan_id,
            loan_category,
            amount,
            status,
            customer_id,
            guarantor_1_id,
            guarantor_2_id,
            customer:finance_customers!customer_id(id, name, phone, partner_name)
          )
        `);

      if (filters?.loanId) {
        query = query.eq('loan_id', filters.loanId);
      }
      if (filters?.staff) {
        query = query.eq('followed_up_by', filters.staff);
      }
      if (filters?.date) {
        query = query.eq('follow_up_date', filters.date);
      }

      const { data, error } = await query.order('followed_up_at', { ascending: false });
      if (error) throw error;
      if (!data || data.length === 0) return [];

      // Fetch customers to resolve guarantors in-memory to bypass missing DB foreign keys
      const { data: customers } = await supabase
        .from('finance_customers')
        .select('id, name, phone');

      const customerMap = new Map();
      if (customers) {
        customers.forEach((c: any) => customerMap.set(c.id, c));
      }

      return data.map((followup: any) => {
        if (followup.loan) {
          followup.loan.guarantor_1 = followup.loan.guarantor_1_id ? customerMap.get(followup.loan.guarantor_1_id) : null;
          followup.loan.guarantor_2 = followup.loan.guarantor_2_id ? customerMap.get(followup.loan.guarantor_2_id) : null;
        }
        return followup;
      });
    } catch (error) {
      console.error('Error fetching follow-ups:', error);
      throw error;
    }
  }

  async createFollowUp(followup: Omit<FinanceLoanPaymentFollowup, 'id' | 'followed_up_at' | 'created_at' | 'updated_at'>): Promise<FinanceLoanPaymentFollowup | null> {
    try {
      const { data, error } = await supabase
        .from('finance_loan_payment_followups')
        .insert([{
          ...followup,
          followed_up_at: new Date().toISOString()
        }])
        .select()
        .single();
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error creating follow-up:', error);
      return null;
    }
  }

  async getActiveCDDuePositions(asOfDate: string, onlyLoanIds?: string[]): Promise<{ positions: any[], integrityErrors: any[] }> {
    if (onlyLoanIds && onlyLoanIds.length === 0) return { positions: [], integrityErrors: [] };
    let cdLoansQuery = supabase
      .from('finance_loans')
      .select('*')
      .like('loan_id', 'CD%');
    // Optional: only these loans (same calculation, fewer rows)
    if (onlyLoanIds) cdLoansQuery = cdLoansQuery.in('id', onlyLoanIds);
    const { data: cdLoans, error: loansErr } = await cdLoansQuery;
      
    if (loansErr) throw loansErr;
    if (!cdLoans || cdLoans.length === 0) return { positions: [], integrityErrors: [] };

    const loanIds = cdLoans.map(l => l.id);

    let cdLedgerEntries: any[] = [];
    const chunkSize = 100;
    for (let i = 0; i < loanIds.length; i += chunkSize) {
      const chunk = loanIds.slice(i, i + chunkSize);
      let page = 0;
      let hasMore = true;
      while (hasMore) {
        const { data, error } = await supabase
          .from('finance_cd_ledger_entries')
          .select('*')
          .in('loan_id', chunk)
          .range(page * 1000, (page + 1) * 1000 - 1);
        if (error) throw error;
        if (data && data.length > 0) {
          cdLedgerEntries = cdLedgerEntries.concat(data);
          if (data.length < 1000) hasMore = false;
          else page++;
        } else {
          hasMore = false;
        }
      }
    }

    // Fetch Disbursement transactions from finance_transactions.
    // For legacy loans like CD119, the true disbursement date lives here, not in
    // finance_cd_ledger_entries. getCDLedgerEntries already reconciles these; we
    // must do the same here so both paths resolve the canonical loan date identically.
    let disbursementTransactions: any[] = [];
    for (let i = 0; i < loanIds.length; i += chunkSize) {
      const chunk = loanIds.slice(i, i + chunkSize);
      const { data, error } = await supabase
        .from('finance_transactions')
        .select('id, loan_id, date, amount, type, collected_by, created_at')
        .in('loan_id', chunk)
        .eq('type', 'Disbursement');
      if (error) throw error;
      if (data) disbursementTransactions = disbursementTransactions.concat(data);
    }
    // Build a lookup: loanId -> first disbursement transaction (earliest date)
    const disbursementByLoan = new Map<string, any>();
    for (const tx of disbursementTransactions) {
      const existing = disbursementByLoan.get(tx.loan_id);
      if (!existing || tx.date < existing.date) {
        disbursementByLoan.set(tx.loan_id, tx);
      }
    }

    let cdInterestDetails: any[] = [];
    for (let i = 0; i < loanIds.length; i += chunkSize) {
      const chunk = loanIds.slice(i, i + chunkSize);
      let page = 0;
      let hasMore = true;
      while (hasMore) {
        const { data, error } = await supabase
          .from('finance_cd_interest_details')
          .select('*')
          .in('loan_id', chunk)
          .range(page * 1000, (page + 1) * 1000 - 1);
        if (error) throw error;
        if (data && data.length > 0) {
          cdInterestDetails = cdInterestDetails.concat(data);
          if (data.length < 1000) hasMore = false;
          else page++;
        } else {
          hasMore = false;
        }
      }
    }

    let npaRecords: any[] = [];
    try {
      const { data: npaData } = await supabase
        .from('finance_npa_records')
        .select('*');
      if (npaData) npaRecords = npaData;
    } catch (npaErr) {
      console.warn('Could not fetch finance_npa_records in getActiveCDDuePositions:', npaErr);
    }
    const npaRecordByLoanId = new Map<string, any>();
    npaRecords.forEach(r => {
      if (r.loan_id) npaRecordByLoanId.set(r.loan_id, r);
    });

    const customerIds = [...new Set(cdLoans.flatMap(l => [l.customer_id, l.guarantor_1_id, l.guarantor_2_id]).filter(Boolean))];
    let borrowers: any[] = [];
    for (let i = 0; i < customerIds.length; i += chunkSize) {
      const chunk = customerIds.slice(i, i + chunkSize);
      const { data, error } = await supabase.from('finance_customers').select('*').in('id', chunk);
      if (error) throw error;
      if (data) borrowers = borrowers.concat(data);
    }
    const borrowerMap = new Map<string, any>(borrowers.map(b => [b.id, b]));

    const results = cdLoans.reduce((acc, loan) => {
      try {
        const nativeEntries = cdLedgerEntries.filter(e => e.loan_id === loan.id);
        const interests = cdInterestDetails.filter(d => d.loan_id === loan.id);

        const hasNativeOriginalLoan = nativeEntries.some(e => e.entry_type === 'original_loan' || e.entry_type === 'Disbursement');
        const syntheticEntries: any[] = [];
        if (!hasNativeOriginalLoan) {
          const disbTx = disbursementByLoan.get(loan.id);
          if (disbTx) {
            syntheticEntries.push({
              id: `synthetic-disb-${disbTx.id}`,
              loan_id: loan.id,
              customer_id: loan.customer_id,
              account_name: 'CD A/C',
              entry_date: disbTx.date,
              credit: 0,
              debit: Number(disbTx.amount),
              receipt_no: null,
              particulars: 'Original Loan Disbursement (reconciled from finance_transactions)',
              user_name: disbTx.collected_by || 'System',
              entry_type: 'original_loan',
              created_at: disbTx.created_at || disbTx.date,
            });
          } else {
            syntheticEntries.push({
              id: `synthetic-loan-${loan.id}`,
              loan_id: loan.id,
              customer_id: loan.customer_id,
              account_name: 'CD A/C',
              entry_date: loan.date,
              credit: 0,
              debit: Number(loan.amount),
              receipt_no: null,
              particulars: 'Original Loan Disbursement',
              user_name: 'System',
              entry_type: 'original_loan',
              created_at: loan.created_at || loan.date,
            });
          }
        }

        const entries = [...nativeEntries, ...syntheticEntries];
        
        const borrower = borrowerMap.get(loan.customer_id) || {};
        const g1 = borrowerMap.get(loan.guarantor_1_id) || {};
        const g2 = borrowerMap.get(loan.guarantor_2_id) || {};
        
        const phone = borrower.phone || borrower.phone_1 || borrower.phone_2 || '';
        const g1_name = g1.name || '';
        const g1_phone = g1.phone || g1.phone_1 || g1.phone_2 || '';
        const g2_name = g2.name || '';
        const g2_phone = g2.phone || g2.phone_1 || g2.phone_2 || '';
        
        const disbEntry = entries.find(e => e.entry_type === 'original_loan' || e.entry_type === 'Disbursement');
        const originalLoanDateStr = disbEntry ? disbEntry.entry_date.split('T')[0] : loan.date.split('T')[0];

        const interestPaid = entries
          .filter(e => e.account_name === 'CD COMMISSION A/C' || e.entry_type === 'interest_payment')
          .reduce((sum, e) => sum + Number(e.credit || 0), 0);

        const penaltyPaid = entries
          .filter(e => {
            const cleanAcc = (e.account_name || '').trim().toUpperCase();
            return cleanAcc === 'PENALTY A/C' || cleanAcc === 'CD PENALTY' || e.entry_type === 'penalty_payment';
          })
          .reduce((sum, e) => sum + Number(e.credit || 0), 0);

        // Extra fields (used by Aadhaar Search; Dues List ignores them):
        // - original loan amount from the disbursement row (loan.amount holds the current principal)
        // - opening interest the CD Ledger shows on the "Loan Issue" row but which has no row in the
        //   database (older loans). Same fallback as the CD Ledger: P x rate% x period days / 30.
        //   When the opening row exists it is already inside interestPaid, so this stays 0.
        const originalLoanAmount = disbEntry ? Number(disbEntry.debit || 0) || Number(loan.amount || 0) : Number(loan.amount || 0);
        const hasOpeningCommissionRow = entries.some(e =>
          e.entry_type === 'opening_commission' || e.entry_type === 'Commission' ||
          ((e.account_name || '').toUpperCase() === 'CD COMMISSION A/C'
            && (!e.receipt_no || e.receipt_no === '-')
            && e.entry_type !== 'interest_payment' && e.entry_type !== 'penalty_payment')
        );
        const openingPeriodDays = (loan.period_days && Number(loan.period_days) > 0) ? Number(loan.period_days) : 30;
        const openingInterest = hasOpeningCommissionRow
          ? 0
          : Number(((originalLoanAmount * ((Number(loan.interest_rate) || 3) / 100) * openingPeriodDays) / 30).toFixed(2));

        const cleanStatus = (loan.status || '').trim().toUpperCase();
        const isNpaClosed = cleanStatus === 'NPA_CLOSED' || cleanStatus === 'NPA CLOSED' || cleanStatus === 'NPA';
        const npaRec = npaRecordByLoanId.get(loan.loan_id) || npaRecordByLoanId.get(loan.id);

        if (isNpaClosed) {
          const loanAmt = Number(loan.amount || (npaRec ? npaRec.loan_amount : 0));
          const closingAmt = npaRec ? Number(npaRec.settlement_amount || 0) : 0;
          const pendInt = npaRec ? Number(npaRec.interest_due || 0) : 0;
          const pendPen = npaRec ? Number(npaRec.penalty_due || 0) : 0;
          const totCustomerPaid = entries
            .filter(e => Number(e.credit || 0) > 0 && e.account_name !== 'CD Amount Paid' && e.entry_type !== 'NPA_WRITEOFF' && e.account_name !== 'CD LOAN RECEIVABLE A/C')
            .reduce((sum, e) => sum + Number(e.credit || 0), 0);

          acc.positions.push({
            id: loan.id,
            loan_id: loan.loan_id,
            customer_name: borrower.name || '',
            loan_category: loan.loan_category || 'CD',
            loan_type: 'CD',
            loan_amount: loanAmt,
            current_principal: loanAmt,
            loan_date: originalLoanDateStr,
            current_due_date: '',
            interest_paid: interestPaid,
            pending_interest: pendInt,
            penalty: pendPen,
            penalty_paid: penaltyPaid,
            present_due: 0,
            due_days: 0,
            is_npa: true,
            phone,
            g1_name,
            g1_phone,
            g2_name,
            g2_phone,
            partner_name: borrower.partner_name || 'Unassigned',
            status: loan.status,
            customer_id: loan.customer_id,
            guarantor_1_id: loan.guarantor_1_id,
            guarantor_2_id: loan.guarantor_2_id,
            closing_amount: closingAmt,
            total_paid: npaRec && npaRec.paid_amount ? Number(npaRec.paid_amount) : totCustomerPaid,
            pending_penalty: pendPen,
            original_loan_amount: originalLoanAmount,
            opening_interest: openingInterest
          });
          return acc;
        }

        const pos = financeCalculationService.getCDAccountPosition(loan, entries, interests, asOfDate);

        acc.positions.push({
          id: loan.id,
          loan_id: loan.loan_id,
          customer_name: borrower.name || '',
          loan_category: loan.loan_category || 'CD',
          loan_type: 'CD',
          loan_amount: Number(loan.amount),
          current_principal: pos.principalBalance,
          loan_date: originalLoanDateStr,
          current_due_date: pos.currentDueDate,
          interest_paid: interestPaid,
          pending_interest: pos.accruedInterest,
          penalty: pos.accruedPenalty,
          penalty_paid: penaltyPaid,
          present_due: pos.todayDue, // Preserving signed accrued interest + penalty
          due_days: pos.displayDueDays,
          is_npa: pos.displayDueDays > 90,
          phone,
          g1_name,
          g1_phone,
          g2_name,
          g2_phone,
          partner_name: borrower.partner_name || 'Unassigned',
          status: loan.status,
          customer_id: loan.customer_id,
          guarantor_1_id: loan.guarantor_1_id,
          guarantor_2_id: loan.guarantor_2_id,
          closing_amount: Math.round(pos.principalBalance + pos.accruedInterest + pos.accruedPenalty),
          total_paid: entries.filter(e => Number(e.credit || 0) > 0 && e.account_name !== 'CD Amount Paid').reduce((sum, e) => sum + Number(e.credit || 0), 0),
          pending_penalty: pos.accruedPenalty,
          original_loan_amount: originalLoanAmount,
          opening_interest: openingInterest
        });
      } catch (err: any) {
        console.error(`Error calculating CD Account Position for loan ${loan.loan_id} (${loan.id}):`, err);
        const disbEntry = cdLedgerEntries.filter(e => e.loan_id === loan.id).find(e => e.entry_type === 'original_loan' || e.entry_type === 'Disbursement');
        const borrower = borrowerMap.get(loan.customer_id) || {};
        acc.integrityErrors.push({
          loanId: loan.id,
          loanNumber: loan.loan_id,
          borrowerName: borrower.name || 'Unknown',
          errorCode: err.code || 'CALCULATION_ERROR',
          message: err.message || 'Unknown error during CD calculations',
          loanDate: disbEntry ? disbEntry.entry_date.split('T')[0] : loan.date.split('T')[0],
          earliestTransactionDate: cdLedgerEntries
            .filter(e => e.loan_id === loan.id && (e.credit > 0 || e.debit > 0))
            .reduce((min, e) => !min || e.entry_date.split('T')[0] < min ? e.entry_date.split('T')[0] : min, '')
        });
      }
      return acc;
    }, { positions: [], integrityErrors: [] } as { positions: any[], integrityErrors: any[] });

    return results as any;
  }

  async getDuesLedgerSummary(todayDate?: string, onlyLoanIds?: string[]): Promise<{ dues: any[], integrityErrors: any[] }> {
    try {
      const targetDate = todayDate || getLocalBusinessDateISO();
      if (onlyLoanIds && onlyLoanIds.length === 0) return { dues: [], integrityErrors: [] };

      // 1. Fetch all Active CD Due Positions
      const cdPositions = await this.getActiveCDDuePositions(targetDate, onlyLoanIds);

      // 2. Fetch all Active Non-CD loans
      let nonCdQuery = supabase
        .from('finance_loans')
        .select('*')
        .not('loan_id', 'like', 'CD%');
      // Optional: only these loans (same calculation, fewer rows)
      if (onlyLoanIds) nonCdQuery = nonCdQuery.in('id', onlyLoanIds);
      const { data: nonCdLoans, error: loansErr } = await nonCdQuery;

      if (loansErr) throw loansErr;

      let nonCdResults: any[] = [];

      if (nonCdLoans && nonCdLoans.length > 0) {
        // Fetch all borrowers for non-CD
        const { data: borrowers, error: borrowersErr } = await supabase
          .from('finance_customers')
          .select('*');
        if (borrowersErr) throw borrowersErr;
        const borrowerMap = new Map<string, any>((borrowers || []).map(b => [b.id, b]));

        // Fetch unpaid due entries for non-CD
        const { data: dueEntries, error: duesErr } = await supabase
          .from('finance_dues')
          .select('*')
          .neq('status', 'Paid');
        if (duesErr) throw duesErr;

        // Fetch ledger settings
        let ledgerSettings: any[] = [];
        try {
          const { data, error } = await supabase
            .from('finance_ledger_settings')
            .select('*');
          if (!error && data) {
            ledgerSettings = data;
          }
        } catch (err) {
          console.warn('Could not fetch ledger settings:', err);
        }

        // HP loans are worked out from their receipts by the HP engine (they have no dues rows)
        const isHPRow = (l: any) => String(l.loan_category || '').trim().toUpperCase() === 'HP'
          || (!l.loan_category && String(l.loan_id || '').toUpperCase().startsWith('HP'));
        const hpIds = nonCdLoans.filter(isHPRow).map((l: any) => l.id);
        const hpTxByLoan = new Map<string, any[]>();
        for (let i = 0; i < hpIds.length; i += 200) {
          const chunk = hpIds.slice(i, i + 200);
          const { data: hpTxs, error: hpTxErr } = await supabase
            .from('finance_transactions')
            .select('*')
            .in('loan_id', chunk);
          if (hpTxErr) throw hpTxErr;
          (hpTxs || []).forEach((t: any) => {
            const list = hpTxByLoan.get(t.loan_id) || [];
            list.push(t);
            hpTxByLoan.set(t.loan_id, list);
          });
        }

        nonCdResults = nonCdLoans.map(loan => {
          const dueItem: any = isHPRow(loan)
            ? FinanceCalculationEngine.buildHPDueItem(loan, borrowerMap, hpTxByLoan.get(loan.id) || [], targetDate)
            : FinanceCalculationEngine.buildNonCdDueItem(
              loan,
              borrowerMap,
              dueEntries,
              ledgerSettings,
              targetDate
            );

          return {
            id: dueItem.id,
            loan_id: dueItem.loanId,
            customer_name: dueItem.customerName,
            loan_category: dueItem.loanCategory,
            loan_type: dueItem.loanType,
            loan_amount: dueItem.loanAmount,
            current_principal: dueItem.currentPrincipal,
            loan_date: dueItem.loanDate,
            current_due_date: dueItem.currentDueDate,
            interest_paid: dueItem.interestPaid,
            pending_interest: dueItem.pendingInterest,
            penalty: dueItem.penalty,
            penalty_paid: dueItem.penaltyPaid,
            present_due: dueItem.presentDue,
            due_days: dueItem.dueDays,
            is_npa: dueItem.isNPA,
            phone: dueItem.phone,
            g1_name: dueItem.g1Name,
            g1_phone: dueItem.g1Phone,
            g2_name: dueItem.g2Name,
            g2_phone: dueItem.g2Phone,
            partner_name: dueItem.partnerName,
            status: dueItem.status,
            customer_id: dueItem.customer_id,
            guarantor_1_id: dueItem.guarantor_1_id,
            guarantor_2_id: dueItem.guarantor_2_id,
            closing_amount: dueItem.closingAmount ?? (dueItem.currentPrincipal + dueItem.pendingInterest + dueItem.penalty),
            total_paid: dueItem.totalPaid ?? (dueItem.interestPaid + dueItem.penaltyPaid),
            pending_penalty: dueItem.pendingPenalty ?? dueItem.penalty,
            ...(dueItem.principalPaid !== undefined ? { principal_paid: dueItem.principalPaid } : {})
          };
        });
      }

      return {
        dues: [...cdPositions.positions, ...nonCdResults],
        integrityErrors: cdPositions.integrityErrors
      };
    } catch (error) {
      console.error('Error fetching dues ledger summary:', error);
      throw error;
    }
  }

  async getOldestLoanDate(): Promise<string> {
    try {
      const { data, error } = await supabase
        .from('finance_loans')
        .select('loan_date')
        .order('loan_date', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.warn('Error fetching oldest loan date:', error);
        return '2020-01-01';
      }

      return data?.loan_date || '2020-01-01';
    } catch (err) {
      console.error('Error in getOldestLoanDate:', err);
      return '2020-01-01';
    }
  }
}

export const supabaseFinance = new SupabaseFinance();
