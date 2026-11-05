import React, { useEffect, useState } from 'react';
import { X, User, MapPin, FileCode, FileText, ShieldAlert, History, Printer, Edit2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { formatRelationship } from '../../utils/relationship';

/**
 * Full customer details dialog (nothing hidden, full Aadhaar shown).
 * Used by Finance → Customers (View) and the CD Ledger borrower card menu.
 *
 * Pass either `customer` (a finance_customers row, optionally with `loans`) or `customerId`.
 */
export interface CustomerFullDetailsProps {
  customer?: any | null;
  customerId?: string | null;
  onClose: () => void;
  /** Optional: show a "Print Profile" button */
  onPrint?: (customer: any) => void;
  /** Optional: show an "Edit Profile" button */
  onEdit?: (customerId: string) => void;
}

const v = (x: any) => (x === null || x === undefined || String(x).trim() === '' ? '—' : String(x));

const Field: React.FC<{ label: string; value: any; mono?: boolean; wide?: boolean }> = ({ label, value, mono, wide }) => (
  <div className={wide ? 'col-span-2' : ''}>
    <div className="text-[11px] text-slate-500 uppercase font-bold">{label}</div>
    <div className={`text-[15px] font-bold text-slate-900 uppercase break-words ${mono ? 'font-mono tracking-wide' : ''}`}>{v(value)}</div>
  </div>
);

const Section: React.FC<{ icon: React.ReactNode; title: string; children: React.ReactNode }> = ({ icon, title, children }) => (
  <div className="bg-white p-3 border border-slate-200 rounded shadow-sm space-y-2">
    <h4 className="text-[13px] font-bold uppercase text-slate-800 tracking-wide flex items-center gap-1.5 border-b pb-1.5">
      {icon}
      {title}
    </h4>
    {children}
  </div>
);

const Empty: React.FC<{ text: string }> = ({ text }) => (
  <div className="p-3 bg-slate-50 text-center text-[13px] text-slate-400 font-bold uppercase">{text}</div>
);

const CustomerFullDetails: React.FC<CustomerFullDetailsProps> = ({ customer, customerId, onClose, onPrint, onEdit }) => {
  const [cust, setCust] = useState<any | null>(customer || null);
  const [loans, setLoans] = useState<any[]>(customer?.loans || []);
  const [docs, setDocs] = useState<any[]>([]);
  const [followups, setFollowups] = useState<any[]>([]);
  const [guarantors, setGuarantors] = useState<any[]>([]);
  const [previewPhoto, setPreviewPhoto] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const id = customer?.id || customerId || null;

  useEffect(() => {
    if (!id) return;
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        // Always read the full customer row so every saved field is shown
        const { data: row } = await supabase.from('finance_customers').select('*').eq('id', id).single();
        if (!alive) return;
        if (row) setCust((prev: any) => ({ ...(prev || {}), ...row }));

        let loanList: any[] = customer?.loans || [];
        if (loanList.length === 0) {
          const { data: l } = await supabase
            .from('finance_loans')
            .select('id, loan_id, loan_category, status, amount, date, guarantor_1_id, guarantor_2_id')
            .eq('customer_id', id);
          loanList = l || [];
          if (alive) setLoans(loanList);
        }
        const loanIds = loanList.map((l: any) => l.id);
        if (loanIds.length === 0) return;

        const [{ data: d }, { data: f }, { data: lg }] = await Promise.all([
          supabase.from('finance_loan_documents').select('*').in('loan_id', loanIds),
          supabase.from('finance_loan_payment_followups').select('*').in('loan_id', loanIds).order('followed_up_at', { ascending: false }),
          supabase.from('finance_loans').select('id, loan_id, guarantor_1_id, guarantor_2_id').in('id', loanIds),
        ]);
        if (!alive) return;
        setDocs(d || []);
        setFollowups(f || []);
        const gIds = [...new Set((lg || []).flatMap((x: any) => [x.guarantor_1_id, x.guarantor_2_id]).filter(Boolean))] as string[];
        if (gIds.length > 0) {
          const { data: g } = await supabase
            .from('finance_customers')
            .select('id, name, phone_1, phone, customer_id, aadhaar')
            .in('id', gIds);
          if (alive) setGuarantors(g || []);
        }
      } catch (err) {
        console.error('Failed to load customer details:', err);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!cust && !loading) return null;
  const c = cust || {};
  const rel = formatRelationship(c.father_name || c.father_husband_name);

  return (
    <>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex justify-center items-center z-50 p-4" onClick={onClose}>
        <div
          className="bg-white border border-slate-200 w-full max-w-6xl rounded-lg shadow-xl overflow-hidden flex flex-col max-h-[94vh]"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="bg-slate-900 text-white px-4 py-3 flex justify-between items-center shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <span className="font-mono font-bold text-slate-300 text-[15px]">#{v(c.customer_id)}</span>
              <span className="font-extrabold uppercase text-[16px] tracking-wide break-words">{v(c.name)}</span>
            </div>
            <button onClick={onClose} className="text-slate-300 hover:text-white p-1 hover:bg-slate-800 rounded" title="Close">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Body */}
          <div className="p-4 overflow-y-auto custom-scrollbar space-y-4 bg-slate-50">
            {loading && !cust && <div className="text-center text-slate-500 font-bold uppercase py-6">Loading…</div>}

            {/* Photo + identity */}
            <div className="flex flex-col md:flex-row gap-4 p-3 bg-white border border-slate-200 rounded shadow-sm items-start">
              <div className="flex gap-3 shrink-0">
                <button
                  type="button"
                  disabled={!c.customer_photo_url}
                  onClick={() => c.customer_photo_url && setPreviewPhoto(c.customer_photo_url)}
                  className="h-44 aspect-[35/45] rounded border border-slate-200 overflow-hidden bg-slate-100 flex items-center justify-center"
                  title={c.customer_photo_url ? 'Click to enlarge' : 'No photo'}
                >
                  {c.customer_photo_url ? (
                    <img src={c.customer_photo_url} alt={c.name} className="w-full h-full object-contain" />
                  ) : (
                    <User className="w-12 h-12 text-slate-300" />
                  )}
                </button>
                {(c.customer_fingerprint_image_url || c.fingerprint_url) && (
                  <div className="flex flex-col gap-2">
                    {c.customer_fingerprint_image_url && (
                      <button type="button" onClick={() => setPreviewPhoto(c.customer_fingerprint_image_url)} className="w-36 h-20 border border-slate-200 rounded bg-white overflow-hidden" title="Signature">
                        <img src={c.customer_fingerprint_image_url} alt="Signature" className="w-full h-full object-contain" />
                      </button>
                    )}
                    {c.fingerprint_url && (
                      <button type="button" onClick={() => setPreviewPhoto(c.fingerprint_url)} className="w-36 h-20 border border-slate-200 rounded bg-white overflow-hidden" title="Fingerprint">
                        <img src={c.fingerprint_url} alt="Fingerprint" className="w-full h-full object-contain" />
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div className="flex-1 grid grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-3 w-full">
                <Field label="Customer ID" value={c.customer_id} mono />
                <Field label="Name" value={c.name} />
                <Field label="Guardian" value={rel} wide />
                <Field label="Aadhaar No" value={c.aadhaar} mono wide />
                <Field label="Primary Phone" value={c.phone_1 || c.phone} mono />
                <Field label="Alternate Phone" value={c.phone_2 || c.phone2} mono />
                <Field label="Introducing Partner" value={c.partner_name || 'Direct Customer'} />
                <Field label="Profile Date" value={c.created_at ? new Date(c.created_at).toLocaleString('en-IN') : ''} />
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="space-y-4">
                <Section icon={<MapPin className="w-4 h-4 text-slate-500" />} title="Addresses">
                  <div className="space-y-2">
                    <div className="p-2 bg-slate-50 border border-slate-150 rounded space-y-2">
                      <div className="text-[11px] text-slate-500 uppercase font-bold">Present Address</div>
                      <p className="text-[14px] font-semibold text-slate-800 break-words">{v(c.present_address)}</p>
                      <div className="grid grid-cols-2 gap-2">
                        <Field label="House No" value={c.address} />
                        <Field label="Village" value={c.present_village || c.village} />
                        <Field label="Mandal" value={c.present_mandal || c.mandal} />
                        <Field label="District" value={c.present_district || c.district} />
                      </div>
                    </div>
                    <div className="p-2 bg-slate-50 border border-slate-150 rounded space-y-2">
                      <div className="text-[11px] text-slate-500 uppercase font-bold">Aadhaar Address</div>
                      <p className="text-[14px] font-semibold text-slate-800 break-words">{v(c.aadhaar_address)}</p>
                      <div className="grid grid-cols-3 gap-2">
                        <Field label="Village" value={c.aadhaar_village} />
                        <Field label="Mandal" value={c.aadhaar_mandal} />
                        <Field label="District" value={c.aadhaar_district} />
                      </div>
                    </div>
                  </div>
                </Section>

                <Section icon={<FileCode className="w-4 h-4 text-slate-500" />} title={`Documents (${docs.length})`}>
                  {docs.length > 0 ? (
                    <div className="space-y-1.5">
                      {docs.map(doc => (
                        <div key={doc.id} className="flex justify-between items-center gap-2 p-2 bg-slate-50 border border-slate-150 rounded">
                          <div className="min-w-0">
                            <span className="text-[14px] font-bold text-slate-800 block break-words">{doc.document_name}</span>
                            <span className="text-[11px] text-slate-500 uppercase font-bold">{doc.category}</span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {doc.file_url && (
                              <a href={doc.file_url} target="_blank" rel="noreferrer" className="text-[12px] bg-slate-900 text-white font-bold uppercase px-2 py-0.5 rounded hover:bg-slate-800">View</a>
                            )}
                            <span className={`px-1.5 py-0.5 rounded text-[11px] font-bold uppercase ${doc.is_submitted ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>
                              {doc.is_submitted ? 'Submitted' : 'Pending'}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : <Empty text="No uploaded documents" />}
                </Section>
              </div>

              <div className="space-y-4">
                <Section icon={<FileText className="w-4 h-4 text-slate-500" />} title={`Loan Accounts (${loans.length})`}>
                  {loans.length > 0 ? (
                    <table className="w-full text-[14px] border border-slate-200">
                      <thead className="bg-slate-100">
                        <tr>
                          <th className="px-2 py-1 text-left text-[12px] font-bold text-slate-600 uppercase">Loan No</th>
                          <th className="px-2 py-1 text-left text-[12px] font-bold text-slate-600 uppercase">Type</th>
                          <th className="px-2 py-1 text-right text-[12px] font-bold text-slate-600 uppercase">{loans.some(l => l.outstanding_amount !== undefined) ? 'Outstanding' : 'Amount'}</th>
                          <th className="px-2 py-1 text-center text-[12px] font-bold text-slate-600 uppercase">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 bg-white">
                        {loans.map(l => {
                          const amt = l.outstanding_amount !== undefined ? l.outstanding_amount : l.amount;
                          return (
                            <tr key={l.id}>
                              <td className="px-2 py-1 font-mono font-bold text-slate-900 whitespace-nowrap">{l.loan_id}</td>
                              <td className="px-2 py-1 font-bold text-slate-700 uppercase">{v(l.loan_category)}</td>
                              <td className="px-2 py-1 font-mono font-bold text-slate-800 text-right whitespace-nowrap tabular-nums">
                                {Number(amt || 0).toLocaleString('en-IN')}
                              </td>
                              <td className="px-2 py-1 text-center">
                                <span className={`px-1.5 py-0.5 rounded text-[11px] font-bold uppercase whitespace-nowrap ${l.status === 'Active' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'}`}>
                                  {v(l.status)}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  ) : <Empty text="No linked loan accounts" />}
                </Section>

                <Section icon={<ShieldAlert className="w-4 h-4 text-slate-500" />} title={`Guarantors (${guarantors.length})`}>
                  {guarantors.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {guarantors.map(g => (
                        <div key={g.id} className="p-2 bg-slate-50 border border-slate-150 rounded">
                          <span className="font-bold text-[14px] text-slate-900 block uppercase break-words">{g.name}</span>
                          <span className="text-[13px] text-slate-600 font-mono block">Phone: {v(g.phone_1 || g.phone)}</span>
                          <span className="text-[13px] text-slate-600 font-mono block">Aadhaar: {v(g.aadhaar)}</span>
                        </div>
                      ))}
                    </div>
                  ) : <Empty text="No guarantors linked" />}
                </Section>

                <Section icon={<History className="w-4 h-4 text-slate-500" />} title={`Follow-up Timeline (${followups.length})`}>
                  {followups.length > 0 ? (
                    <div className="space-y-2 max-h-[220px] overflow-y-auto custom-scrollbar">
                      {followups.map(log => (
                        <div key={log.id} className="p-2 bg-slate-50 border border-slate-150 rounded space-y-1">
                          <div className="flex justify-between gap-2 text-[12px] text-slate-500 font-bold uppercase">
                            <span>Staff: {log.followed_up_by}</span>
                            <span>{log.followed_up_at ? new Date(log.followed_up_at).toLocaleDateString('en-IN') : ''}</span>
                          </div>
                          <p className="text-[14px] font-bold text-slate-800">Outcome: {log.result}</p>
                          <p className="text-[13px] text-slate-700 bg-white p-1.5 border border-slate-100 rounded break-words">{log.narration}</p>
                        </div>
                      ))}
                    </div>
                  ) : <Empty text="No follow-ups logged" />}
                </Section>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="bg-slate-50 border-t border-slate-200 px-4 py-2.5 flex justify-between items-center shrink-0">
            <div>
              {onPrint && cust && (
                <button onClick={() => onPrint({ ...cust, loans })} className="inline-flex items-center gap-1 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded px-3 py-1.5 font-bold text-[13px] uppercase">
                  <Printer className="w-4 h-4" /> Print Profile
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={onClose} className="px-3 py-1.5 text-[13px] font-bold uppercase text-slate-600 hover:bg-slate-100 rounded border bg-white">Close</button>
              {onEdit && id && (
                <button onClick={() => onEdit(id)} className="inline-flex items-center gap-1 px-3 py-1.5 text-[13px] font-bold uppercase bg-slate-900 hover:bg-slate-800 text-white rounded">
                  <Edit2 className="w-4 h-4" /> Edit Profile
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {previewPhoto && (
        <div onClick={() => setPreviewPhoto(null)} className="fixed inset-0 bg-black/80 flex justify-center items-center z-[60] p-4 cursor-zoom-out">
          <div className="relative max-w-2xl max-h-[90vh] rounded bg-white p-2">
            <img src={previewPhoto} alt="Preview" className="max-w-full max-h-[85vh] object-contain rounded" />
            <button onClick={() => setPreviewPhoto(null)} className="absolute top-3 right-3 bg-black/60 hover:bg-black text-white p-1 rounded-full">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export default CustomerFullDetails;
