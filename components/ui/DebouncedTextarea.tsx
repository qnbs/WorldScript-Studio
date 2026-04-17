import type React from 'react';
import { useEffect, useState } from 'react';
import { Textarea } from './Textarea';

interface DebouncedTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  value: string;
  onDebouncedChange: (value: string) => void;
  debounceTimeout?: number;
}

export const DebouncedTextarea: React.FC<DebouncedTextareaProps> = ({
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

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInternalValue(e.target.value);
  };

  return <Textarea {...props} value={internalValue} onChange={handleChange} />;
};
