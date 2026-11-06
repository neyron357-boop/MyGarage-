import { Button, Group, Paper, Text } from '@mantine/core';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import SignaturePad from 'signature_pad';
import { dataUrlToBlob } from '../services/media';

export interface SignatureHandle {
  isEmpty(): boolean;
  toBlob(): Blob;
  clear(): void;
}

export const SignatureBox = forwardRef<SignatureHandle, { height?: number }>(function SignatureBox({ height = 200 }, ref) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const padRef = useRef<SignaturePad>();

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    canvas.width = canvas.offsetWidth * ratio;
    canvas.height = canvas.offsetHeight * ratio;
    canvas.getContext('2d')!.scale(ratio, ratio);
    const pad = new SignaturePad(canvas, { penColor: '#111', backgroundColor: 'rgb(255,255,255)', minWidth: 1, maxWidth: 2.8 });
    padRef.current = pad;
    return () => pad.off();
  }, []);

  useImperativeHandle(ref, () => ({
    isEmpty: () => padRef.current?.isEmpty() ?? true,
    toBlob: () => dataUrlToBlob(padRef.current!.toDataURL('image/png')),
    clear: () => padRef.current?.clear(),
  }));

  return (
    <div>
      <Paper withBorder radius="md" style={{ overflow: 'hidden', background: '#fff' }}>
        <canvas ref={canvasRef} style={{ width: '100%', height, display: 'block', touchAction: 'none' }} />
      </Paper>
      <Group justify="space-between" mt={4}>
        <Text size="xs" c="dimmed">
          {t('sign.hint')}
        </Text>
        <Button size="compact-xs" variant="subtle" onClick={() => padRef.current?.clear()}>
          {t('sign.clear')}
        </Button>
      </Group>
    </div>
  );
});
