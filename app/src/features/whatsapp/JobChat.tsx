import { Button, Group, Loader } from '@mantine/core';
import { IconBrandWhatsapp, IconLock } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { OrderBundle } from '../../services/orders';
import { chatOfNumber, chatOfPhone, useWa, waReady } from '../../services/whatsapp';
import { useWaSel } from '../../ui/waSel';
import { EmptyState, PersonAvatar } from '../../ui/components';
import { haptic } from '../../ui/haptics';
import { useDesk } from '../../ui/desk';
import { ChatThread } from './ChatThread';
import { useWaPeople } from './WaParts';
import { WaGate } from './WhatsAppPage';

/*
 * A job's «WhatsApp» tab (v0.80, the owner: «раньше при свайпе открывались заметки — нужно чтобы вместо заметки
 * открылся чат с клиентом и сразу можно было написать; непрочитанные должны подсвечиваться»): the customer's chat
 * right on the job — the same chat as in «WhatsApp» (read from the garage's server, kept right by its stream: what a
 * PC writes is here at once), and «＋» with this job's documents first.
 */

/** The customer's number as WhatsApp knows it: their WhatsApp, else their phone. */
export const jobChatPhone = (b: Pick<OrderBundle, 'customer'>): string => b.customer.whatsapp || b.customer.phone;

/** A number's chat: from the chats read at once, else asked of the server once (null — not on WhatsApp). */
export function useNumberChat(phone: string | undefined): { id?: string; none: boolean } {
  const ready = useWaSel(waReady);
  const listed = useWaSel((s) => chatOfPhone(phone, s)?.id);
  const [asked, setAsked] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (listed || !phone || !ready) return undefined;
    let alive = true;
    void chatOfNumber(phone)
      .then((id) => alive && setAsked(id))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [listed, phone, ready]);
  return { id: listed ?? asked ?? undefined, none: !listed && asked === null };
}

/** What stands in the way, while it does (the whole state: only then). */
function LiveGate() {
  return <WaGate s={useWa()} />;
}

/**
 * Locked until tapped (v0.83, the owner: «вкладку надо вначале заблокировать, потому что могу случайно не то отправить»):
 * a swipe onto the tab shows whose chat and how many unread — the chat itself, with its field, «＋» and the microphone,
 * only after «Открыть чат» (the job remembers it for this visit). Nothing of the chat is drawn before.
 */
export function JobChat({ b, open = true, onOpen, unread = 0 }: { b: OrderBundle; open?: boolean; onOpen?: () => void; unread?: number }) {
  const { t } = useTranslation();
  const desk = useDesk();
  const ready = useWaSel(waReady);
  const people = useWaPeople();
  const phone = jobChatPhone(b);
  const chat = useNumberChat(phone);
  if (!ready) return <LiveGate />;
  if (!open) {
    const name = b.customer.name || b.customer.companyName || phone;
    return (
      <div className="job-chat-lock surface" data-job-chat-lock>
        <span className="job-chat-lock-face">
          <PersonAvatar name={name} size={64} />
          <span className="job-chat-lock-badge" aria-hidden>
            <IconLock size={14} stroke={2.4} />
          </span>
        </span>
        <span className="job-chat-lock-name">{name}</span>
        {unread > 0 && <span className="job-chat-lock-unread tnum">{t('wa.unreadN', { count: unread })}</span>}
        <Button size="lg" color="green" radius="xl" leftSection={<IconBrandWhatsapp size={20} />} onClick={() => (haptic('light'), onOpen?.())} data-job-chat-open>
          {t('wa.openChat')}
        </Button>
      </div>
    );
  }
  if (chat.none) return <EmptyState icon={IconBrandWhatsapp} title={t('wa.notOnWa')} />;
  if (!chat.id)
    return (
      <Group justify="center" py="xl">
        <Loader size="sm" />
      </Group>
    );
  return (
    <div className="notes-page job-chat" data-job-chat>
      <ChatThread key={chat.id} chatId={chat.id} title={b.customer.name || phone} group={false} people={people} desk={desk} quick={{ customerId: b.customer.id, jobId: b.order.id }} who={{ kind: 'customer', id: b.customer.id, name: b.customer.name }} phone={phone} />
    </div>
  );
}
