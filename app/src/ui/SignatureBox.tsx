import { Button, Group, Paper } from '@mantine/core';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
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
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    canvas.width = canvas.offsetWidth * ratio;
    canvas.height = canvas.offsetHeight * ratio;
    canvas.getContext('2d')!.scale(ratio, ratio);
    const pad = new SignaturePad(canvas, { penColor: '#111', backgroundColor: 'rgb(255,255,255)', minWidth: 1, maxWidth: 2.8 });
    pad.addEventListener('beginStroke', () => setEmpty(false));
    padRef.current = pad;
    return () => pad.off();
  }, []);

  useImperativeHandle(ref, () => ({
    isEmpty: () => padRef.current?.isEmpty() ?? true,
    toBlob: () => dataUrlToBlob(padRef.current!.toDataURL('image/png')),
    clear: () => {
      padRef.current?.clear();
      setEmpty(true);
    },
  }));

  return (
    <div>
      <Paper withBorder radius="md" style={{ overflow: 'hidden', background: '#fff', position: 'relative' }} className="sig-pad" data-empty={empty}>
        <canvas ref={canvasRef} style={{ width: '100%', height, display: 'block', touchAction: 'none' }} />
        {/* Signature line and a hint, like on paper; they fade away with the first stroke. */}
        <div className="sig-guide" aria-hidden>
          <span className="sig-x">×</span>
          <span className="sig-line" />
          <span className="sig-hint">{t('sign.hint')}</span>
        </div>
      </Paper>
      <Group justify="flex-end" mt={4}>
        <Button
          size="compact-xs"
          variant="subtle"
          disabled={empty}
          onClick={() => {
            padRef.current?.clear();
            setEmpty(true);
          }}
        >
          {t('sign.clear')}
        </Button>
      </Group>
    </div>
  );
});
