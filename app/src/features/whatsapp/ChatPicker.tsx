import { Button, Group, Loader, Modal, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconMessagePlus } from '@tabler/icons-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatPhone } from '../../domain/phone';
import type { WaTarget } from '../../domain/waAuto';
import { chatTitle, orderChats, waDigits, whoOf, type WaChat } from '../../domain/whatsapp';
import { loadChats, numberOnWa, useWa, waReady } from '../../services/whatsapp';
import { List, ListRow, ScrollTabs, SearchField } from '../../ui/components';
import { useAction } from '../../ui/hooks';
import { useWaPeople, WaAvatar, WhoTag } from './WaParts';

/*
 * A chat picked for a report (v0.79): a group (the work group, the wash, a company's) or a person (the boss) — from the
 * garage's WhatsApp chats, or a number typed. What is kept is the chat's id and its name as it was then.
 */

export function ChatPicker({ opened, onClose, onPick, kind, title, onClear }: { opened: boolean; onClose: () => void; onPick: (to: WaTarget) => void; kind: 'group' | 'person'; title: string; /** A chat set already: «Убрать» takes it off. */ onClear?: () => void }) {
  const { t } = useTranslation();
  const s = useWa();
  const people = useWaPeople();
  const [tab, setTab] = useState<'group' | 'person'>(kind);
  const [query, setQuery] = useState('');
  const { run, busy } = useAction({ exclusive: true });
  useEffect(() => {
    if (opened) {
      setTab(kind);
      setQuery('');
      void loadChats();
    }
  }, [opened, kind]);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const qd = q.replace(/\D/g, '').replace(/^0+/, '');
    return orderChats(
      s.chats.filter((c) => (tab === 'group' ? c.group : !c.group && !c.self)).filter((c) => {
        if (!q) return true;
        const name = `${chatTitle(c, whoOf(c, people))} ${c.name}`.toLowerCase();
        return name.includes(q) || (qd.length >= 3 && c.phone.includes(qd));
      }),
    ).slice(0, 80);
  }, [s.chats, tab, query, people]);
  const digits = tab === 'person' ? waDigits(query) : '';
  const pick = (c: Pick<WaChat, 'id' | 'name' | 'phone' | 'group'>) => {
    onPick({ chat: c.id, name: chatTitle(c, whoOf(c, people)) || c.name || (c.phone ? `+${c.phone}` : c.id) });
    onClose();
  };
  const byNumber = () =>
    void run(async () => {
      const r = await numberOnWa(digits);
      if (!r.ok) {
        notifications.show({ color: 'orange', message: t('wa.notOnWa') });
        return;
      }
      const known = s.chats.find((c) => c.id === r.chat);
      pick(known ?? { id: r.chat, name: formatPhone(`+${digits}`), phone: digits, group: false });
    });
  return (
    <Modal opened={opened} onClose={onClose} title={title}>
      <Stack gap="sm" data-chat-picker={kind}>
        {!waReady(s) ? (
          <Text c="dimmed">{t('wa.err.notReady')}</Text>
        ) : (
          <>
            <ScrollTabs segmented value={tab} onChange={(v) => setTab(v as 'group' | 'person')} items={[{ value: 'group', label: t('wa.tab.groups') }, { value: 'person', label: t('wa.auto.people') }]} mb="xs" />
            <SearchField value={query} onChange={setQuery} placeholder={t('wa.search')} />
            {digits && (
              <Button variant="light" color="green" fullWidth loading={busy} leftSection={<IconMessagePlus size={20} />} onClick={byNumber} data-chat-picker-number>
                {formatPhone(`+${digits}`)}
              </Button>
            )}
            {s.chatsLoading && !s.chatsAt ? (
              <Group justify="center" py="md">
                <Loader size="sm" />
              </Group>
            ) : (
              <List>
                {rows.map((c) => {
                  const who = whoOf(c, people);
                  return (
                    <ListRow
                      key={c.id}
                      onClick={() => pick(c)}
                      left={<WaAvatar id={c.id} name={chatTitle(c, who)} group={c.group} size={40} />}
                      title={
                        <span className="wa-row-title" data-chat-pick={c.id}>
                          <span className="wa-row-name">{chatTitle(c, who)}</span>
                          {who && <WhoTag kind={who.kind} />}
                        </span>
                      }
                      subtitle={!c.group && c.phone ? formatPhone(`+${c.phone}`) : undefined}
                    />
                  );
                })}
              </List>
            )}
            {onClear && (
              <Button variant="subtle" color="red" onClick={() => (onClear(), onClose())} data-chat-picker-clear>
                {t('wa.auto.clear')}
              </Button>
            )}
            {!rows.length && !digits && !s.chatsLoading && (
              <Text c="dimmed" ta="center" py="md">
                {t('wa.noFound')}
              </Text>
            )}
          </>
        )}
      </Stack>
    </Modal>
  );
}
