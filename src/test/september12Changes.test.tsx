/**
 * Changes of 12 Nov 2026 (ThirumalaChanges-September12-11.pdf):
 *  - capitals rule: only password boxes keep what was typed
 *  - User Management Audit Log in plain words
 *  - Login History place from Vercel's headers
 *  - Edited / Deleted Entry: Edit Entry columns, print shows the same rows as the screen
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../lib/supabase', () => {
  const chain: any = new Proxy(() => chain, { get: () => chain, apply: () => chain });
  return { supabase: chain, rawSupabase: chain, default: chain, resolveSchemaAndTable: (t: string) => ({ schema: 'public', table: t }), supabaseHelpers: {} };
});

import { forceUppercaseOnInput } from '../utils/uppercaseInputs';
import Input from '../components/UI/Input';
import { describeAudit } from '../pages/UserManagement';
// @ts-expect-error the login server files are plain JavaScript (no type declarations)
import { requestLocation } from '../../api/_auth.js';
import FinanceEditBeforeAfterTable from '../components/finance/FinanceEditBeforeAfterTable';
import { moneyColumnsFor, formatLogValue, mapFieldLabel, GroupedEditAuditEvent } from '../pages/finance/EditedDeletedLogs';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const typeInto = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  const proto = el.tagName === 'INPUT' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};

describe('Capitals rule: only password boxes are exempt', () => {
  document.addEventListener('input', forceUppercaseOnInput, true);
  afterEach(() => { document.body.innerHTML = ''; });

  it('still turns ordinary text boxes and text areas into capitals', () => {
    document.body.innerHTML = `<input type="text" id="a" /><input id="b" /><textarea id="c"></textarea>`;
    ['a', 'b', 'c'].forEach(id => typeInto(document.getElementById(id) as HTMLInputElement, 'ravi kumar'));
    expect((document.getElementById('a') as HTMLInputElement).value).toBe('RAVI KUMAR');
    expect((document.getElementById('b') as HTMLInputElement).value).toBe('RAVI KUMAR');
    expect((document.getElementById('c') as HTMLTextAreaElement).value).toBe('RAVI KUMAR');
  });

  it('leaves a password box shown as text (eye toggle) exactly as typed', () => {
    document.body.innerHTML = `<input type="text" data-password="true" id="p" />`;
    const p = document.getElementById('p') as HTMLInputElement;
    typeInto(p, 'Secret@123abc');
    expect(p.value).toBe('Secret@123abc');
  });

  it('Input with the password prop: no capitals on Finance pages even as text; others still capitals', async () => {
    window.history.pushState({}, '', '/finance/user-access-management');
    const box = document.createElement('div');
    document.body.appendChild(box);
    const root = createRoot(box);
    const seen: Record<string, string> = {};
    await act(async () => {
      root.render(
        <>
          <Input label='Password' password type='text' value={seen.pw || ''} onChange={v => { seen.pw = v; }} />
          <Input label='Name' type='text' value={seen.name || ''} onChange={v => { seen.name = v; }} />
        </>
      );
    });
    const [pw, name] = Array.from(box.querySelectorAll('input'));
    expect(pw.getAttribute('data-password')).toBe('true');
    expect(name.getAttribute('data-password')).toBeNull();
    await act(async () => { typeInto(pw, 'myPass99'); typeInto(name, 'ravi'); });
    expect(seen.pw).toBe('myPass99');
    expect(seen.name).toBe('RAVI');
    await act(async () => root.unmount());
    window.history.pushState({}, '', '/');
  });
});

describe('User Management Audit Log in plain words', () => {
  it('permissions: names of what was added and removed', () => {
    expect(describeAudit({
      field: 'permissions (Finance Mode)',
      old_value: JSON.stringify(['finance_dashboard', 'calculator']),
      new_value: JSON.stringify(['finance_dashboard', 'cd_ledger', 'hp_ledger']),
    })).toEqual(['Finance permissions: added CD Ledger, HP Ledger; removed Calculator']);
    expect(describeAudit({
      field: 'permissions (Regular Mode)', old_value: '[]', new_value: JSON.stringify(['new_entry']),
    })).toEqual(['Regular permissions: added New Entry']);
  });

  it('status, new user, password, profile', () => {
    expect(describeAudit({ field: 'status', old_value: 'Active', new_value: 'Locked' })).toEqual(['Status: Active → Locked']);
    expect(describeAudit({ field: 'status', old_value: 'Active', new_value: 'Deleted' })).toEqual(['User deleted (status was Active)']);
    expect(describeAudit({ field: 'user', old_value: null, new_value: 'Created as Operator' })).toEqual(['New user created: as Operator']);
    expect(describeAudit({ field: 'password', old_value: 'HIDDEN', new_value: 'TEMPORARY_SET' })[0]).toContain('Temporary password set');
    expect(describeAudit({ field: 'phone', old_value: '9000000000', new_value: '9111111111' })).toEqual(['Phone: 9000000000 → 9111111111']);
    expect(describeAudit({ field: 'branch', old_value: null, new_value: 'GUNTUR' })).toEqual(['Branch added: GUNTUR']);
  });
});

describe('Login History place from Vercel', () => {
  it('city, state and country in words', () => {
    expect(requestLocation(new Headers({ 'x-vercel-ip-city': 'Hyderabad', 'x-vercel-ip-country-region': 'TG', 'x-vercel-ip-country': 'IN' })))
      .toBe('Hyderabad, Telangana, India');
    expect(requestLocation(new Headers({ 'x-vercel-ip-city': 'Vijayawada', 'x-vercel-ip-country-region': 'AP', 'x-vercel-ip-country': 'IN' })))
      .toBe('Vijayawada, Andhra Pradesh, India');
  });
  it('nothing known (local run): null, shown as "-"', () => {
    expect(requestLocation(new Headers())).toBeNull();
  });
});

describe('Edited / Deleted Entry: Edit Entry columns', () => {
  const dayBookEdit = (n: number): GroupedEditAuditEvent => ({
    id: `e${n}`, eventType: 'EDIT', timestamp: '2026-11-12T06:30:00Z', operator: 'VINITH', tableName: 'finance_cashbook_entries',
    recordId: `r${n}`, displayLoanNo: 'CD534', displayCustomer: 'VINITH BUKKA', source: 'RECORD EDITED',
    changedFields: [{ field: 'credit', fieldLabel: 'CREDIT', oldValue: 100, newValue: 2000 }],
    rawLog: {
      id: `e${n}`, table_name: 'finance_cashbook_entries', record_id: `r${n}`, edited_by: 'VINITH', edited_at: '2026-11-12T06:30:00Z',
      old_values: { entry_date: '2026-11-11', head_of_account: 'EXPENCES A/C', account_number: 'CD534', particulars: 'TEA', credit: 100, debit: 0 },
      new_values: { entry_date: '2026-11-11', head_of_account: 'EXPENCES A/C', account_number: 'CD534', particulars: 'TEA', credit: 2000, debit: 0 },
    },
  });

  const render = (events: GroupedEditAuditEvent[], printMode = false) => {
    const box = document.createElement('div');
    box.innerHTML = renderToStaticMarkup(
      <FinanceEditBeforeAfterTable
        events={events}
        columns={moneyColumnsFor('finance_cashbook_entries')}
        formatValue={formatLogValue}
        formatDate={iso => iso.slice(0, 10)}
        labelFor={mapFieldLabel}
        onView={() => {}}
        printMode={printMode}
      />
    );
    return box;
  };

  it('same columns as Edit Entry, Before / After rows, the changed amount highlighted', () => {
    const box = render([dayBookEdit(1)]);
    const heads = Array.from(box.querySelectorAll('th')).map(t => t.textContent);
    expect(heads).toEqual(['#', 'Type', 'Date', 'Customer', 'Head of Account', 'CD / Loan No', 'Particulars', 'Credit', 'Debit', 'Edited By', 'Edited At', 'Actions']);
    const rows = Array.from(box.querySelectorAll('tbody tr'));
    const before = Array.from(rows[0].children).map(c => c.textContent);
    const after = Array.from(rows[1].children).map(c => c.textContent);
    expect(before).toContain('11/11/2026');
    expect(before).toContain('CD534');
    expect(before).toContain('100.00');
    expect(after).toContain('2,000.00');
    const beforeCredit = Array.from(rows[0].children).find(c => c.textContent === '100.00')!;
    const afterCredit = Array.from(rows[1].children).find(c => c.textContent === '2,000.00')!;
    expect(beforeCredit.className).toContain('bg-red-50');
    expect(afterCredit.className).toContain('bg-yellow-100');
    const particulars = Array.from(rows[1].children).find(c => c.textContent === 'TEA')!;
    expect(particulars.className).not.toContain('bg-yellow-100');
  });

  it('print shows every row of the screen (no 20-row pages) and no buttons', () => {
    const events = Array.from({ length: 25 }, (_, i) => dayBookEdit(i + 1));
    expect(render(events).querySelectorAll('tbody tr').length).toBe(40); // screen: page 1 of 2
    const printed = render(events, true);
    expect(printed.querySelectorAll('tbody tr').length).toBe(50);
    expect(printed.querySelectorAll('button').length).toBe(0);
    expect(Array.from(printed.querySelectorAll('th')).map(t => t.textContent)).not.toContain('Actions');
  });
});
