import { Group, Loader, Modal, Stack, Text } from '@mantine/core';
import { IconBuildingCommunity, IconCar, IconFileDollar, IconFileInvoice, IconFileText, IconPaperclip, IconPlus, IconUser, type Icon } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { formatPlate } from '../../domain/plates';
import { chatJobs, findJobs, type ChatJobs } from '../../services/chatJobs';
import { invoicePdf, quotationPdf } from '../../services/documents';
import { activeInvoice } from '../../domain/invoice';
import { statementPdf } from '../../services/debtDocs';
import { phaseOf, syncStage } from '../../services/flow';
import type { OrderBundle } from '../../services/orders';
import { sendClientReport } from '../../services/waAuto';
import { sendWaFile } from '../../services/whatsapp';
import { liveLines } from '../../domain/flow';
import { ConfirmModal, List, ListRow, Money, SearchField } from '../../ui/components';
import { DeskMenu, type DeskMenuItem } from '../../ui/desk';
import { haptic } from '../../ui/haptics';
import { db } from '../../db/db';
import { useAction, useLang, useScreenLiveQuery } from '../../ui/hooks';
import { SendDialog, type SendRequest } from '../../ui/SendDialog';
import { jobDocs } from '../job/jobDocs';
import { PhaseTag } from '../job/phase';
import { QtyCheckSheet } from '../job/QtyCheck';

/*
 * A chat's «＋» (v0.80, the owner: «при нажатии должны открываться быстрые действия касательно этого клиента — быстро
 * отправить смету или инвойс, быстро создать новый заказ для этого клиента…»): photos and files as before, and for the
 * customer of the chat — the estimate and the invoice of each of their jobs (the job of the screen first), a new job for
 * them, their card, their statement when they owe. A document goes as the job's own buttons send it (the same message,
 * the same PDF, an estimate frozen only once it went). A company's own group gets no prices (v0.79): its visit's report.
 * A phone: a sheet; a PC: a menu at «＋».
 */

export interface QuickFor {
  /** The customer the chat is with (by their number), or whose group it is. */
  customerId?: string;
  /** The job the chat is on (a job's «WhatsApp» tab): its documents first. */
  jobId?: string;
  /** A company's own group chat: what goes there has no prices — never an estimate or an invoice. */
  group?: boolean;
}

interface Act {
  key: string;
  label: string;
  icon: Icon;
  color: string;
  run: () => void;
}

const carOf = (b: OrderBundle) => [b.vehicle.make, b.vehicle.model].filter(Boolean).join(' ');

/**
 * A chat that is not a customer's (v0.80.3, the owner: «если это не клиент или босс — при нажатии отправлять по выбору
 * инвойс или смету по поиску»): photos and files, and any job found — by its number, a plate, a car, a name or a number;
 * nothing typed — the jobs on the board — its quote or its invoice as a PDF, into this chat at once. (To the customer
 * himself an estimate goes from his own chat, where it is frozen once sent; here it is only a document.)
 */
function AnyQuick({ chatId, opened, onClose, onFiles }: { chatId: string; opened: boolean; onClose: () => void; onFiles: () => void }) {
  const { t } = useTranslation();
  const lang = useLang();
  const { run, busy } = useAction({ exclusive: true });
  const [query, setQuery] = useState('');
  const [jobs, setJobs] = useState<OrderBundle[] | null>(null);
  useEffect(() => {
    if (opened) setQuery('');
  }, [opened]);
  useEffect(() => {
    if (!opened) return undefined;
    let alive = true;
    const timer = window.setTimeout(() => void findJobs(query).then((r) => alive && setJobs(r)), query ? 200 : 0);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [opened, query]);
  const sendDoc = (b: OrderBundle, kind: 'quote' | 'invoice') =>
    void run(async () => {
      const inv = activeInvoice(b.invoices);
      const file = kind === 'invoice' && inv ? await invoicePdf(inv.id) : await quotationPdf(b.order.id);
      const plate = b.vehicle.plate?.number ? formatPlate(b.vehicle.plate, lang) : '';
      await sendWaFile(chatId, file.blob, { name: file.filename, doc: true, caption: [`№${b.order.number}`, carOf(b), plate].filter(Boolean).join(' · ') });
      haptic('success');
      onClose();
    }, 'wa.quick.sent');
  return (
    <Modal opened={opened} onClose={onClose} title={t('wa.quick.title')}>
      <Stack gap="sm" data-wa-quick-any>
        <div className="action-tiles">
          <button type="button" className="action-tile" onClick={() => (onClose(), onFiles())} data-wa-quick-act="files">
            <span className="tile-icon" style={{ '--c': 'var(--mantine-color-blue-6)' } as React.CSSProperties}>
              <IconPaperclip size={23} stroke={1.9} aria-hidden />
            </span>
            <span>{t('wa.quick.files')}</span>
          </button>
        </div>
        <SearchField value={query} onChange={setQuery} placeholder={t('wa.quick.find')} />
        {jobs === null ? (
          <Group justify="center" py="md">
            <Loader size="sm" />
          </Group>
        ) : jobs.length === 0 ? (
          <Text c="dimmed" ta="center" py="sm">
            {t('wa.noFound')}
          </Text>
        ) : (
          <List>
            {jobs.map((b) => {
              const inv = activeInvoice(b.invoices);
              const lines = liveLines(b.items).some((i) => i.kind !== 'discount');
              const plate = b.vehicle.plate?.number ? formatPlate(b.vehicle.plate, lang) : '';
              return (
                <ListRow
                  key={b.order.id}
                  title={<span data-wa-quick-job={b.order.id}>{[`№${b.order.number}`, carOf(b)].filter(Boolean).join(' · ')}</span>}
                  subtitle={
                    <span className="wa-quick-sub">
                      <PhaseTag phase={phaseOf(b)} />
                      {plate && <span className="tnum">{plate}</span>}
                      {b.customer.name && <span>{b.customer.name}</span>}
                    </span>
                  }
                  right={
                    <span className="wa-quick-docs">
                      {lines && (
                        <button type="button" className="chip" disabled={busy} onClick={() => sendDoc(b, 'quote')} data-wa-quick-doc="quote">
                          <IconFileDollar size={16} stroke={2} aria-hidden />
                          {t('wa.quick.estimate')}
                        </button>
                      )}
                      {inv && (
                        <button type="button" className="chip" disabled={busy} onClick={() => sendDoc(b, 'invoice')} data-wa-quick-doc="invoice">
                          <IconFileInvoice size={16} stroke={2} aria-hidden />
                          {t('wa.quick.invoice')}
                        </button>
                      )}
                    </span>
                  }
                />
              );
            })}
          </List>
        )}
      </Stack>
    </Modal>
  );
}

export function ChatQuick(props: { chatId: string; quick: QuickFor; desk: boolean; at: { x: number; y: number } | null; opened: boolean; onClose: () => void; onFiles: () => void }) {
  // Not a customer's chat (nor a company's own group): any job's documents, found.
  if (!props.quick.customerId && !props.quick.jobId) return <AnyQuick chatId={props.chatId} opened={props.opened} onClose={props.onClose} onFiles={props.onFiles} />;
  return <CustomerQuick {...props} />;
}

function CustomerQuick({ chatId, quick, desk, at, opened, onClose, onFiles }: { chatId: string; quick: QuickFor; desk: boolean; at: { x: number; y: number } | null; opened: boolean; onClose: () => void; onFiles: () => void }) {
  const { t } = useTranslation();
  const lang = useLang();
  const navigate = useNavigate();
  const { run, busy } = useAction();
  const [data, setData] = useState<ChatJobs | null>(null);
  const [send, setSend] = useState<{ req: SendRequest; orderId: string } | null>(null);
  const [qty, setQty] = useState<{ b: OrderBundle; go: () => void } | null>(null);
  const [statement, setStatement] = useState(false);
  // The lines of the job asked about, as they are now: a quantity put right shows at once.
  const qtyJob = qty?.b.order.id;
  const qtyItems = useScreenLiveQuery(() => (qtyJob ? db.items.where('orderId').equals(qtyJob).toArray() : []), [qtyJob]);

  // Read when «＋» is pressed (the jobs change between two presses).
  useEffect(() => {
    if (!opened) return undefined;
    let alive = true;
    void chatJobs(quick.customerId, quick.jobId).then((d) => alive && setData(d));
    return () => {
      alive = false;
    };
  }, [opened, quick.customerId, quick.jobId]);

  const close = (then?: () => void) => () => {
    onClose();
    then?.();
  };
  const jobActs = (b: OrderBundle): Act[] => {
    const oid = b.order.id;
    if (quick.group) return [{ key: 'report', label: t('wa.quick.report'), icon: IconBuildingCommunity, color: 'teal', run: () => void run(() => sendClientReport(oid), 'wa.sentToGroup') }];
    const d = jobDocs(b);
    const acts: Act[] = [];
    const estimate = d.estimate;
    if (estimate) {
      const go = () => void run(async () => setSend({ req: await estimate.make(), orderId: oid }));
      acts.push({ key: 'estimate', label: t('wa.quick.estimate'), icon: IconFileDollar, color: 'violet', run: () => (d.qtyAsk ? setQty({ b, go }) : go()) });
    }
    const invoice = d.invoice;
    if (invoice) acts.push({ key: 'invoice', label: t('wa.quick.invoice'), icon: IconFileInvoice, color: 'green', run: () => setSend({ req: invoice(), orderId: oid }) });
    return acts;
  };
  const customer = data?.customer;
  const jobs = data?.jobs ?? [];
  const tops: Act[] = [
    { key: 'files', label: t('wa.quick.files'), icon: IconPaperclip, color: 'blue', run: onFiles },
    ...(customer ? [{ key: 'newJob', label: t('wa.quick.newJob'), icon: IconPlus, color: 'cobalt', run: () => navigate(`/orders/new?customerId=${customer.id}`) }] : []),
    ...(customer ? [{ key: 'customer', label: t('wa.quick.customer'), icon: IconUser, color: 'indigo', run: () => navigate(`/customers/${customer.id}`) }] : []),
    ...(customer && data.owesFils > 0 && !quick.group ? [{ key: 'statement', label: t('wa.quick.statement'), icon: IconFileText, color: 'red', run: () => setStatement(true) }] : []),
  ];
  const plate = (b: OrderBundle) => (b.vehicle.plate?.number ? formatPlate(b.vehicle.plate, lang) : '');

  const sheets = (
    <>
      {customer && <SendDialog customer={customer} request={send?.req ?? null} onClose={() => setSend(null)} onSent={() => send && void syncStage(send.orderId)} />}
      {qty && (
        <QtyCheckSheet
          items={liveLines(qtyItems?.length ? qtyItems : qty.b.items)}
          lang={qty.b.order.docLanguage}
          opened={!!qty}
          onClose={() => setQty(null)}
          onGo={() => {
            const go = qty.go;
            setQty(null);
            go();
          }}
          goLabel={t('wa.quick.estimate')}
        />
      )}
      <ConfirmModal
        opened={statement}
        onClose={() => setStatement(false)}
        title={t('wa.quick.statementAsk')}
        confirmLabel={t('wa.send')}
        color="green"
        onConfirm={() =>
          run(async () => {
            if (!customer) return;
            const pdf = await statementPdf(customer.id);
            await sendWaFile(chatId, pdf.blob, { name: pdf.filename, doc: true });
            haptic('success');
            setStatement(false);
          }, 'wa.quick.sent')
        }
      >
        {customer && (
          <Text size="sm" c="dimmed">
            <Money fils={data?.owesFils ?? 0} />
          </Text>
        )}
      </ConfirmModal>
    </>
  );

  if (desk) {
    const items: DeskMenuItem[] = [
      ...tops.slice(0, 1).map((a) => ({ key: a.key, label: a.label, icon: a.icon, onClick: a.run })),
      ...jobs.flatMap((b) => {
        const name = [carOf(b), [b.vehicle.plate?.code, b.vehicle.plate?.number].filter(Boolean).join(' ')].filter(Boolean).join(' ');
        const acts = jobActs(b);
        return [
          ...acts.map((a, i) => ({ key: `${b.order.id}-${a.key}`, label: `${a.label} — ${name}`, icon: a.icon, onClick: a.run, divided: i === 0 })),
          { key: `${b.order.id}-open`, label: `${t('wa.quick.job')} — ${name}`, icon: IconCar, onClick: () => navigate(`/orders/${b.order.id}`), divided: !acts.length },
        ];
      }),
      ...tops.slice(1).map((a, i) => ({ key: a.key, label: a.label, icon: a.icon, onClick: a.run, divided: i === 0 })),
    ];
    return (
      <>
        <DeskMenu at={opened ? at : null} items={items} onClose={onClose} label={t('wa.quick.title')} width={320} />
        {sheets}
      </>
    );
  }

  return (
    <>
      <Modal opened={opened} onClose={onClose} title={customer ? customer.name || t('wa.quick.title') : t('wa.quick.title')}>
        <div className="action-tiles" data-wa-quick>
          {tops.map((a) => (
            <button key={a.key} type="button" className="action-tile" onClick={close(a.run)} data-wa-quick-act={a.key}>
              <span className="tile-icon" style={{ '--c': `var(--mantine-color-${a.color}-6)` } as React.CSSProperties}>
                <a.icon size={23} stroke={1.9} aria-hidden />
              </span>
              <span>{a.label}</span>
            </button>
          ))}
        </div>
        {!data && (quick.customerId || quick.jobId) ? (
          <Group justify="center" py="md">
            <Loader size="sm" />
          </Group>
        ) : jobs.length > 0 ? (
          <>
            <div className="group-title wa-quick-title">{t('wa.quick.jobs')}</div>
            <List>
              {jobs.map((b) => (
                <ListRow
                  key={b.order.id}
                  onClick={close(() => navigate(`/orders/${b.order.id}`))}
                  title={<span data-wa-quick-job={b.order.id}>{carOf(b) || `№${b.order.number}`}</span>}
                  subtitle={
                    <span className="wa-quick-sub">
                      <PhaseTag phase={phaseOf(b)} />
                      {plate(b) && <span className="tnum">{plate(b)}</span>}
                    </span>
                  }
                  right={
                    <span className="wa-quick-docs">
                      {jobActs(b).map((a) => (
                        <button
                          key={a.key}
                          type="button"
                          className="chip"
                          disabled={busy}
                          data-wa-quick-doc={a.key}
                          onClick={(e) => {
                            e.stopPropagation();
                            onClose();
                            a.run();
                          }}
                        >
                          <a.icon size={16} stroke={2} aria-hidden />
                          {a.label}
                        </button>
                      ))}
                    </span>
                  }
                />
              ))}
            </List>
          </>
        ) : null}
      </Modal>
      {sheets}
    </>
  );
}

