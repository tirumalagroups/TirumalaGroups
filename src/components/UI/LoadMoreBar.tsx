import React from 'react';

export const LOAD_STEP = 50;

/** Shows how many records are on screen, with Load 50 More and Refresh (back to the first 50). */
const LoadMoreBar: React.FC<{
  shown: number;
  total: number;
  onMore: () => void;
  onRefresh: () => void;
  busy?: boolean;
}> = ({ shown, total, onMore, onRefresh, busy }) => {
  if (total <= LOAD_STEP && shown >= total) return null;
  return (
    <div className='flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-t border-gray-200 bg-white'>
      <span className='text-sm text-gray-700 font-medium'>
        Showing {shown} of {total} records
      </span>
      <span className='flex items-center gap-2'>
        {shown < total && (
          <button
            type='button'
            disabled={busy}
            onClick={onMore}
            className='px-3 py-1.5 rounded text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50'
          >
            {busy ? 'Loading...' : `Load ${LOAD_STEP} More`}
          </button>
        )}
        {shown > LOAD_STEP && (
          <button
            type='button'
            onClick={onRefresh}
            className='px-3 py-1.5 rounded text-sm font-semibold bg-gray-200 text-gray-900 hover:bg-gray-300'
          >
            Refresh
          </button>
        )}
      </span>
    </div>
  );
};

export default LoadMoreBar;
