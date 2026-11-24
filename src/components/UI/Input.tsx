import React, { useState, forwardRef, useRef, useEffect } from 'react';
import { Calendar } from 'lucide-react';
import CustomCalendar from './CustomCalendar';
interface InputProps {
  label?: string;
  type?: string;
  value: string | number;
  onChange?: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  className?: string;
  min?: string | number;
  max?: string | number;
  step?: string | number;
  suggestions?: Array<string | number>;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  size?: 'sm' | 'md' | 'lg';
  uppercase?: boolean;
  /** Password box: never forced to capitals, even while shown as text (eye toggle) */
  password?: boolean;
  style?: React.CSSProperties;
  error?: boolean;
  inputMode?: 'none' | 'text' | 'decimal' | 'numeric' | 'tel' | 'search' | 'email' | 'url';
  maxLength?: number;
  tabIndex?: number;
  /** Optional leading icon component (e.g. Search, Calendar). Accepted but decorative — the component renders its own date-picker icon. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  icon?: React.ComponentType<any>;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      label,
      type = 'text',
      value,
      onChange,
      placeholder,
      required = false,
      disabled = false,
      readOnly = false,
      className = '',
      min,
      max,
      step,
      suggestions = [],
      onKeyDown,
      size = 'md',
      uppercase = false,
      password = false,
      style,
      error = false,
      inputMode,
      maxLength,
      tabIndex,
    },
    ref
  ) => {
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [inputValue, setInputValue] = useState(value);
    const [showCalendar, setShowCalendar] = useState(false);
    const [internalDateInput, setInternalDateInput] = useState('');
    const wrapperRef = useRef<HTMLDivElement>(null);
    const isFinance = typeof window !== 'undefined' && window.location.pathname.startsWith('/finance');

    useEffect(() => {
      if (type === 'date' && value) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
          const [y, m, d] = String(value).split('-');
          setInternalDateInput(`${d}/${m}/${y}`);
        } else {
          setInternalDateInput(String(value));
        }
      } else if (type === 'date') {
        setInternalDateInput('');
      }
    }, [value, type]);

    useEffect(() => {
      const handleClickOutside = (event: MouseEvent) => {
        if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
          setShowCalendar(false);
        }
      };
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);
    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      let val = e.target.value;

      // Special handling for date
      if (type === 'date') {
        setInternalDateInput(val);
        const m = val.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        if (m) {
          if (onChange) onChange(`${m[3]}-${m[2]}-${m[1]}`);
        } else if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
          if (onChange) onChange(val);
        }
        setShowSuggestions(false);
        return;
      }

      // Apply uppercase transformation for text inputs when uppercase prop is true or we are in finance flow
      const forceUpper = uppercase || isFinance;
      if (forceUpper && !password && type !== 'number' && type !== 'date' && type !== 'password') {
        val = val.toUpperCase();
      }

      setInputValue(val);
      if (type === 'number') {
        // Allow decimal values for quantity inputs
        if (onChange) onChange(val === '' ? '' : val);
      } else {
        if (onChange) onChange(val);
      }
      setShowSuggestions(true);
    };

    const filteredSuggestions = suggestions
      .map(String)
      .filter(
        s =>
          inputValue &&
          !String(inputValue).includes(s) &&
          Math.abs(Number(s) - Number(inputValue)) < 10
      )
      .slice(0, 5);

    return (
      <div className={className} style={{ position: 'relative' }} ref={wrapperRef}>
        {label && (
          <label 
            className={isFinance ? `peek-label uppercase ${size === 'lg' ? 'text-[14px]' : ''}` : `block font-bold text-gray-700 mb-1 ${
              size === 'sm' ? 'text-xs' : size === 'lg' ? 'text-base' : 'text-sm'
            }`} 
            style={{ 
              fontFamily: style?.fontFamily || 'Times New Roman', 
              fontSize: '15px', 
              fontWeight: 'bold' 
            }}
          >
            {label}
            {required && <span className='text-red-500 ml-1'>*</span>}
          </label>
        )}
        <div className="relative">
          <input
            ref={ref}
            type={type === 'date' ? 'text' : type}
            value={
              type === 'date'
                ? internalDateInput
                : typeof value === 'number' && isNaN(value)
                  ? ''
                  : value === null || value === undefined
                    ? ''
                    : (uppercase || isFinance) && !password && type !== 'number' && type !== 'date' && type !== 'password'
                      ? String(value).toUpperCase()
                      : value
            }
            data-password={password ? 'true' : undefined}
            onChange={handleInputChange}
            onKeyDown={onKeyDown}
            placeholder={type === 'date' ? (placeholder || 'dd/MM/yyyy') : placeholder}
            required={required}
            disabled={disabled}
            readOnly={readOnly}
            min={min}
            max={max}
            step={step}
            inputMode={inputMode}
            maxLength={maxLength}
            tabIndex={tabIndex}
            className={`w-full border rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed ${
              error 
                ? 'border-red-500 bg-red-50 focus:ring-red-500' 
                : 'border-gray-300 focus:ring-blue-500'
            } ${
              isFinance ? 'peek-button text-slate-800 font-bold' : 'font-bold'
            } ${
              size === 'sm' ? `px-2 py-1 ${!isFinance ? 'text-sm' : ''}` : 
              size === 'lg' ? `px-4 py-3 ${!isFinance ? 'text-lg' : ''}` : 
              `px-3 py-2 ${!isFinance ? 'text-base' : ''}`
            } ${type === 'date' ? 'cursor-pointer' : ''}`}
            style={{ 
              fontFamily: style?.fontFamily || 'Times New Roman', 
              fontSize: '15px', 
              fontWeight: 'bold', 
              ...style 
            }}
            onFocus={() => {
              setShowSuggestions(true);
            }}
            onBlur={() => {
              setTimeout(() => setShowSuggestions(false), 100);
            }}
            onWheel={type === 'number' ? (e) => e.currentTarget.blur() : undefined}
          />
          {type === 'date' && (
            <>
              <button
                type="button"
                tabIndex={-1}
                onClick={(e) => { e.preventDefault(); setShowCalendar(!showCalendar); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-gray-100 rounded"
              >
                <Calendar className="w-4 h-4 text-gray-500" />
              </button>
              {showCalendar && (
                <CustomCalendar
                  onDateSelect={(date) => {
                    if (onChange) onChange(date);
                    setShowCalendar(false);
                  }}
                  selectedDate={
                    String(value).match(/^\d{4}-\d{2}-\d{2}$/) 
                      ? String(value) 
                      : undefined
                  }
                  onClose={() => setShowCalendar(false)}
                />
              )}
            </>
          )}
        </div>
        {showSuggestions && filteredSuggestions.length > 0 && (
          <ul className='absolute z-10 bg-white border border-gray-200 rounded shadow-md mt-1 w-full max-h-40 overflow-y-auto'>
            {filteredSuggestions.map((s, idx) => (
              <li
                key={idx}
                className='px-3 py-2 cursor-pointer hover:bg-blue-100'
                onMouseDown={() => {
                  setInputValue(s);
                  if (onChange) onChange(String(s));
                  setShowSuggestions(false);
                }}
              >
                {s}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';

export default Input;