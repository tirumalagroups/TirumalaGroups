import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Attendance from '../pages/Attendance';
import { attendanceTablesReady } from '../services/attendanceService';

let currentUser: { username: string; is_admin: boolean } | null = null;

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: currentUser }),
}));

vi.mock('../services/attendanceService', () => ({
  attendanceTablesReady: vi.fn(async () => false),
  getStaff: vi.fn(async () => []),
  getSalaryHistory: vi.fn(async () => []),
  getHolidays: vi.fn(async () => []),
  getLocks: vi.fn(async () => []),
}));

describe('Attendance access', () => {
  let host: HTMLDivElement;
  let root: Root;

  const show = async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/attendance']}>
          <Routes>
            <Route path='/' element={<div>HOME PAGE</div>} />
            <Route path='/attendance' element={<Attendance />} />
          </Routes>
        </MemoryRouter>
      );
    });
  };

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('sends a non-admin away without loading any attendance data', async () => {
    currentUser = { username: 'STAFF', is_admin: false };
    await show();
    expect(host.textContent).toContain('HOME PAGE');
    expect(host.textContent).not.toContain('Attendance');
    expect(attendanceTablesReady).not.toHaveBeenCalled();
  });

  it('lets an admin in', async () => {
    currentUser = { username: 'ADMIN', is_admin: true };
    await show();
    expect(attendanceTablesReady).toHaveBeenCalled();
    expect(host.textContent).toContain('Attendance is not set up yet.');
    expect(host.textContent).not.toContain('HOME PAGE');
  });
});
