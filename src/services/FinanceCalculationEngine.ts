import { supabaseFinance, fetchAllPages } from '../lib/supabaseFinance';
import { supabase } from '../lib/supabase';
import { financeCalculationService } from './financeCalculationService';
import { dailyFinancialTransactionService, normalizeHeadOfAccount } from './dailyFinancialTransactionService';
import { getLocalBusinessDateISO } from '../utils/dateUtils';
import { computeHPPosition, hpPaymentsFromTransactions } from './hpLedgerEngine';

/**
 * Finance Calculation Engine
 * 
 * Single source of truth for all financial math in the system.
 * Replaces duplicated local map/reduce logic across reports.
 */

export interface DashboardMetrics {
  totalDisbursed: number;
  activeLoansCount: number;
  totalLoansCount: number;
  avgLoanAmount: number;
  largestLoanAmount: number;

  totalOutstanding: number;
  outstandingPrincipal: number;
  pendingInterest: number;
  pendingPenalty: number;
  pendingCharges: number;

  collectedTodayTotal: number;
  collectedTodayPrincipal: number;
  collectedTodayInterest: number;
  collectedTodayPenalty: number;
  collectedTodayCharges: number;

  overdueLoansCount: number;
  totalOverdueAmount: number;
  highestOverdueAmount: number;
  criticalOverdueCount: number;

  recentLoans: any[];
  pendingApprovalsCount: number;
}

export interface LoanMetrics {
  loanId: string;
  principalFinanced: number;
  principalCollected: number;
  interestEarned: number;
  penaltyEarned: number;
  outstanding: number;
  presentDue: number;
  pendingInterest: number;
  pendingPenalty: number;
  status: string;
}

export interface OverdueDueItem {
  id: string;
  loanId: string;
  customerName: string;
  loanCategory: string;
  loanType: 'CD' | 'HP' | 'STBD' | 'TBD';
  loanAmount: number;
  currentPrincipal: number;
  loanDate: string;
  currentDueDate: string;
  interestPaid: number;
  pendingInterest: number;
  penalty: number;
  presentDue: number;
  dueDays: number;
  isNPA: boolean;
  penaltyPaid: number;
  phone: string;
  g1Name: string;
  g1Phone: string;
  g2Name: string;
  g2Phone: string;
  partnerName: string;
  status: string;
  customer_id?: string;
  guarantor_1_id?: string;
  guarantor_2_id?: string;
  closingAmount?: number;
  totalPaid?: number;
  pendingPenalty?: number;
}

export function naturalSortLoanId(idA: string, idB: string): number {
  const strA = (idA || '').trim();
  const strB = (idB || '').trim();

  // Extract alphanumeric prefix (e.g. "CD", "HP") and numeric portion
  const matchA = strA.match(/^([A-Za-z\s_-]*)(\d+)(.*)$/);
  const matchB = strB.match(/^([A-Za-z\s_-]*)(\d+)(.*)$/);

  if (matchA && matchB) {
    const prefixA = matchA[1].toUpperCase();
    const prefixB = matchB[1].toUpperCase();
    if (prefixA !== prefixB) {
      return prefixA.localeCompare(prefixB);
    }
    const numA = parseInt(matchA[2], 10);
    const numB = parseInt(matchB[2], 10);
    if (numA !== numB) {
      return numA - numB;
    }
    return strA.localeCompare(strB);
  }

  return strA.localeCompare(strB, undefined, { numeric: true, sensitivity: 'base' });
}

export type DuesReportType = 'OUTSTANDING' | 'TOTAL DUE LIST' | 'CD DUE LIST' | 'A -> B DUE LIST' | 'NPA LIST' | 'DUE DAYS';

export interface PartnerMetrics {
  partnerId: string;
  partnerName: string;
  role: string;
  netCapital: number;
  loansIntroduced: number;
  activeLoans: number;
  closedLoans: number;
  npaCount: number;
  
  // Period Metrics (based on fromDate/toDate)
  periodPrincipalFinanced: number;
  periodPrincipalCollected: number;
  periodInterestEarned: number;
  periodPenaltyEarned: number;

  // Lifetime Metrics
  lifetimePrincipalFinanced: number;
  lifetimePrincipalCollected: number;
  lifetimeInterestEarned: number;
  lifetimePenaltyEarned: number;

  // Dues & Outstanding
  outstanding: number;
  presentDue: number;
  pendingInterest: number;
  pendingPenalty: number;

  // Ratios (Approved Business Formula: Recovery % = (Principal Collected / Principal Financed) * 100)
  recoveryPct: number;
}

export interface FinalStatementAccount {
  accountName: string;
  category: 'ASSET' | 'LIABILITY' | 'CAPITAL' | 'INCOME' | 'EXPENSE';
  reportClassification: 'BALANCE_SHEET' | 'PROFIT_AND_LOSS';
  opening: number;
  credit: number;
  debit: number;
  netMovement: number;
  closing: number;
  ledgerCount: number;
  entries: any[];
}

export interface FinalStatementPLHead {
  name: string;
  opening: number;
  currentPeriod: number;
  total: number;
  percentage: number;
  ledgerCount: number;
  entries: any[];
}

export interface FinalStatementMetrics {
  openingCash: number;
  closingCash: number;
  totalInflows: number;
  totalOutflows: number;
  totalIncome: number;
  totalExpenses: number;
  netProfit: number;
  totalAssets: number;
  totalLoanPrincipal: number;
  totalLiabilities: number;
  totalCapital: number;
  totalLiabilitiesAndCapital: number;
  netWorth: number;
  incomeHeads: FinalStatementPLHead[];
  expenseHeads: FinalStatementPLHead[];
  accounts: FinalStatementAccount[];
}

export class FinanceCalculationEngine {
  
  /**
   * Evaluates if a loan is considered active/open for outstanding calculations
   */
  static isActiveOrNpa(status: string, isNpa?: boolean): boolean {
    if (isNpa) return false;
    const s = (status || '').trim().toUpperCase();
    if (s === 'CLOSED' || s === 'NPA_CLOSED' || s === 'NPA CLOSED' || s === 'NPA' || s === 'WRITTEN_OFF' || s === 'WRITTEN OFF') return false;
    return s === 'ACTIVE';
  }

  /**
   * Computes standardized metrics for a single loan.
   */
  static computeLoanMetrics(loan: any, dues: any[]): LoanMetrics {
    const due = dues.find(d => d.loan_id === loan.loan_id || d.loanId === loan.id || d.id === loan.id);
    const p = Number(loan.amount) || 0;
    
    const rawStatus = (loan.status || '').trim().toUpperCase();
    const isNpaClosed = rawStatus === 'NPA_CLOSED' || 
                        rawStatus === 'NPA CLOSED' || 
                        rawStatus === 'NPA' ||
                        rawStatus === 'WRITTEN_OFF' ||
                        rawStatus === 'WRITTEN OFF' ||
                        loan.npa_closed === true ||
                        (loan as any).is_npa_closed === true;

    const isClosed = rawStatus === 'CLOSED' || isNpaClosed;

    const isActive = !isClosed && (rawStatus === 'ACTIVE' || rawStatus === 'OPEN');
    
    // For NPA CLOSED or regular CLOSED, current outstanding positions MUST BE ZERO:
    const outstanding = isActive 
      ? (due ? Number(due.current_principal ?? due.currentPrincipal ?? due.principal ?? 0) : p)
      : 0;

    const presentDue = isActive && due ? Number(due.present_due ?? due.presentDue ?? due.totalPending ?? 0) : 0;
    const pendingInterest = isActive && due ? Number(due.pending_interest ?? due.pendingInterest ?? due.interestPending ?? 0) : 0;
    const pendingPenalty = isActive && due ? Number(due.penalty ?? due.pending_penalty ?? due.penaltyPending ?? 0) : 0;
    
    const interestEarned = due ? Number(due.interest_paid || 0) : 0;
    const penaltyEarned = due ? Number(due.penalty_paid || 0) : 0;
    const principalCollected = due ? Number(due.principal_paid || 0) : 0;

    return {
      loanId: loan.id,
      principalFinanced: p,
      principalCollected,
      interestEarned,
      penaltyEarned,
      outstanding,
      presentDue,
      pendingInterest,
      pendingPenalty,
      status: loan.status
    };
  }

  /**
   * Builds an OverdueDueItem from raw loan & ledger data for CD loans.
   */
  static buildCDDueItem(
    loan: any,
    pos: any,
    interestPaid: number,
    penaltyPaid: number,
    borrowerMap: Map<string, any>,
    disbEntryDate?: string,
    npaRecord?: any
  ): OverdueDueItem {
    const borrower = borrowerMap.get(loan.customer_id) || {};
    const g1 = borrowerMap.get(loan.guarantor_1_id) || {};
    const g2 = borrowerMap.get(loan.guarantor_2_id) || {};

    const phone = borrower.phone || borrower.phone_1 || borrower.phone_2 || '';
    const g1_name = g1.name || '';
    const g1_phone = g1.phone || g1.phone_1 || g1.phone_2 || '';
    const g2_name = g2.name || '';
    const g2_phone = g2.phone || g2.phone_1 || g2.phone_2 || '';

    const cleanStatus = (loan.status || '').trim().toUpperCase();
    const isNpaClosed = cleanStatus === 'NPA_CLOSED' || cleanStatus === 'NPA CLOSED' || cleanStatus === 'NPA';

    const originalLoanDateStr = disbEntryDate 
      ? disbEntryDate.split('T')[0] 
      : (loan.date ? loan.date.split('T')[0] : (loan.loan_date ? loan.loan_date.split('T')[0] : ''));

    if (isNpaClosed) {
      const loanAmt = Number(loan.amount || (npaRecord ? npaRecord.loan_amount : 0));
      const closingAmt = npaRecord ? Number(npaRecord.settlement_amount || 0) : 0;
      const pendInt = npaRecord ? Number(npaRecord.interest_due || 0) : (pos ? pos.accruedInterest : 0);
      const pendPen = npaRecord ? Number(npaRecord.penalty_due || 0) : (pos ? pos.accruedPenalty : 0);
      const totPaid = npaRecord ? Number(npaRecord.paid_amount || 0) : (interestPaid + penaltyPaid);

      return {
        id: loan.id,
        loanId: loan.loan_id,
        customerName: borrower.name || loan.borrower_name || '',
        loanCategory: loan.loan_category || 'CD',
        loanType: 'CD',
        loanAmount: loanAmt,
        currentPrincipal: loanAmt,
        loanDate: originalLoanDateStr,
        currentDueDate: '',
        interestPaid,
        pendingInterest: pendInt,
        penalty: pendPen,
        penaltyPaid,
        presentDue: 0,
        dueDays: 0,
        isNPA: true,
        phone,
        g1Name: g1_name,
        g1Phone: g1_phone,
        g2Name: g2_name,
        g2Phone: g2_phone,
        partnerName: borrower.partner_name || loan.partner_name || 'Unassigned',
        status: loan.status,
        customer_id: loan.customer_id,
        guarantor_1_id: loan.guarantor_1_id,
        guarantor_2_id: loan.guarantor_2_id,
        closingAmount: closingAmt,
        totalPaid: totPaid,
        pendingPenalty: pendPen
      };
    }

    return {
      id: loan.id,
      loanId: loan.loan_id,
      customerName: borrower.name || loan.borrower_name || '',
      loanCategory: loan.loan_category || 'CD',
      loanType: 'CD',
      loanAmount: Number(loan.amount || 0),
      currentPrincipal: pos.principalBalance,
      loanDate: originalLoanDateStr,
      currentDueDate: pos.currentDueDate || '',
      interestPaid,
      pendingInterest: pos.accruedInterest,
      penalty: pos.accruedPenalty,
      penaltyPaid,
      presentDue: pos.todayDue,
      dueDays: pos.displayDueDays,
      isNPA: pos.displayDueDays > 90,
      phone,
      g1Name: g1_name,
      g1Phone: g1_phone,
      g2Name: g2_name,
      g2Phone: g2_phone,
      partnerName: borrower.partner_name || loan.partner_name || 'Unassigned',
      status: loan.status,
      customer_id: loan.customer_id,
      guarantor_1_id: loan.guarantor_1_id,
      guarantor_2_id: loan.guarantor_2_id,
      closingAmount: Math.round(pos.principalBalance + pos.accruedInterest + pos.accruedPenalty),
      totalPaid: interestPaid + penaltyPaid,
      pendingPenalty: pos.accruedPenalty
    };
  }

  /**
   * Filters a list of OverdueDueItems according to standardized business rules.
   */
  static filterDueList(
    dues: OverdueDueItem[],
    activeReport: DuesReportType,
    selectedPartner: string,
    loanTypeFilter: 'ALL' | 'CD' | 'HP' | 'STBD' | 'TBD',
    searchName: string,
    startDate: string,
    endDate: string,
    dueDaysSort?: 'DEFAULT' | 'ASC' | 'DESC'
  ): OverdueDueItem[] {
    return dues.filter(due => {
      const cleanStatus = (due.status || '').trim().toUpperCase();
      const isNpaClosed = cleanStatus === 'NPA_CLOSED' || cleanStatus === 'NPA CLOSED' || cleanStatus === 'NPA';

      // 1. Report Type Filter
      if (activeReport === 'OUTSTANDING') {
        const isActive = due.status === 'Active';
        const isOverdue = due.presentDue > 0 || due.pendingInterest > 0 || due.penalty > 0 || due.dueDays > 0 || due.currentPrincipal > 0;
        if (!isActive || !isOverdue || isNpaClosed) return false;
      } else if (activeReport === 'TOTAL DUE LIST') {
        // Active accounts that actually have something due today
        // (no negative / zero due days, nothing paid in advance)
        if (due.status !== 'Active' || isNpaClosed) return false;
        if (!(due.dueDays > 0) || !(due.presentDue > 0)) return false;
      } else if (activeReport === 'CD DUE LIST') {
        const isActive = due.status === 'Active';
        if (due.loanType !== 'CD' || !isActive || isNpaClosed) return false;
      } else if (activeReport === 'A -> B DUE LIST') {
        const isActive = due.status === 'Active';
        if (!isActive || isNpaClosed) return false;
      } else if (activeReport === 'NPA LIST') {
        // NPA closed accounts only
        if (!isNpaClosed) return false;
      } else if (activeReport === 'DUE DAYS') {
        // Active accounts only
        const isActive = due.status === 'Active';
        if (!isActive || isNpaClosed) return false;
      }

      // 2. Date Filters for all reports
      const dateToCheck = (activeReport === 'NPA LIST' ? due.loanDate : due.currentDueDate) || due.loanDate;
      if (dateToCheck) {
        if (startDate && dateToCheck < startDate) return false;
        if (endDate && dateToCheck > endDate) return false;
      }

      // 3. Partner Filter
      if (selectedPartner !== 'ALL PARTNERS' && due.partnerName !== selectedPartner) return false;

      // 4. Loan Type Filter
      if (loanTypeFilter !== 'ALL' && due.loanType !== loanTypeFilter) return false;

      // 5. Search Filter
      if (searchName) {
        const search = searchName.toLowerCase();
        if (!due.customerName.toLowerCase().includes(search) && !due.loanId.toLowerCase().includes(search)) {
          return false;
        }
      }

      return true;
    }).sort((a, b) => {
      // 1. Due Days sort — applies across all tabs when user has clicked the Days column arrow, or by default on DUE DAYS tab
      if (dueDaysSort === 'ASC' || (activeReport === 'DUE DAYS' && dueDaysSort !== 'DESC')) {
        if (a.dueDays !== b.dueDays) return a.dueDays - b.dueDays;
        return naturalSortLoanId(a.loanId, b.loanId);
      }
      if (dueDaysSort === 'DESC') {
        if (a.dueDays !== b.dueDays) return b.dueDays - a.dueDays;
        return naturalSortLoanId(a.loanId, b.loanId);
      }

      // 2. A -> B DUE LIST: alphabetical by borrower name
      if (activeReport === 'A -> B DUE LIST') {
        const nameComp = a.customerName.localeCompare(b.customerName);
        if (nameComp !== 0) return nameComp;
        return naturalSortLoanId(a.loanId, b.loanId);
      }

      // 3. OUTSTANDING, TOTAL DUE LIST, CD DUE LIST, NPA LIST: Natural CD Number ascending
      return naturalSortLoanId(a.loanId, b.loanId);
    });
  }

  /**
   * Computes totals across a filtered due list.
   */
  static computeDueListTotals(filteredDues: OverdueDueItem[]) {
    let principal = 0, interestPaid = 0, interest = 0;
    let penaltyPaid = 0, penalty = 0, presentDue = 0, amountToClose = 0;
    let totalPaid = 0;

    filteredDues.forEach(d => {
      principal += (d.loanAmount || d.currentPrincipal || 0);
      interestPaid += (d.interestPaid || 0);
      interest += (d.pendingInterest || 0);
      penaltyPaid += (d.penaltyPaid || 0);
      penalty += (d.pendingPenalty ?? d.penalty ?? 0);
      presentDue += (d.presentDue || 0);
      amountToClose += (d.closingAmount ?? (d.currentPrincipal + d.pendingInterest + d.penalty));
      totalPaid += (d.totalPaid || 0);
    });

    return { principal, interestPaid, interest, penaltyPaid, penalty, presentDue, amountToClose, totalPaid };
  }

  /**
   * Translates raw Non-CD database records into standardized OverdueDueItems.
   */
  /**
   * Due List / Business Report row for an HP loan, from the HP engine (installment rules, per-period
   * interest, late interest and penalty). loanTxs = the loan's finance_transactions.
   */
  static buildHPDueItem(
    loan: any,
    borrowerMap: Map<string, any>,
    loanTxs: any[],
    targetDate: string
  ): OverdueDueItem & { principalPaid: number } {
    const borrower = borrowerMap.get(loan.customer_id) || {};
    const g1 = borrowerMap.get(loan.guarantor_1_id) || {};
    const g2 = borrowerMap.get(loan.guarantor_2_id) || {};
    const pos = computeHPPosition(loan, hpPaymentsFromTransactions(loanTxs), targetDate);
    const cleanStatus = (loan.status || '').trim().toUpperCase();
    const isNpaClosed = cleanStatus === 'NPA_CLOSED' || cleanStatus === 'NPA CLOSED' || cleanStatus === 'NPA';
    const active = cleanStatus === 'ACTIVE' && pos.status === 'Active';
    const interestPaid = Number((pos.interestPaid + pos.lateInterestPaid).toFixed(2));
    return {
      id: loan.id,
      loanId: loan.loan_id,
      customerName: borrower.name || '',
      loanCategory: 'HP',
      loanType: 'HP',
      loanAmount: Number(loan.amount) || 0,
      currentPrincipal: active ? pos.principalBalance : 0,
      loanDate: String(loan.date || '').split('T')[0],
      currentDueDate: (active && (pos.oldestUnpaidDueDate || pos.nextDue?.dueDate)) || String(loan.date || '').split('T')[0],
      interestPaid,
      pendingInterest: active ? Number((pos.interestDue + pos.lateInterestDue).toFixed(2)) : 0,
      penalty: active ? pos.penaltyDue : 0,
      penaltyPaid: pos.penaltyPaid,
      presentDue: active ? pos.totalDue : 0,
      dueDays: active ? pos.dueDays : 0,
      isNPA: isNpaClosed || (active && pos.isNPA),
      phone: borrower.phone || borrower.phone_1 || borrower.phone_2 || '',
      g1Name: g1.name || '',
      g1Phone: g1.phone || g1.phone_1 || g1.phone_2 || '',
      g2Name: g2.name || '',
      g2Phone: g2.phone || g2.phone_1 || g2.phone_2 || '',
      partnerName: loan.partner_name || borrower.partner_name || 'Unassigned',
      status: loan.status,
      customer_id: loan.customer_id,
      guarantor_1_id: loan.guarantor_1_id,
      guarantor_2_id: loan.guarantor_2_id,
      closingAmount: active ? pos.totalForClose : 0,
      totalPaid: Number((pos.principalPaid + interestPaid + pos.penaltyPaid).toFixed(2)),
      pendingPenalty: active ? pos.penaltyDue : 0,
      principalPaid: pos.principalPaid
    };
  }

  static buildNonCdDueItem(
    loan: any,
    borrowerMap: Map<string, any>,
    dueEntries: any[],
    ledgerSettings: any[],
    targetDate: string
  ): OverdueDueItem {
    const borrower = borrowerMap.get(loan.customer_id) || {};
    const g1 = borrowerMap.get(loan.guarantor_1_id) || {};
    const g2 = borrowerMap.get(loan.guarantor_2_id) || {};

    const loanType = loan.loan_id.startsWith('HP') ? 'HP' : (loan.loan_id.startsWith('STBD') ? 'STBD' : 'TBD');
    const phone = borrower.phone || borrower.phone_1 || borrower.phone_2 || '';
    const g1_name = g1.name || '';
    const g1_phone = g1.phone || g1.phone_1 || g1.phone_2 || '';
    const g2_name = g2.name || '';
    const g2_phone = g2.phone || g2.phone_1 || g2.phone_2 || '';

    const loanDues = dueEntries.filter(d => d.loan_id === loan.id);
    const totalRepayable = loanDues.reduce((sum, d) => sum + Number(d.amount), 0);
    const totalPaid = loanDues.reduce((sum, d) => sum + Number(d.paid_amount || 0), 0);

    let currentPrincipal = Number(loan.amount);
    if (totalRepayable > 0) {
      currentPrincipal = Number(loan.amount) - (totalPaid * (1.0 - ((totalRepayable - Number(loan.amount)) / totalRepayable)));
    }

    let interestPaid = 0;
    if (totalRepayable > 0) {
      interestPaid = totalPaid * ((totalRepayable - Number(loan.amount)) / totalRepayable);
    }

    const overdueDues = loanDues.filter(d => d.due_date <= targetDate && d.status !== 'Paid');
    const presentDuePrincipalAndInterest = overdueDues.reduce((sum, d) => sum + Number(d.amount - (d.paid_amount || 0)), 0);

    let pendingInterest = 0;
    if (totalRepayable > 0) {
      pendingInterest = presentDuePrincipalAndInterest * ((totalRepayable - Number(loan.amount)) / totalRepayable);
    }

    const unpaidDues = loanDues.filter(d => d.status !== 'Paid');
    const oldestDueDateStr = unpaidDues.reduce((min, d) => !min || d.due_date < min ? d.due_date : min, null as string | null);
    const dueDaysRaw = oldestDueDateStr ? financeCalculationService.differenceInCalendarDays(targetDate, oldestDueDateStr) : 0;
    const dueDays = Math.max(0, dueDaysRaw);
    const isNpa = dueDaysRaw > 90;

    const categorySetting = (ledgerSettings || []).find(s => s.code === loan.loan_category) || 
                            (ledgerSettings || []).find(s => s.code === loanType) || 
                            { overdue: 24, days_per_year: 365 };

    let penalty = 0;
    if (dueDays > 5) {
      const daysPerMonth = categorySetting.days_per_year / 12.0;
      penalty = Math.round(presentDuePrincipalAndInterest * (categorySetting.overdue / 100.0) * (dueDays / daysPerMonth));
    }

    return {
      id: loan.id,
      loanId: loan.loan_id,
      customerName: borrower.name || '',
      loanCategory: loan.loan_category || loanType,
      loanType: loanType as any,
      loanAmount: Number(loan.amount),
      currentPrincipal: currentPrincipal,
      loanDate: loan.date.split('T')[0],
      currentDueDate: oldestDueDateStr || loan.date.split('T')[0],
      interestPaid: interestPaid,
      pendingInterest: pendingInterest,
      penalty: penalty,
      penaltyPaid: 0,
      presentDue: presentDuePrincipalAndInterest + penalty,
      dueDays: dueDays,
      isNPA: isNpa,
      phone,
      g1Name: g1_name,
      g1Phone: g1_phone,
      g2Name: g2_name,
      g2Phone: g2_phone,
      partnerName: borrower.partner_name || 'Unassigned',
      status: loan.status,
      customer_id: loan.customer_id,
      guarantor_1_id: loan.guarantor_1_id,
      guarantor_2_id: loan.guarantor_2_id
    };
  }

  /**
   * Analyzes all loans and computes exact mathematical totals for ALL partners.
   * This prevents N+1 queries by fetching data once.
   */
  static async computeAllPartnersMetrics(
    partners: { id: string; name: string; is_md: boolean }[],
    fromDate: string, 
    toDate: string
  ): Promise<PartnerMetrics[]> {
    
    const allLoans = await supabaseFinance.getLoans();
    const { dues } = await supabaseFinance.getDuesLedgerSummary(toDate);
    const capEntries = await fetchAllPages<any>((from, to) => supabase.from('finance_capital_entries').select('*').range(from, to));
    const cdEntries = await fetchAllPages<any>((from, to) => supabase.from('finance_cd_ledger_entries').select('*').range(from, to));

    return partners.map(partner => {
      const partnerId = partner.id;
      const partnerName = partner.name;
      const isMd = partner.is_md;

      // 1. Filter Loans to Partner
      const pLoans = allLoans.filter(l => {
        if (l.partner_id) return l.partner_id === partnerId;
        if ((l.customer as any)?.partner_id) return (l.customer as any).partner_id === partnerId;
        
        const pName = partnerName.trim().toUpperCase();
        const rawPartner = ((l as any).partner_name || l.customer?.partner_name || '').trim().toUpperCase();
        if (rawPartner) return rawPartner === pName;
        
        return isMd; // Unassigned fall to MD
      });

    const pLoanIds = new Set(pLoans.map(l => l.id).concat(pLoans.map(l => l.loan_id).filter(Boolean)));

    // 2. Loan Counts & Statuses
    let activeLoans = 0, closedLoans = 0, npaCount = 0;
    pLoans.forEach(l => {
      const s = (l.status || '').trim().toUpperCase();
      const isNpaClosed = s === 'NPA' || s === 'NPA_CLOSED' || s === 'NPA CLOSED' || l.npa_closed === true || (l as any).is_npa === true;
      
      if (isNpaClosed) {
        npaCount++;
      } else if (s === 'CLOSED') {
        closedLoans++;
      } else {
        activeLoans++;
      }
    });

    // 3. Loans in Period
    const pLoansInRange = pLoans.filter(l => {
      const lDate = l.date ? l.date.split('T')[0] : '';
      return (!fromDate || lDate >= fromDate) && (!toDate || lDate <= toDate);
    });

    const loansIntroduced = pLoansInRange.length;
    const periodPrincipalFinanced = pLoansInRange.reduce((sum, l) => sum + (Number(l.amount) || 0), 0);
    const lifetimePrincipalFinanced = pLoans.reduce((sum, l) => sum + (Number(l.amount) || 0), 0);

    // 4. Capital in Period
    let netCapital = 0;
    (capEntries || []).forEach(c => {
      const cDate = c.entry_date ? c.entry_date.split('T')[0] : '';
      if ((!fromDate || cDate >= fromDate) && (!toDate || cDate <= toDate)) {
        const isMatch = c.partner_id === partnerId || 
          (c.partner_name && c.partner_name.trim().toUpperCase() === partnerName.trim().toUpperCase()) ||
          (isMd && (!c.partner_id && !c.partner_name));
        
        if (isMatch) {
          netCapital += (Number(c.credit) || 0) - (Number(c.debit) || 0);
        }
      }
    });

    // 5. Ledger Collections
    let periodPrincipalCollected = 0, periodInterestEarned = 0, periodPenaltyEarned = 0;
    let lifetimePrincipalCollected = 0, lifetimeInterestEarned = 0, lifetimePenaltyEarned = 0;

    (cdEntries || []).forEach(entry => {
      if (!pLoanIds.has(entry.loan_id)) return;
      
      const cr = Number(entry.credit) || 0;
      const dr = Number(entry.debit) || 0;
      const net = cr - dr;
      const acc = (entry.account_name || '').trim();

      const isPrincipal = acc === 'CD A/C' || acc === 'CD PRINCIPAL' || acc === 'CD Amount Paid';
      const isInterest = acc === 'CD COMMISSION A/C' || acc === 'CD INTEREST';
      const isPenalty = acc === 'PENALTY A/C' || acc === 'CD PENALTY';

      if (isPrincipal) lifetimePrincipalCollected += net;
      if (isInterest) lifetimeInterestEarned += net;
      if (isPenalty) lifetimePenaltyEarned += net;

      const eDate = entry.entry_date || entry.date || '';
      if ((!fromDate || eDate >= fromDate) && (!toDate || eDate <= toDate)) {
        if (isPrincipal) periodPrincipalCollected += net;
        if (isInterest) periodInterestEarned += net;
        if (isPenalty) periodPenaltyEarned += net;
      }
    });

    // 6. Outstanding & Dues
    let outstanding = 0, presentDue = 0, pendingInterest = 0, pendingPenalty = 0;
    
    pLoans.forEach(l => {
      const due = dues.find(d => d.loan_id === l.loan_id || d.loanId === l.id || d.id === l.id);
      if (this.isActiveOrNpa(l.status, l.npa_closed === true || (l as any).is_npa === true)) {
        if (due) {
          outstanding += Number(due.current_principal || due.currentPrincipal || due.principal || 0);
          presentDue += Number(due.present_due || due.presentDue || due.totalPending || 0);
          pendingInterest += Number(due.pending_interest || due.pendingInterest || 0);
          pendingPenalty += Number(due.penalty || due.penaltyPending || 0);
        } else {
          outstanding += Number(l.amount) || 0;
        }
      }
    });

    // 7. Ratios (Approved Business Formula: Recovery % = (Principal Collected / Principal Financed) * 100)
    const recoveryPct = lifetimePrincipalFinanced > 0 ? (lifetimePrincipalCollected / lifetimePrincipalFinanced) * 100 : 0;

      return {
        partnerId,
        partnerName,
        role: isMd ? 'MD' : 'Partner',
        netCapital,
        loansIntroduced,
        activeLoans,
        closedLoans,
        npaCount,
        periodPrincipalFinanced,
        periodPrincipalCollected,
        periodInterestEarned,
        periodPenaltyEarned,
        lifetimePrincipalFinanced,
        lifetimePrincipalCollected,
        lifetimeInterestEarned,
        lifetimePenaltyEarned,
        outstanding,
        presentDue,
        pendingInterest,
        pendingPenalty,
        recoveryPct,
      };
    });
  }

  /**
   * Centralized method to compute reconciled metrics for the Finance Dashboard.
   */
  static async getDashboardMetrics(asOfDate?: string): Promise<DashboardMetrics> {
    const todayStr = asOfDate || getLocalBusinessDateISO();

    const [loans, duesSummary, todayTxs, pendingApprovalsCount] = await Promise.all([
      supabaseFinance.getLoans(),
      supabaseFinance.getDuesLedgerSummary(todayStr),
      dailyFinancialTransactionService.getDailyFinancialTransactions({
        fromDate: todayStr,
        toDate: todayStr,
        financeMode: 'REGULAR',
      }).catch(err => {
        console.error('Error fetching today transactions for dashboard:', err);
        return [];
      }),
      supabaseFinance.getPendingApprovalsCount().catch(() => 0),
    ]);

    // 1. Disbursed (All Time)
    const validLoans = (loans || []).filter(l => {
      const status = (l.status || '').trim().toUpperCase();
      return status !== 'DELETED' && status !== 'CANCELLED' && status !== 'DRAFT' && status !== 'FAILED' && status !== 'REJECTED' && !(l as any).deleted_at;
    });

    const totalDisbursed = validLoans.reduce((sum, l) => sum + Number(l.amount || 0), 0);
    const activeLoansCount = validLoans.filter(l => (l.status || '').trim().toUpperCase() === 'ACTIVE').length;
    const totalLoansCount = validLoans.length;
    const avgLoanAmount = totalLoansCount > 0 ? Math.round(totalDisbursed / totalLoansCount) : 0;
    const largestLoanAmount = validLoans.reduce((max, l) => Math.max(max, Number(l.amount || 0)), 0);

    // 2. Outstanding & Overdue Calculations
    let outstandingPrincipal = 0;
    let pendingInterest = 0;
    let pendingPenalty = 0;
    let pendingCharges = 0;

    let overdueLoansCount = 0;
    let totalOverdueAmount = 0;
    let highestOverdueAmount = 0;
    let criticalOverdueCount = 0;

    const dues = duesSummary?.dues || [];
    dues.forEach((due: any) => {
      const status = (due.status || '').trim().toUpperCase();
      const isActive = status === 'ACTIVE' || status === 'NPA_CLOSED' || status === 'NPA CLOSED' || status === 'NPA';
      
      if (isActive) {
        const p = Number(due.currentPrincipal || due.current_principal || due.principal || 0);
        const i = Number(due.pendingInterest || due.pending_interest || due.interestPending || 0);
        const pen = Number(due.penalty || due.penaltyPending || 0);
        const chg = Number(due.doc_charges || due.charges || 0);

        outstandingPrincipal += p;
        pendingInterest += i;
        pendingPenalty += pen;
        pendingCharges += chg;

        const dueDays = Number(due.dueDays || due.due_days || 0);
        const presentDue = Number(due.presentDue || due.present_due || 0);
        const isOverdue = status === 'ACTIVE' && (dueDays > 0 || presentDue > 0);

        if (isOverdue) {
          overdueLoansCount++;
          const accountOverdueTotal = presentDue > 0 ? presentDue : (p + i + pen);
          totalOverdueAmount += accountOverdueTotal;
          highestOverdueAmount = Math.max(highestOverdueAmount, accountOverdueTotal);
          if (dueDays > 90 || due.isNPA || due.is_npa) {
            criticalOverdueCount++;
          }
        }
      }
    });

    const totalOutstanding = outstandingPrincipal + pendingInterest + pendingPenalty + pendingCharges;

    // 3. Collected Today Breakdown
    let collectedTodayTotal = 0;
    let collectedTodayPrincipal = 0;
    let collectedTodayInterest = 0;
    let collectedTodayPenalty = 0;
    let collectedTodayCharges = 0;

    (todayTxs || []).forEach(tx => {
      const credit = Number(tx.credit) || 0;
      if (credit > 0) {
        collectedTodayTotal += credit;
        const normHead = normalizeHeadOfAccount(tx.headOfAccount || tx.particulars || '');
        if (normHead.includes('PRINCIPAL')) {
          collectedTodayPrincipal += credit;
        } else if (normHead.includes('INTEREST')) {
          collectedTodayInterest += credit;
        } else if (normHead.includes('PENALTY')) {
          collectedTodayPenalty += credit;
        } else if (normHead.includes('CHARGES')) {
          collectedTodayCharges += credit;
        } else {
          const part = (tx.particulars || '').toUpperCase();
          if (part.includes('INTEREST') || part.includes('COMMISSION')) {
            collectedTodayInterest += credit;
          } else if (part.includes('PENALTY')) {
            collectedTodayPenalty += credit;
          } else if (part.includes('CHARGES')) {
            collectedTodayCharges += credit;
          } else {
            collectedTodayPrincipal += credit;
          }
        }
      }
    });

    return {
      totalDisbursed,
      activeLoansCount,
      totalLoansCount,
      avgLoanAmount,
      largestLoanAmount,
      totalOutstanding,
      outstandingPrincipal,
      pendingInterest,
      pendingPenalty,
      pendingCharges,
      collectedTodayTotal,
      collectedTodayPrincipal,
      collectedTodayInterest,
      collectedTodayPenalty,
      collectedTodayCharges,
      overdueLoansCount,
      totalOverdueAmount,
      highestOverdueAmount,
      criticalOverdueCount,
      recentLoans: validLoans.slice(0, 8),
      pendingApprovalsCount,
    };
  }

  /**
   * Compiles reconciled Final Statement & Balance Sheet metrics
   */
  static async getFinalStatementMetrics(
    fromDate: string,
    toDate: string,
    financeMode: 'REGULAR' | 'ITR' = 'REGULAR'
  ): Promise<FinalStatementMetrics> {
    // 1. Fetch prior transactions for opening cash & opening balances
    const prevDateLimit = new Date(fromDate);
    prevDateLimit.setDate(prevDateLimit.getDate() - 1);
    const prevDateLimitStr = prevDateLimit.toISOString().split('T')[0];

    let prevTxs: any[] = [];
    if (fromDate > '1970-01-01') {
      prevTxs = await dailyFinancialTransactionService.getDailyFinancialTransactions({
        fromDate: '1970-01-01',
        toDate: prevDateLimitStr,
        financeMode
      });
    }

    // 2. Fetch date range transactions
    const rangeTxs = await dailyFinancialTransactionService.getDailyFinancialTransactions({
      fromDate,
      toDate,
      financeMode
    });

    // Helper for principal/capital exclusions from P&L
    const isPrincipalOrCapitalHead = (headName: string): boolean => {
      const upper = (headName || '').toUpperCase();
      return (
        upper.includes('DISBURSEMENT') ||
        upper.includes('PRINCIPAL') ||
        upper.includes('RECEIVABLE') ||
        upper.includes('COLLECTION') ||
        upper === 'CD A/C' ||
        upper === 'CAPITAL' ||
        upper.startsWith('CAPITAL') ||
        upper.startsWith('BANK') ||
        upper.endsWith('BANK')
      );
    };

    // Calculate cash balances
    let prevCash = 0;
    prevTxs.forEach(t => {
      prevCash += (Number(t.credit || 0) - Number(t.debit || 0));
    });
    const openingCash = prevCash;

    let totalInflows = 0;
    let totalOutflows = 0;
    rangeTxs.forEach(t => {
      totalInflows += Number(t.credit || 0);
      totalOutflows += Number(t.debit || 0);
    });
    const closingCash = openingCash + totalInflows - totalOutflows;

    // 3. Compute Profit & Loss Head Details
    const prevIncomeMap = new Map<string, number>();
    const prevExpenseMap = new Map<string, number>();

    prevTxs.forEach(t => {
      const head = t.headOfAccount || 'UNCLASSIFIED';
      if (isPrincipalOrCapitalHead(head)) return;

      if (t.reportClassification === 'PROFIT_AND_LOSS') {
        const cr = Number(t.credit || 0);
        const dr = Number(t.debit || 0);
        if (cr > 0) prevIncomeMap.set(head, (prevIncomeMap.get(head) || 0) + (cr - dr));
        if (dr > 0) prevExpenseMap.set(head, (prevExpenseMap.get(head) || 0) + (dr - cr));
      }
    });

    const incomeEntriesMap = new Map<string, any[]>();
    const expenseEntriesMap = new Map<string, any[]>();

    rangeTxs.forEach(t => {
      const head = t.headOfAccount || 'UNCLASSIFIED';
      if (isPrincipalOrCapitalHead(head)) return;

      if (t.reportClassification === 'PROFIT_AND_LOSS') {
        const cr = Number(t.credit || 0);
        const dr = Number(t.debit || 0);
        if (cr > 0) {
          if (!incomeEntriesMap.has(head)) incomeEntriesMap.set(head, []);
          incomeEntriesMap.get(head)!.push(t);
        }
        if (dr > 0) {
          if (!expenseEntriesMap.has(head)) expenseEntriesMap.set(head, []);
          expenseEntriesMap.get(head)!.push(t);
        }
      }
    });

    const allIncomeHeadNames = new Set<string>([
      ...Array.from(prevIncomeMap.keys()),
      ...Array.from(incomeEntriesMap.keys())
    ]);

    const allExpenseHeadNames = new Set<string>([
      ...Array.from(prevExpenseMap.keys()),
      ...Array.from(expenseEntriesMap.keys())
    ]);

    let totalIncome = 0;
    allIncomeHeadNames.forEach(head => {
      const entries = incomeEntriesMap.get(head) || [];
      entries.forEach(e => totalIncome += (Number(e.credit || 0) - Number(e.debit || 0)));
    });

    let totalExpenses = 0;
    allExpenseHeadNames.forEach(head => {
      const entries = expenseEntriesMap.get(head) || [];
      entries.forEach(e => totalExpenses += (Number(e.debit || 0) - Number(e.credit || 0)));
    });

    const incomeHeads: FinalStatementPLHead[] = Array.from(allIncomeHeadNames).map(head => {
      const op = prevIncomeMap.get(head) || 0;
      const entries = incomeEntriesMap.get(head) || [];
      const curr = entries.reduce((sum, e) => sum + (Number(e.credit || 0) - Number(e.debit || 0)), 0);
      const tot = op + curr;
      const pct = totalIncome > 0 ? (curr / totalIncome) * 100 : 0;
      return {
        name: head,
        opening: parseFloat(op.toFixed(2)),
        currentPeriod: parseFloat(curr.toFixed(2)),
        total: parseFloat(tot.toFixed(2)),
        percentage: parseFloat(pct.toFixed(1)),
        ledgerCount: entries.length,
        entries
      };
    });

    const expenseHeads: FinalStatementPLHead[] = Array.from(allExpenseHeadNames).map(head => {
      const op = prevExpenseMap.get(head) || 0;
      const entries = expenseEntriesMap.get(head) || [];
      const curr = entries.reduce((sum, e) => sum + (Number(e.debit || 0) - Number(e.credit || 0)), 0);
      const tot = op + curr;
      const pct = totalExpenses > 0 ? (curr / totalExpenses) * 100 : 0;
      return {
        name: head,
        opening: parseFloat(op.toFixed(2)),
        currentPeriod: parseFloat(curr.toFixed(2)),
        total: parseFloat(tot.toFixed(2)),
        percentage: parseFloat(pct.toFixed(1)),
        ledgerCount: entries.length,
        entries
      };
    });

    incomeHeads.sort((a, b) => b.currentPeriod - a.currentPeriod);
    expenseHeads.sort((a, b) => b.currentPeriod - a.currentPeriod);

    const netProfit = totalIncome - totalExpenses;

    // 4. Collect all General Ledger Account Heads
    const allGLHeads = new Set<string>();
    prevTxs.forEach(t => {
      if (t.headOfAccount) allGLHeads.add(t.headOfAccount);
    });
    rangeTxs.forEach(t => {
      if (t.headOfAccount) allGLHeads.add(t.headOfAccount);
    });

    const accounts: FinalStatementAccount[] = Array.from(allGLHeads).map(head => {
      let op = 0;
      prevTxs.filter(t => t.headOfAccount === head).forEach(t => {
        op += (Number(t.credit || 0) - Number(t.debit || 0));
      });

      let cr = 0;
      let dr = 0;
      const entries = rangeTxs.filter(t => t.headOfAccount === head);
      entries.forEach(t => {
        cr += Number(t.credit || 0);
        dr += Number(t.debit || 0);
      });

      const netMovement = cr - dr;
      const closing = op + netMovement;

      const headUpper = head.toUpperCase();
      let category: 'ASSET' | 'LIABILITY' | 'CAPITAL' | 'INCOME' | 'EXPENSE' = 'ASSET';
      let reportClassification: 'BALANCE_SHEET' | 'PROFIT_AND_LOSS' = 'BALANCE_SHEET';

      if (headUpper.startsWith('CAPITAL') || headUpper.includes('EQUITY')) {
        category = 'CAPITAL';
        reportClassification = 'BALANCE_SHEET';
      } else if (headUpper.includes('DISBURSEMENT') || headUpper.includes('PRINCIPAL') || headUpper.includes('RECEIVABLE') || headUpper.includes('LOAN') || headUpper.includes('BANK') || headUpper.includes('CASH') || headUpper.includes('ASSET')) {
        category = 'ASSET';
        reportClassification = 'BALANCE_SHEET';
      } else if (headUpper.includes('BORROWING') || headUpper.includes('PAYABLE') || headUpper.includes('LIABILITY') || headUpper.includes('SUSPENSE')) {
        category = 'LIABILITY';
        reportClassification = 'BALANCE_SHEET';
      } else if (headUpper.includes('INTEREST') || headUpper.includes('PENALTY') || headUpper.includes('DOCUMENT CHARGES') || headUpper.includes('COMMISSION') || headUpper.includes('INCOME')) {
        category = 'INCOME';
        reportClassification = 'PROFIT_AND_LOSS';
      } else {
        const sampleTx = entries[0] || prevTxs.find(t => t.headOfAccount === head);
        if (sampleTx?.reportClassification === 'PROFIT_AND_LOSS' || (!isPrincipalOrCapitalHead(head) && (dr > 0 || cr > 0))) {
          category = cr >= dr ? 'INCOME' : 'EXPENSE';
          reportClassification = 'PROFIT_AND_LOSS';
        } else {
          category = closing <= 0 ? 'ASSET' : 'LIABILITY';
          reportClassification = 'BALANCE_SHEET';
        }
      }

      return {
        accountName: head,
        category,
        reportClassification,
        opening: parseFloat(op.toFixed(2)),
        credit: parseFloat(cr.toFixed(2)),
        debit: parseFloat(dr.toFixed(2)),
        netMovement: parseFloat(netMovement.toFixed(2)),
        closing: parseFloat(closing.toFixed(2)),
        ledgerCount: entries.length,
        entries
      };
    });

    accounts.sort((a, b) => a.accountName.localeCompare(b.accountName));

    // 5. Calculate Balance Sheet Totals
    const loanPrincipalAccounts = accounts.filter(acc => 
      acc.category === 'ASSET' && (
        acc.accountName.toUpperCase().includes('DISBURSEMENT') ||
        acc.accountName.toUpperCase().includes('PRINCIPAL') ||
        acc.accountName.toUpperCase().includes('RECEIVABLE')
      )
    );
    const totalLoanPrincipal = loanPrincipalAccounts.reduce((sum, acc) => sum + Math.abs(acc.closing), 0);

    const otherAssetAccounts = accounts.filter(acc => 
      acc.category === 'ASSET' && !loanPrincipalAccounts.some(lp => lp.accountName === acc.accountName)
    );
    const totalOtherAssets = otherAssetAccounts.reduce((sum, acc) => sum + Math.abs(acc.closing), 0);

    const totalAssets = totalLoanPrincipal + Math.max(0, closingCash) + totalOtherAssets;

    const capitalAccounts = accounts.filter(acc => acc.category === 'CAPITAL');
    const totalCapital = capitalAccounts.reduce((sum, acc) => sum + acc.closing, 0);

    const liabilityAccounts = accounts.filter(acc => acc.category === 'LIABILITY');
    const totalLiabilities = liabilityAccounts.reduce((sum, acc) => sum + Math.abs(acc.closing), 0);

    const totalLiabilitiesAndCapital = totalCapital + totalLiabilities + netProfit;
    const netWorth = totalAssets - totalLiabilities;

    return {
      openingCash: parseFloat(openingCash.toFixed(2)),
      closingCash: parseFloat(closingCash.toFixed(2)),
      totalInflows: parseFloat(totalInflows.toFixed(2)),
      totalOutflows: parseFloat(totalOutflows.toFixed(2)),
      totalIncome: parseFloat(totalIncome.toFixed(2)),
      totalExpenses: parseFloat(totalExpenses.toFixed(2)),
      netProfit: parseFloat(netProfit.toFixed(2)),
      totalAssets: parseFloat(totalAssets.toFixed(2)),
      totalLoanPrincipal: parseFloat(totalLoanPrincipal.toFixed(2)),
      totalLiabilities: parseFloat(totalLiabilities.toFixed(2)),
      totalCapital: parseFloat(totalCapital.toFixed(2)),
      totalLiabilitiesAndCapital: parseFloat(totalLiabilitiesAndCapital.toFixed(2)),
      netWorth: parseFloat(netWorth.toFixed(2)),
      incomeHeads,
      expenseHeads,
      accounts
    };
  }

}

