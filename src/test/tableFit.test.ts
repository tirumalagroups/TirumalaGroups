import { describe, expect, it } from 'vitest';
import { isDetailRow, ROW_STEP, visibleRowFlags } from '../utils/tableFit';

const main = (n: number) => Array.from({ length: n }, () => false);

describe('rows shown', () => {
  it('shows every row when there are fewer than the limit', () => {
    expect(visibleRowFlags(main(10), ROW_STEP).every(Boolean)).toBe(true);
  });

  it('shows exactly the first 50 of 120', () => {
    const flags = visibleRowFlags(main(120), ROW_STEP);
    expect(flags.filter(Boolean)).toHaveLength(50);
    expect(flags[49]).toBe(true);
    expect(flags[50]).toBe(false);
  });

  it('Load 50 More shows 50 more', () => {
    expect(visibleRowFlags(main(120), ROW_STEP * 2).filter(Boolean)).toHaveLength(100);
  });

  it('keeps a detail row with its parent row', () => {
    expect(visibleRowFlags([false, true, false, true], 1)).toEqual([true, true, false, false]);
  });

  it('a detail row is a single wide cell', () => {
    expect(isDetailRow({ cells: [{ colSpan: 6 }] } as never)).toBe(true);
    expect(isDetailRow({ cells: [{ colSpan: 1 }] } as never)).toBe(false);
    expect(isDetailRow({ cells: [{ colSpan: 1 }, { colSpan: 1 }] } as never)).toBe(false);
  });
});
