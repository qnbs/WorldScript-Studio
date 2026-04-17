import type React from 'react';
import { useEffect, useState } from 'react';
import { Input } from './Input';

interface DebouncedInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  value: string;
  onDebouncedChange: (value: string) => void;
  debounceTimeout?: number;
}

export const DebouncedInput: React.FC<DebouncedInputProps> = ({
  value: propValue,
  onDebouncedChange,
  debounceTimeout = 750,
  ...props
}) => {
  const [internalValue, setInternalValue] = useState(propValue);

  // Sync with prop changes from external sources (e.g., undo/redo)
  useEffect(() => {
    setInternalValue(propValue);
  }, [propValue]);

  // Debounce and notify parent of changes
  useEffect(() => {
    const handler = setTimeout(() => {
      // If the user has typed something different from the last known prop value,
      // notify the parent component.
      if (propValue !== internalValue) {
        onDebouncedChange(internalValue);
      }
    }, debounceTimeout);

    // Cleanup: clear the timeout if the user types again.
    return () => {
      clearTimeout(handler);
    };
    // This effect runs whenever the user's input changes.
  }, [internalValue, onDebouncedChange, debounceTimeout, propValue]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInternalValue(e.target.value);
  };

  return <Input {...props} value={internalValue} onChange={handleChange} />;
};
