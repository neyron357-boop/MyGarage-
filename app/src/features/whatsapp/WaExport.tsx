import { Button, Group, Modal, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertCircle, IconCircleCheckFilled, IconFileImport, IconUsersGroup } from '@tabler/icons-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDate } from '../../domain/dates';
import { waDigits } from '../../domain/whatsapp';
import { learnExports, readExports, type ExportItem } from '../../services/waExport';
import { waStore } from '../../services/whatsapp';
import { db } from '../../db/db';
import { FormRow, RowGroup } from '../../ui/components';
import { haptic } from '../../ui/haptics';
import { useAction, useScreenLiveQuery } from '../../ui/hooks';
import { LazySheet } from '../../ui/lazy';
import { ChatPicker } from './ChatPicker';

/*
 * «Экспорт чатов» (v0.91.5, the owner: «у меня нету в настройках включить всю историю» → «Да, сделай»): the whole history
 * of a chat, as the phone's own «Export chat» gives it (without media; a .zip on the iPhone, a .txt on Android) — the files
 * picked here (several at once), each shown with its chat (found by its name or number, else picked), its time and which
 * of its two senders is the garage; «Учесть» — what its requests came to kept with the chat (services/waExport.ts). The
 * files go nowhere and nothing of their words is kept.
 */

const ready = (x: ExportItem) => !!x.chat && !!x.garage && !x.group && !x.empty;

export function WaExportGroup() {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const { run, busy } = useAction({ exclusive: true });
  const [items, setItems] = useState<ExportItem[] | null>(null);
  const known = useScreenLiveQuery(async () => (await db.chatFacts.toArray()).filter((f) => f.exportAt).length, []);
  const picked = (files: FileList | null) => {
    const list = Array.from(files ?? []);
    if (input.current) input.current.value = '';
    if (!list.length) return;
    void run(async () => setItems(await readExports(list)));
  };
  return (
    <RowGroup title={t('wa.export.title')} note={t('wa.export.how')}>
      {!!known && (
        <FormRow label={t('wa.export.known')}>
          <Text className="tnum" data-wa-export-known>
            {known}
          </Text>
        </FormRow>
      )}
      <div style={{ padding: '10px 16px 14px' }}>
        <input ref={input} type="file" multiple accept=".zip,.txt,application/zip,text/plain" hidden onChange={(e) => picked(e.currentTarget.files)} data-wa-export-input />
        <Button fullWidth variant="light" leftSection={<IconFileImport size={18} />} loading={busy} onClick={() => input.current?.click()} data-wa-export-pick>
          {t('wa.export.pick')}
        </Button>
      </div>
      <LazySheet opened={!!items}>{(o) => <ExportSheet opened={o} items={items ?? []} onChange={setItems} onClose={() => setItems(null)} />}</LazySheet>
    </RowGroup>
  );
}

function ExportSheet({ opened, items, onChange, onClose }: { opened: boolean; items: ExportItem[]; onChange: (x: ExportItem[]) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const { run, busy } = useAction({ exclusive: true });
  const [choosing, setChoosing] = useState<number | null>(null);
  const set = (k: number, patch: Partial<ExportItem>) => onChange(items.map((x, i) => (i === k ? { ...x, ...patch } : x)));
  const n = items.filter(ready).length;
  const learn = () =>
    void run(async () => {
      const r = await learnExports(items.filter(ready));
      haptic('success');
      notifications.show({ color: 'green', autoClose: 8000, message: t('wa.export.done', { chats: r.chats, turns: r.turns, from: r.from ? formatDate(new Date(r.from).toISOString()) : '—' }) });
      onClose();
    });
  return (
    <Modal opened={opened} onClose={onClose} title={t('wa.export.sheet', { n: items.length })} classNames={{ content: 'sheet-grouped' }}>
      <Stack gap="md">
        <div className="ios-group">
          {items.map((x, k) => (
            <div key={k} className="wa-export-row" data-wa-export-row={k} data-ready={ready(x) || undefined}>
              <span className="wa-export-icon" aria-hidden>
                {x.group ? <IconUsersGroup size={20} /> : ready(x) ? <IconCircleCheckFilled size={20} color="var(--mantine-color-green-6)" /> : <IconAlertCircle size={20} color="var(--mantine-color-orange-6)" />}
              </span>
              <span className="wa-export-main">
                <span className="wa-export-name">{x.chat?.name || x.name}</span>
                <span className="wa-export-sub tnum">
                  {x.empty
                    ? t('wa.export.empty')
                    : x.group
                      ? t('wa.export.group')
                      : t('wa.export.span', { from: formatDate(new Date(x.from).toISOString()), to: formatDate(new Date(x.to).toISOString()), n: x.count })}
                </span>
                {!x.empty && !x.group && (
                  <Group gap={6} mt={6} wrap="wrap">
                    {!x.chat && (
                      <Button size="compact-sm" variant="light" color="orange" onClick={() => setChoosing(k)} data-wa-export-choose>
                        {t('wa.export.choose')}
                      </Button>
                    )}
                    {x.parsed.senders.length === 2 && (
                      <>
                        <Text span size="xs" c="dimmed">
                          {t('wa.export.garage')}
                        </Text>
                        {x.parsed.senders.map((s) => (
                          <button key={s} type="button" className="chip" data-active={x.garage === s ? 'true' : undefined} aria-pressed={x.garage === s} onClick={() => set(k, { garage: s })} data-wa-export-garage={s}>
                            {s}
                          </button>
                        ))}
                      </>
                    )}
                  </Group>
                )}
              </span>
            </div>
          ))}
        </div>
        <div className="sheet-footer">
          <Button fullWidth size="lg" loading={busy} disabled={!n} onClick={learn} data-wa-export-learn>
            {t('wa.export.learn', { n })}
          </Button>
        </div>
      </Stack>
      <ChatPicker
        opened={choosing !== null}
        kind="person"
        title={t('wa.export.choose')}
        onClose={() => setChoosing(null)}
        onPick={(to) => {
          // (a chat whose number WhatsApp hides — its number from the list, not from its id)
          if (choosing !== null) set(choosing, { chat: { id: to.chat, phone: waStore().chats.find((c) => c.id === to.chat)?.phone ?? (to.chat.endsWith('@c.us') ? waDigits(`+${to.chat.split('@')[0]}`) : ''), name: to.name } });
          setChoosing(null);
        }}
      />
    </Modal>
  );
}
