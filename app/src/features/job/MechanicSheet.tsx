import { Button, Group, Modal, Stack, Textarea } from '@mantine/core';
import { IconBrandWhatsapp, IconCheck, IconCopy, IconShare } from '@tabler/icons-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { db } from '../../db/db';
import { liveLines } from '../../domain/flow';
import { itemTitle } from '../../domain/items';
import type { Employee } from '../../domain/types';
import { mediaBlob } from '../../services/media';
import { mechanicText, whatsappUrl } from '../../services/messages';
import type { OrderBundle } from '../../services/orders';
import { copyText } from '../../ui/clipboard';
import { haptic } from '../../ui/haptics';

/** What the mechanic is to do on this job, in English: the agreed lines not done yet, who does each, the notes. */
export function mechanicTask(b: OrderBundle, staff: Employee[]): { text: string; photos: string[]; to?: Employee } {
  const who = (id?: string) => staff.find((e) => e.id === id)?.name;
  const todo = liveLines(b.items).filter((i) => (i.kind === 'labor' || i.kind === 'part') && i.approvalState === 'approved' && !i.done);
  const lines = todo.map((i) => {
    const part = i.kind === 'part' ? ` (${i.customerSupplied ? "customer's part" : i.procurementStatus === 'received' ? 'here' : i.procurementStatus === 'ordered' || i.procurementStatus === 'in_transit' ? 'ordered' : 'to find'})` : '';
    return { title: `${itemTitle(i, 'en')}${i.kind === 'part' && i.qty !== 1 ? ` × ${i.qty}` : ''}${part}`, who: who(i.employeeId) };
  });
  const notes = b.notes.filter((n) => n.kind === 'text' && n.text).map((n) => n.text!.replace(/\s+/g, ' '));
  const photos = [...todo.flatMap((i) => i.mediaIds ?? []), ...b.notes.filter((n) => n.kind === 'photo' && n.mediaId).map((n) => n.mediaId!)];
  return { text: mechanicText(b.vehicle, b.order, lines, notes), photos, to: staff.find((e) => e.id === b.order.mechanicId) };
}

/**
 * The job for a mechanic in one message: the text (editable), then WhatsApp to the job's mechanic, the
 * share sheet with the photos, or a copy.
 */
export function MechanicSheet({ b, opened, onClose }: { b: OrderBundle; opened: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const staff = useLiveQuery(() => db.employees.toArray(), []) ?? [];
  const task = mechanicTask(b, staff);
  const [text, setText] = useState('');
  const [copied, setCopied] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  useEffect(() => {
    if (!opened) return;
    setText(task.text);
    setCopied(false);
    let alive = true;
    void Promise.all(task.photos.map(async (id, n) => {
      const blob = await mediaBlob(id);
      return blob ? new File([blob], `photo-${n + 1}.jpg`, { type: blob.type || 'image/jpeg' }) : undefined;
    })).then((l) => alive && setFiles(l.filter((f): f is File => !!f)));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened]);
  const phone = task.to?.phone;
  const shareable = typeof navigator.share === 'function';
  const share = () => {
    const data: ShareData = files.length && navigator.canShare?.({ files }) ? { files, text } : { text };
    navigator.share(data).catch(() => undefined);
  };
  return (
    <Modal opened={opened} onClose={onClose} title={task.to ? t('mechanic.titleTo', { name: task.to.name }) : t('mechanic.title')}>
      <Stack gap="md">
        <Textarea aria-label={t('mechanic.title')} autosize minRows={5} maxRows={14} value={text} onChange={(e) => setText(e.currentTarget.value)} styles={{ input: { fontSize: 15, lineHeight: 1.45 } }} />
        {phone && (
          <Button fullWidth size="md" color="green" component="a" href={whatsappUrl(phone, text)} target="_blank" rel="noopener" leftSection={<IconBrandWhatsapp size={20} />} onClick={() => haptic('light')}>
            WhatsApp · {task.to!.name}
          </Button>
        )}
        <Group grow gap="xs">
          {shareable && (
            <Button variant={phone ? 'default' : 'filled'} leftSection={<IconShare size={18} />} onClick={share}>
              {files.length ? t('mechanic.shareN', { n: files.length }) : t('common.share')}
            </Button>
          )}
          <Button
            variant="default"
            leftSection={copied ? <IconCheck size={18} /> : <IconCopy size={18} />}
            onClick={async () => {
              const ok = await copyText(text);
              setCopied(ok);
              if (ok) haptic('selection');
            }}
          >
            {copied ? t('common.copied') : t('common.copy')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
