import { Group, Loader } from '@mantine/core';
import { IconBrandWhatsapp } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { OrderBundle } from '../../services/orders';
import { chatOfNumber, chatOfPhone, useWa, waReady } from '../../services/whatsapp';
import { EmptyState } from '../../ui/components';
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
  const s = useWa();
  const ready = waReady(s);
  const listed = chatOfPhone(phone, s)?.id;
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

export function JobChat({ b }: { b: OrderBundle }) {
  const { t } = useTranslation();
  const desk = useDesk();
  const s = useWa();
  const people = useWaPeople();
  const phone = jobChatPhone(b);
  const chat = useNumberChat(phone);
  if (!waReady(s)) return <WaGate s={s} />;
  if (chat.none) return <EmptyState icon={IconBrandWhatsapp} title={t('wa.notOnWa')} />;
  if (!chat.id)
    return (
      <Group justify="center" py="xl">
        <Loader size="sm" />
      </Group>
    );
  return (
    <div className="notes-page job-chat" data-job-chat>
      <ChatThread key={chat.id} chatId={chat.id} title={b.customer.name || phone} group={false} people={people} desk={desk} quick={{ customerId: b.customer.id, jobId: b.order.id }} />
    </div>
  );
}
