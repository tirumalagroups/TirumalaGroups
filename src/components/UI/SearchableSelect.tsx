import React, { useState, useRef, useEffect, forwardRef, useMemo } from 'react';
import { ChevronDown, X } from 'lucide-react';

interface SearchableSelectProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onSelect?: (value: string) => void; // New callback for when an option is selected
  noOptionsMessage?: string;
  size?: 'sm' | 'md' | 'lg';
  tabIndex?: number;
  allowCopy?: boolean;
}

const SearchableSelect = forwardRef<HTMLInputElement, SearchableSelectProps>(
  (
    {
      label,
      value,
      onChange,
      options,
      placeholder = 'Select an option...',
      required = false,
      disabled = false,
      className = '',
      onKeyDown,
      onSelect,
      noOptionsMessage = 'No options found',
      size = 'md',
      tabIndex,
      allowCopy = false,
    },
    ref
  ) => {
    const isFinance = typeof window !== 'undefined' && window.location.pathname.startsWith('/finance');
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [highlightedIndex, setHighlightedIndex] = useState(-1);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const internalInputRef = useRef<HTMLInputElement>(null);
    const inputRef = (ref as React.RefObject<HTMLInputElement>) || internalInputRef;

    // Get the selected option label
    const selectedOption = options.find(option => option.value === value);
    const displayValue = selectedOption ? selectedOption.label : '';

    // Filter options based on search term and prioritize matches starting with searchTerm
    const filteredOptions = useMemo(() => {
      if (!searchTerm.trim()) {
        return options;
      }
      
      const term = searchTerm.toLowerCase().trim();
      const startsWithMatch: { value: string; label: string }[] = [];
      const containsMatch: { value: string; label: string }[] = [];

      options.forEach(option => {
        const labelLower = option.label.toLowerCase();
        if (labelLower.startsWith(term)) {
          startsWithMatch.push(option);
        } else if (labelLower.includes(term)) {
          containsMatch.push(option);
        }
      });

      return [...startsWithMatch, ...containsMatch];
    }, [options, searchTerm]);

    // Handle click outside to close dropdown
    useEffect(() => {
      const handleClickOutside = (event: MouseEvent) => {
        if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
          setIsOpen(false);
          setSearchTerm('');
          setHighlightedIndex(-1);
        }
      };

      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Keep highlightedIndex in sync when options change or dropdown opens
    useEffect(() => {
      if (isOpen) {
        if (searchTerm.trim().length > 0) {
          // If user has typed something, default to first filtered option
          setHighlightedIndex(0);
        } else {
          // If no search term, highlight the currently selected option, or first option
          const selectedIndex = filteredOptions.findIndex(opt => opt.value === value);
          setHighlightedIndex(selectedIndex >= 0 ? selectedIndex : 0);
        }
      } else {
        setHighlightedIndex(-1);
      }
    }, [isOpen, filteredOptions, value, searchTerm]);

    const handleSelect = (selectedValue: string) => {
      onChange(selectedValue);
      setIsOpen(false);
      setSearchTerm('');
      setHighlightedIndex(-1);
      
      // Call onSelect callback if provided (for auto-navigation)
      if (onSelect) {
        onSelect(selectedValue);
      }
    };

    // Handle keyboard navigation
    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (disabled) return;

      if (allowCopy && isOpen && searchTerm === '' && displayValue !== '') {
        // If it's a single printable character key (not Ctrl/Cmd/Alt)
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          const char = isFinance ? e.key.toUpperCase() : e.key;
          setSearchTerm(char);
          e.preventDefault();
          return;
        }
        if (e.key === 'Backspace' || e.key === 'Delete') {
          setSearchTerm('');
          onChange('');
          e.preventDefault();
          return;
        }
      }

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          if (!isOpen) {
            setIsOpen(true);
          } else {
            setHighlightedIndex(prev => 
              prev < filteredOptions.length - 1 ? prev + 1 : 0
            );
          }
          break;
        case 'ArrowUp':
          e.preventDefault();
          if (isOpen) {
            setHighlightedIndex(prev => 
              prev > 0 ? prev - 1 : filteredOptions.length - 1
            );
          }
          break;
        case 'Enter':
          // If dropdown is open and an option is highlighted, select it
          if (isOpen && highlightedIndex >= 0 && filteredOptions[highlightedIndex]) {
            e.preventDefault();
            handleSelect(filteredOptions[highlightedIndex].value);
          } else if (!isOpen) {
            // When closed, allow parent to handle Enter (to move focus)
            if (onKeyDown) {
              onKeyDown(e);
            }
          } else {
            // Dropdown open but nothing highlighted or found: close and pass to parent
            setIsOpen(false);
            if (onKeyDown) {
              onKeyDown(e);
            }
          }
          break;
        case 'Escape':
          e.preventDefault();
          setIsOpen(false);
          setSearchTerm('');
          setHighlightedIndex(-1);
          break;
        case 'Tab':
          // Tab selects the highlighted/best option if user typed or navigated
          if (isOpen && filteredOptions.length > 0) {
            const hasUserTyped = searchTerm.length > 0;
            const hasNavigated = highlightedIndex >= 0;
            
            if (hasUserTyped || hasNavigated) {
              const indexToSelect = highlightedIndex >= 0 ? highlightedIndex : 0;
              if (filteredOptions[indexToSelect]) {
                if (e.shiftKey) {
                  // Select option but do not run onSelect (to avoid forward auto-focus)
                  onChange(filteredOptions[indexToSelect].value);
                } else {
                  // Select option and run onSelect
                  handleSelect(filteredOptions[indexToSelect].value);
                }
              }
            }
          }
          setIsOpen(false);
          setSearchTerm('');
          setHighlightedIndex(-1);
          // Let the Tab key event propagate normally so it shifts focus to the next/previous field
          break;
        default:
          // Call the parent onKeyDown if provided
          if (onKeyDown) {
            onKeyDown(e);
          }
          break;
      }
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const newSearchTerm = isFinance ? e.target.value.toUpperCase() : e.target.value;
      setSearchTerm(newSearchTerm);
      
      // If user is typing and dropdown is closed, open it
      if (!isOpen) {
        setIsOpen(true);
      }
    };

    const handleInputClick = () => {
      if (!disabled) {
        setIsOpen(true);
      }
    };

    const handleFocus = () => {
      if (!disabled && !isOpen) {
        setIsOpen(true);
      }
    };

    const handleClear = (e: React.MouseEvent) => {
      e.stopPropagation();
      onChange('');
      setSearchTerm('');
      setHighlightedIndex(-1);
      if (inputRef.current) {
        inputRef.current.focus();
      }
    };

    return (
      <div className={`relative ${className}`} ref={dropdownRef}>
        {label && (
          <label 
            className={isFinance ? `finance-label ${size === 'lg' ? 'text-[14px]' : ''}` : `block font-bold text-gray-700 mb-1 ${
              size === 'sm' ? 'text-xs' : size === 'lg' ? 'text-base' : 'text-sm'
            }`} 
            style={{ 
              fontFamily: 'Times New Roman', 
              fontSize: '15px', 
              fontWeight: 'bold' 
            }}
          >
            {label}
            {required && <span className='text-red-500 ml-1'>*</span>}
          </label>
        )}
        
        <div className='relative'>
          <input
            ref={inputRef}
            type='text'
            value={isOpen && (!allowCopy || searchTerm !== '') ? searchTerm : ((className.includes('staff-field') || isFinance) ? displayValue.toUpperCase() : displayValue)}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onClick={handleInputClick}
            onFocus={handleFocus}
            onBlur={() => {
              setTimeout(() => {
                setIsOpen(false);
                setSearchTerm('');
                setHighlightedIndex(-1);
              }, 150);
            }}
            placeholder={isOpen && displayValue && !allowCopy ? displayValue : placeholder}
            disabled={disabled}
            required={required}
            tabIndex={tabIndex}
            role='combobox'
            aria-expanded={isOpen}
            aria-autocomplete='list'
            aria-controls={isOpen && label ? `${label.replace(/\s+/g, '-').toLowerCase()}-listbox` : undefined}
            className={`w-full border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed font-bold select-text ${
              size === 'sm' ? 'px-2 py-1 text-sm' : size === 'lg' ? 'px-4 py-3 text-lg' : 'px-3 py-2 text-base'
            } ${(className.includes('staff-field') || isFinance) ? 'uppercase' : ''}`}
            style={{ 
              fontFamily: 'Times New Roman', 
              fontSize: '15px',
              fontWeight: 'bold',
              // Room for the arrow, and the clear button when something is chosen; the rest is for the text
              paddingRight: value && !disabled ? 56 : 30,
              userSelect: 'text',
              WebkitUserSelect: 'text',
              ...((className.includes('staff-field') || isFinance) ? { textTransform: 'uppercase' } : {})
            }}
          />
          
          <div className='absolute inset-y-0 right-0 flex items-center pr-1'>
            {value && !disabled && (
              <button
                type='button'
                onClick={handleClear}
                tabIndex={-1}
                className='p-1 text-gray-400 hover:text-gray-600 mr-1 focus:outline-none'
              >
                <X size={16} />
              </button>
            )}
            <button
              type='button'
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                if (!disabled) {
                  setIsOpen(prev => !prev);
                  if (isOpen && inputRef.current) {
                    inputRef.current.blur();
                  } else if (inputRef.current) {
                    inputRef.current.focus();
                  }
                }
              }}
              onMouseDown={(e) => e.preventDefault()} // Prevents input blur on click
              tabIndex={-1}
              className='p-1 text-gray-400 hover:text-gray-600 focus:outline-none'
            >
              <ChevronDown 
                size={16} 
                className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
              />
            </button>
          </div>
        </div>

        {isOpen && (
          <div 
            id={label ? `${label.replace(/\s+/g, '-').toLowerCase()}-listbox` : undefined}
            role='listbox'
            className='absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto'
          >
            {filteredOptions.length > 0 ? (
              filteredOptions.map((option, index) => (
                <div
                  key={option.value}
                  role='option'
                  aria-selected={option.value === value}
                  className={`px-3 py-2 cursor-pointer transition-colors text-sm ${
                    index === highlightedIndex
                      ? 'bg-blue-100 text-blue-900 font-semibold'
                      : 'hover:bg-gray-100'
                  } ${
                    option.value === value ? 'bg-blue-50 text-blue-900 font-bold' : ''
                  }`}
                  onClick={() => handleSelect(option.value)}
                  onMouseEnter={() => setHighlightedIndex(index)}
                >
                  {(className.includes('staff-field') || isFinance) ? option.label.toUpperCase() : option.label}
                </div>
              ))
            ) : (
              <div className='px-3 py-2 text-gray-500 text-sm' role='status'>
                {noOptionsMessage}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }
);

SearchableSelect.displayName = 'SearchableSelect';

export default SearchableSelect;
