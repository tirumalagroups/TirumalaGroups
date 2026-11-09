import React, { useEffect, useRef } from 'react';
import { runTableFit } from '../../utils/tableFit';

/** The main page area. It is the only part of a screen that scrolls. See utils/tableFit. */
const FitMain: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const main = ref.current;
    if (!main) return undefined;
    let timer: number | undefined;
    const run = () => runTableFit(main, schedule);
    function schedule() {
      window.clearTimeout(timer);
      timer = window.setTimeout(run, 120);
    }
    const mutations = new MutationObserver(schedule);
    // A field's label can change with no new elements: a choice made, or a placeholder after loading
    mutations.observe(main, { childList: true, subtree: true, attributes: true, attributeFilter: ['placeholder', 'value'] });
    const resize = new ResizeObserver(schedule);
    resize.observe(main);
    schedule();
    return () => {
      window.clearTimeout(timer);
      mutations.disconnect();
      resize.disconnect();
    };
  }, []);

  return (
    <main ref={ref} className='flex-1 overflow-y-auto overflow-x-hidden p-6'>
      {children}
    </main>
  );
};

export default FitMain;
