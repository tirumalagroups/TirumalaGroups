
import React, { useEffect, useState, useMemo } from 'react';
import Card from '../../components/UI/Card';
import Input from '../../components/UI/Input';
import Button from '../../components/UI/Button';
import { supabaseFinance, FinanceLoan, FinanceCustomer } from '../../lib/supabaseFinance';
import { Edit } from 'lucide-react';
import toast from 'react-hot-toast';
import LoanEntry from './LoanEntry';

const EditLoanEntry: React.FC = () => {
  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [loans, setLoans] = useState<(FinanceLoan & { customer: FinanceCustomer })[]>([]);
  const [selectedLoan, setSelectedLoan] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLoans();
  }, []);

  const fetchLoans = async () => {
    setLoading(true);
    try {
      const data = await supabaseFinance.getRecentLoans(200);
      setLoans(data as any);
    } catch (err) {
      console.error(err);
      toast.error('Failed to load loans directory');
    } finally {
      setLoading(false);
    }
  };

  const filteredLoans = useMemo(() => {
    if (!searchQuery) return loans;
    const q = searchQuery.toLowerCase();
    return loans.filter(l => 
      l.loan_id?.toLowerCase().includes(q) ||
      l.customer?.name?.toLowerCase().includes(q) ||
      l.customer?.phone?.toLowerCase().includes(q) ||
      l.customer?.aadhaar?.toLowerCase().includes(q)
    );
  }, [searchQuery, loans]);

  const handleSelectLoan = (loan: any) => {
    setSelectedLoan(loan);
  };

  return (
    <div className="space-y-6 p-6 max-w-7xl mx-auto">
      {selectedLoan ? (
        <LoanEntry 
          editLoanId={selectedLoan.id} 
          onCancelEdit={() => {
            setSelectedLoan(null);
            fetchLoans();
          }} 
        />
      ) : (
        // Searching & Listing View
        <div className="space-y-4">
          {/* Header */}
          <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 border-b border-slate-100 pb-5 mb-6">
            <div>
              <h1 className="finance-h1 uppercase font-bold text-slate-900 tracking-tight">EDIT LOAN LEDGER</h1>
              <p className="mt-1 finance-small-label uppercase">Modify active loan parameters, surety files, and record status updates</p>
            </div>
          </div>

          <div className="max-w-md">
            <Input
              label="Quick Search Loan Records"
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search by ID, Name, Phone, Aadhaar..."
            />
          </div>

          <Card title="Loans Ledger Index">
            {loading ? (
              <div className="flex justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-[#0b1329]"></div>
              </div>
            ) : filteredLoans.length === 0 ? (
              <div className="text-center py-8 text-slate-400 font-bold uppercase">No transactions found.</div>
            ) : (
              <div>
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-gray-50 border-b border-slate-200 text-[12px] font-black text-slate-500 uppercase tracking-wider">
                      <th className="px-3 py-3">Loan ID</th>
                      <th className="px-3 py-3">Customer</th>
                      <th className="px-3 py-3">Aadhaar</th>
                      <th className="px-3 py-3 text-right">Principal</th>
                      <th className="pl-8 pr-3 py-3">Instalment</th>
                      <th className="px-3 py-3 text-center">Status</th>
                      <th className="px-3 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-100 font-medium text-slate-700 text-[13px] min-[1600px]:text-[15px] tabular-nums">
                    {filteredLoans.map(loan => (
                      <tr key={loan.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-3 py-3 whitespace-nowrap text-gray-900 font-mono font-bold">
                          {loan.loan_id}
                        </td>
                        <td className="px-3 py-3">
                          <div className="text-gray-900 font-bold uppercase">{loan.customer?.name}</div>
                          {loan.customer?.phone && (
                            <div className="text-gray-500 font-mono mt-0.5">{loan.customer.phone}</div>
                          )}
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap text-gray-600 font-mono">
                          {loan.customer?.aadhaar || '-'}
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap text-right text-gray-900 font-bold">
                          {Number(loan.amount).toLocaleString('en-IN')}
                        </td>
                        <td className="pl-8 pr-3 py-3 whitespace-nowrap text-gray-700">
                          {loan.due_type} ({Number(loan.due_amount).toLocaleString('en-IN')})
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap text-center">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-black uppercase ${ loan.status === 'Active' ? 'bg-green-100 text-green-800 border border-green-200' : loan.status === 'NPA_CLOSED' ? 'bg-orange-100 text-orange-800 border border-orange-200' : 'bg-gray-100 text-gray-800' }`}>
                            {loan.status}
                          </span>
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap text-right">
                          <Button
                            onClick={() => handleSelectLoan(loan)}
                            variant="primary"
                            size="sm"
                            icon={Edit}
                          >
                            Edit
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
};

export default EditLoanEntry;
