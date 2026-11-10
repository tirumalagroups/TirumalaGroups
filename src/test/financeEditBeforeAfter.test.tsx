// Finance Edited Logs in the Regular "Edited Records" look: Before / After rows, changed cells highlighted.
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import FinanceEditBeforeAfterTable, { columnsFor, BeforeAfterEvent } from '../components/finance/FinanceEditBeforeAfterTable';

const edit: BeforeAfterEvent = {
  id: 'e1', eventType: 'EDIT', timestamp: '2026-11-09T10:52:00Z', operator: 'ADMIN_USER',
  displayLoanNo: 'CD534', displayCustomer: 'VINITH BUKKA', source: 'RECORD EDITED',
  changedFields: [{ field: 'loan_amount', fieldLabel: 'Loan Amount', oldValue: 50000, newValue: 60000 }],
  rawLog: { old_values: { loan_amount: 50000, interest_rate: 2 }, new_values: { loan_amount: 60000, interest_rate: 2 } },
};
const create: BeforeAfterEvent = {
  id: 'c1', eventType: 'CREATE', timestamp: '2026-11-09T10:50:00Z', operator: 'ADMIN_USER',
  displayLoanNo: 'CD535', displayCustomer: 'BUKKA SAI', source: 'RECORD CREATED',
  changedFields: [{ field: 'loan_amount', fieldLabel: 'Loan Amount', oldValue: null, newValue: 25000 }],
  rawLog: { old_values: {}, new_values: { loan_amount: 25000 } },
};

const renderTable = (events: BeforeAfterEvent[]) => {
  const box = document.createElement('div');
  box.innerHTML = renderToStaticMarkup(
    <FinanceEditBeforeAfterTable
      events={events}
      formatValue={(_f, v) => String(v)}
      formatDate={iso => iso.slice(0, 10)}
      labelFor={f => (f === 'loan_amount' ? 'Loan Amount' : f)}
      onView={vi.fn()}
    />,
  );
  return box;
};

const rowOf = (box: HTMLElement, label: string) =>
  [...box.querySelectorAll('tr')].find(r => [...r.children].some(c => c.textContent === label))!;
const cellOf = (row: Element, text: string) => [...row.children].find(c => c.textContent === text)!;

describe('Finance edited logs, Before / After rows', () => {
  it('uses the edited fields as columns', () => {
    expect(columnsFor([edit, create])).toEqual(['loan_amount']);
  });

  it('shows each edit as a Before row and an After row with the change highlighted', () => {
    const box = renderTable([edit]);
    expect([...box.querySelectorAll('th')].map(t => t.textContent)).toContain('Loan Amount');
    const before = rowOf(box, 'Before');
    const after = rowOf(box, 'After');
    expect(cellOf(before, '50000').className).toContain('bg-red-50');
    expect(cellOf(after, '60000').className).toContain('bg-yellow-100');
    expect(cellOf(before, 'CD534')).toBeTruthy();
    expect(cellOf(before, 'ADMIN_USER')).toBeTruthy();
  });

  it('keeps record-created lines: "-" before, the new values after, labelled Created', () => {
    const box = renderTable([create]);
    expect(cellOf(rowOf(box, 'Before'), '-')).toBeTruthy();
    const createdRow = rowOf(box, 'Created');
    expect(cellOf(createdRow, '25000').className).toContain('bg-yellow-100');
  });

  it('says so when there are no edits', () => {
    expect(renderTable([]).textContent).toContain('No edits found.');
  });
});
