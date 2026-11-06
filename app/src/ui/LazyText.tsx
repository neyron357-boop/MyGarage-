import { Textarea, TextInput, type TextareaProps, type TextInputProps } from '@mantine/core';
import { useEffect, useRef, useState } from 'react';

/** Text field with local state that saves on blur (avoids cursor jumps while the DB round-trips). */
export function LazyTextInput({ value, onCommit, ...props }: Omit<TextInputProps, 'value' | 'onChange'> & { value: string | undefined; onCommit: (v: string) => void }) {
  const [v, setV] = useState(value ?? '');
  const dirty = useRef(false);
  useEffect(() => {
    if (!dirty.current) setV(value ?? '');
  }, [value]);
  return (
    <TextInput
      {...props}
      value={v}
      onChange={(e) => {
        dirty.current = true;
        setV(e.currentTarget.value);
      }}
      onBlur={() => {
        if (dirty.current) onCommit(v);
        dirty.current = false;
      }}
    />
  );
}

export function LazyTextarea({ value, onCommit, ...props }: Omit<TextareaProps, 'value' | 'onChange'> & { value: string | undefined; onCommit: (v: string) => void }) {
  const [v, setV] = useState(value ?? '');
  const dirty = useRef(false);
  useEffect(() => {
    if (!dirty.current) setV(value ?? '');
  }, [value]);
  return (
    <Textarea
      autosize
      minRows={3}
      {...props}
      value={v}
      onChange={(e) => {
        dirty.current = true;
        setV(e.currentTarget.value);
      }}
      onBlur={() => {
        if (dirty.current) onCommit(v);
        dirty.current = false;
      }}
    />
  );
}
