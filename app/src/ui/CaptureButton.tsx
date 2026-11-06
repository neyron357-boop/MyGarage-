import { Button, type ButtonProps } from '@mantine/core';
import { IconCamera } from '@tabler/icons-react';
import { useRef, type ReactNode } from 'react';

/** Opens the phone camera (or file picker on a PC) and passes the chosen files on. */
export function CaptureButton({
  onFiles,
  children,
  accept = 'image/*',
  camera = true,
  multiple = false,
  leftSection,
  ...props
}: {
  onFiles: (files: File[]) => void;
  children: ReactNode;
  accept?: string;
  camera?: boolean;
  multiple?: boolean;
  leftSection?: ReactNode;
} & ButtonProps) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept={accept}
        capture={camera ? 'environment' : undefined}
        multiple={multiple}
        hidden
        onChange={(e) => {
          const files = [...(e.currentTarget.files ?? [])];
          e.currentTarget.value = '';
          if (files.length) onFiles(files);
        }}
      />
      <Button leftSection={leftSection ?? <IconCamera size={18} />} onClick={() => ref.current?.click()} {...props}>
        {children}
      </Button>
    </>
  );
}
