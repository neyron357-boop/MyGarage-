import { Button, Group, Loader } from '@mantine/core';
import { IconBrandWhatsapp, IconExternalLink, IconLock, IconMessageCircleSearch, IconSwitchHorizontal } from '@tabler/icons-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { formatPhone } from '../../domain/phone';
import { chatPath, waDigits } from '../../domain/whatsapp';
import type { OrderBundle } from '../../services/orders';
import { chatOfNumber, chatOfPhone, useWa, waReady } from '../../services/whatsapp';
import { useWaSel } from '../../ui/waSel';
import { EmptyState, PersonAvatar } from '../../ui/components';
import { haptic } from '../../ui/haptics';
import { useDesk } from '../../ui/desk';
import { ChatThread } from './ChatThread';
import { ChatPicker } from './ChatPicker';
import { ChatHead, useWaPeople } from './WaParts';
import { WaGate } from './WhatsAppPage';

/*
 * A job's «WhatsApp» tab (v0.80, the owner: «раньше при свайпе открывались заметки — нужно чтобы вместо заметки
 * открылся чат с клиентом и сразу можно было написать; непрочитанные должны подсвечиваться»): the customer's chat
 * right on the job — the same chat as in «WhatsApp» (read from the garage's server, kept right by its stream: what a
 * PC writes is here at once), and «＋» with this job's documents first.
 *
 * v0.84 (the brief: «в заказе рядом компактно показывается автомобиль… из карточки заказа переписка открывает связанного
 * получателя; при отсутствующем или неоднозначном соответствии покажи выбор контакта»): over the chat — whose it is (the
 * customer, the number; a tap — the whole chat in «WhatsApp», «Назад» comes back to this tab); two numbers — the other
 * one a tap away; no number or no WhatsApp on it — «Выбрать чат» (for this visit of the app; nothing is written).
 */

/** The customer's number as WhatsApp knows it: their WhatsApp, else their phone. */
export const jobChatPhone = (b: Pick<OrderBundle, 'customer'>): string => b.customer.whatsapp || b.customer.phone;

/** The customer's numbers, each once (their WhatsApp first). */
const numbersOf = (b: Pick<OrderBundle, 'customer'>): string[] => {
  const out: string[] = [];
  for (const p of [b.customer.whatsapp, b.customer.phone]) if (p && waDigits(p) && !out.some((x) => waDigits(x) === waDigits(p))) out.push(p);
  return out;
};

/** A number's chat: from the chats read at once, else asked of the server once (null — not on WhatsApp). */
export function useNumberChat(phone: string | undefined): { id?: string; none: boolean } {
  const ready = useWaSel(waReady);
  const listed = useWaSel((s) => chatOfPhone(phone, s)?.id);
  const [asked, setAsked] = useState<{ phone?: string; id: string | null } | undefined>(undefined);
  useEffect(() => {
    if (listed || !phone || !ready) return undefined;
    let alive = true;
    void chatOfNumber(phone)
      .then((id) => alive && setAsked({ phone, id }))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [listed, phone, ready]);
  const mine = asked?.phone === phone ? asked : undefined;
  return { id: listed ?? mine?.id ?? undefined, none: !listed && mine?.id === null };
}

/** What stands in the way, while it does (the whole state: only then). */
function LiveGate() {
  return <WaGate s={useWa()} />;
}

/** A chat picked by hand for a job (no number, no WhatsApp on it): for this visit of the app — nothing is written. */
const pickedFor = new Map<string, { chat: string; name: string }>();
/** The other number chosen for a job, for this visit. */
const numberFor = new Map<string, number>();

/**
 * Locked until tapped (v0.83, the owner: «вкладку надо вначале заблокировать, потому что могу случайно не то отправить»):
 * a swipe onto the tab shows whose chat and how many unread — the chat itself, with its field, «＋» and the microphone,
 * only after «Открыть чат» (the job remembers it for this visit). Nothing of the chat is drawn before.
 */
export function JobChat({ b, open = true, onOpen, unread = 0 }: { b: OrderBundle; open?: boolean; onOpen?: () => void; unread?: number }) {
  const { t } = useTranslation();
  const desk = useDesk();
  const navigate = useNavigate();
  const ready = useWaSel(waReady);
  const people = useWaPeople();
  const numbers = useMemo(() => numbersOf(b), [b]);
  const [which, setWhich] = useState(() => numberFor.get(b.order.id) ?? 0);
  const phone = numbers[which] ?? numbers[0] ?? '';
  const chat = useNumberChat(phone || undefined);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState(() => pickedFor.get(b.order.id));
  const name = b.customer.name || b.customer.companyName || (phone ? formatPhone(phone) : '');
  const car = [b.vehicle.make, b.vehicle.model].filter(Boolean).join(' ');
  const job = [car, `№${b.order.number}`].filter(Boolean).join(' · ');
  if (!ready) return <LiveGate />;
  if (!open) {
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
  const chatId = picked?.chat ?? chat.id;
  const pickSheet = (
    <ChatPicker
      opened={picking}
      onClose={() => setPicking(false)}
      kind="person"
      title={t('wa.pickChat')}
      onPick={(to) => {
        setPicking(false);
        pickedFor.set(b.order.id, to);
        setPicked(to);
      }}
    />
  );
  if (!chatId && (chat.none || !phone))
    return (
      <>
        <EmptyState
          icon={IconBrandWhatsapp}
          title={phone ? t('wa.notOnWa') : t('wa.err.noNumber')}
          action={
            <Group gap="xs" justify="center">
              {numbers.length > 1 && (
                <Button variant="light" leftSection={<IconSwitchHorizontal size={18} />} onClick={() => setWhich((w) => (numberFor.set(b.order.id, (w + 1) % numbers.length), (w + 1) % numbers.length))}>
                  {t('wa.otherNumber')}
                </Button>
              )}
              <Button variant="light" color="green" leftSection={<IconMessageCircleSearch size={18} />} onClick={() => setPicking(true)} data-job-chat-pick>
                {t('wa.pickChat')}
              </Button>
            </Group>
          }
        />
        {picking && pickSheet}
      </>
    );
  if (!chatId)
    return (
      <Group justify="center" py="xl">
        <Loader size="sm" />
      </Group>
    );
  const title = picked?.name ?? name;
  const line = [picked ? '' : phone ? formatPhone(phone) : '', job].filter(Boolean).join(' · ');
  // Whose chat it is, over the messages (v0.84): a tap — the whole chat in «WhatsApp»; «Назад» comes back here.
  const head = (
    <div className="wa-job-head" data-wa-job-head>
      <ChatHead id={chatId} name={title} line={line} onOpen={() => navigate(chatPath(chatId))} size={36} />
      {numbers.length > 1 && !picked && (
        <button
          type="button"
          className="wa-icon-btn tap"
          aria-label={t('wa.otherNumber')}
          onClick={() =>
            setWhich((w) => {
              const n = (w + 1) % numbers.length;
              numberFor.set(b.order.id, n);
              return n;
            })
          }
        >
          <IconSwitchHorizontal size={20} stroke={1.9} />
        </button>
      )}
      <button type="button" className="wa-icon-btn tap" aria-label={t('wa.pickChat')} onClick={() => setPicking(true)} data-job-chat-pick>
        <IconMessageCircleSearch size={20} stroke={1.9} />
      </button>
      <button type="button" className="wa-icon-btn tap" aria-label={t('wa.wholeChat')} onClick={() => navigate(chatPath(chatId))} data-job-chat-whole>
        <IconExternalLink size={19} stroke={1.9} />
      </button>
    </div>
  );
  return (
    <div className="notes-page job-chat" data-job-chat>
      <ChatThread
        key={chatId}
        chatId={chatId}
        title={title}
        group={chatId.endsWith('@g.us')}
        people={people}
        desk={desk}
        quick={{ customerId: b.customer.id, jobId: b.order.id }}
        who={picked ? undefined : { kind: 'customer', id: b.customer.id, name: b.customer.name }}
        phone={picked ? undefined : phone}
        job={job}
        top={head}
      />
      {picking && pickSheet}
    </div>
  );
}
