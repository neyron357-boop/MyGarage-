import { Alert, Badge, Button, Group, Image, Modal, Paper, SegmentedControl, SimpleGrid, Stack, Text, TextInput, Textarea, Title } from '@mantine/core';
import { IconFileTypePdf, IconRepeat } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { formatDateTime } from '../../domain/dates';
import { REQUIRED_SLOTS } from '../../domain/inspection';
import type { DamageView } from '../../domain/types';
import { closeClaim, createWarrantyOrder, openClaim } from '../../services/claims';
import { inspectionPdf, openPdf } from '../../services/documents';
import { mediaUrl } from '../../services/media';
import { simpleMessage } from '../../services/messages';
import { EmptyState, MediaImage, PageHeader, PlateText } from '../../ui/components';
import { DamageDiagram, ViewPicker } from '../../ui/DamageDiagram';
import { useAction, useOrderBundle } from '../../ui/hooks';
import { SendDialog, type SendRequest } from '../../ui/SendDialog';
import { VersionCard } from '../estimate/components';

function SignatureImg({ id }: { id?: string }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (id) void mediaUrl(id).then(setUrl);
  }, [id]);
  return url ? <Image src={url} h={60} fit="contain" bg="white" radius="sm" /> : <Text size="xs" c="dimmed">—</Text>;
}

export function ClaimPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { run, busy } = useAction();
  const b = useOrderBundle(id);
  const [slot, setSlot] = useState<string>('front');
  const [view, setView] = useState<DamageView>('top');
  const [desc, setDesc] = useState('');
  const [notes, setNotes] = useState('');
  const [warrantyOpen, setWarrantyOpen] = useState(false);
  const [complaint, setComplaint] = useState('');
  const [send, setSend] = useState<SendRequest | null>(null);
  if (!b) return null;
  const before = b.media.find((m) => m.ownerId === b.intake?.id && m.slot === slot);
  const after = b.media.find((m) => m.ownerId === b.handover?.id && m.slot === slot);
  const intakeMarks = b.marks.filter((m) => m.inspectionId === b.intake?.id);
  const openClaimRec = b.claims.find((c) => !c.closedAt);
  const ctx = { customer: b.customer, vehicle: b.vehicle, order: b.order, garageName: b.settings.name };
  return (
    <>
      <PageHeader
        title={t('claim.title')}
        back={`/orders/${b.order.id}`}
        subtitle={<Group gap={6}><PlateText plate={b.vehicle.plate} size="xs" />{b.vehicle.make} {b.vehicle.model} · №{b.order.number}</Group>}
      />
      <Stack>
        {!b.intake?.locked && <Alert color="red">{t('claim.noIntake')}</Alert>}
        <Paper withBorder p="md">
          <Title order={6} mb="xs">{t('claim.compare')}</Title>
          <SegmentedControl fullWidth size="xs" value={slot} onChange={setSlot} data={[...REQUIRED_SLOTS, 'dashboard'].map((s) => ({ value: s, label: t(`slot.${s}`) }))} mb="sm" style={{ overflowX: 'auto' }} />
          <SimpleGrid cols={2}>
            <div>
              <Text size="xs" c="dimmed">{t('handover.before')} · {formatDateTime(b.intake?.signedAt)}</Text>
              {before ? <MediaImage id={before.id} thumb={false} h={220} w="100%" /> : <EmptyState>—</EmptyState>}
            </div>
            <div>
              <Text size="xs" c="dimmed">{t('handover.after')} · {formatDateTime(b.handover?.signedAt)}</Text>
              {after ? <MediaImage id={after.id} thumb={false} h={220} w="100%" /> : <EmptyState>—</EmptyState>}
            </div>
          </SimpleGrid>
        </Paper>
        <Paper withBorder p="md">
          <Title order={6} mb="xs">{t('claim.damageAtIntake')}</Title>
          {b.intake?.noDamage ? <Text size="sm">{t('damage.none')}</Text> : (
            <>
              <ViewPicker value={view} onChange={setView} marks={intakeMarks} />
              <DamageDiagram view={view} marks={intakeMarks} height={200} />
              {intakeMarks.map((m, i) => <Text key={m.id} size="sm">{i + 1}. {t(`damage.type.${m.type}`)} · {t(`damage.view.${m.view}`)} {m.note ?? ''}</Text>)}
            </>
          )}
        </Paper>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          {[b.intake, b.handover].map((insp, idx) => (
            <Paper key={idx} withBorder p="md">
              <Title order={6} mb="xs">{idx === 0 ? t('intake.title') : t('handover.title')}</Title>
              {insp ? (
                <>
                  <Text size="sm">{insp.mileageKm ?? '—'} km · {insp.fuelLevel !== undefined ? t(`fuel.${insp.fuelLevel}`) : '—'}</Text>
                  <Text size="sm">{t('intake.lights')}: {insp.warningLights.length ? insp.warningLights.map((l) => t(`light.${l}`)).join(', ') : t('pdf.none')}</Text>
                  {idx === 0 && <Text size="sm">OBD: {insp.obdNoCodes ? t('intake.obdNone') : insp.obdCodes.join(', ') || insp.obdSkipReason || '—'}</Text>}
                  <Text size="sm">{t('sign.signedBy')}: {insp.signerName} · {formatDateTime(insp.signedAt)}</Text>
                  <SignatureImg id={insp.signatureMediaId} />
                  {insp.locked && <Button mt="xs" size="xs" variant="default" leftSection={<IconFileTypePdf size={14} />} onClick={() => run(async () => openPdf(await inspectionPdf(insp.id)))}>PDF</Button>}
                  {insp.locked && (
                    <Button mt="xs" ml="xs" size="xs" variant="light" onClick={() => setSend({ text: simpleMessage('documents', ctx, b.order.docLanguage), template: 'evidence', lang: b.order.docLanguage, orderId: b.order.id, pdf: () => inspectionPdf(insp.id) })}>
                      {t('claim.sendEvidence')}
                    </Button>
                  )}
                </>
              ) : (
                <Text size="sm" c="dimmed">—</Text>
              )}
            </Paper>
          ))}
        </SimpleGrid>
        <Title order={6}>{t('claim.approvals')}</Title>
        {b.versions.length === 0 ? <Text size="sm" c="dimmed">—</Text> : b.versions.map((v) => <VersionCard key={v.id} v={v} b={b} />)}
        <Paper withBorder p="md">
          <Title order={6} mb="xs">{t('claim.record')}</Title>
          {b.claims.map((c) => (
            <Paper key={c.id} withBorder p="xs" mb="xs">
              <Text size="sm">{formatDateTime(c.openedAt)} · {c.description}</Text>
              {c.closedAt ? <Badge mt={4}>{t(`claim.outcome.${c.outcome}`)} {c.notes ? `· ${c.notes}` : ''}</Badge> : <Badge color="orange" mt={4}>{t('claim.openStatus')}</Badge>}
            </Paper>
          ))}
          {!openClaimRec ? (
            <>
              <Textarea label={t('claim.description')} value={desc} onChange={(e) => setDesc(e.currentTarget.value)} />
              <Button mt="xs" disabled={!desc.trim()} loading={busy} onClick={() => run(async () => { await openClaim(b.order.id, desc); setDesc(''); }, 'common.saved')}>{t('claim.create')}</Button>
            </>
          ) : (
            <>
              <TextInput label={t('claim.result')} value={notes} onChange={(e) => setNotes(e.currentTarget.value)} />
              <Group mt="xs">
                <Button variant="default" onClick={() => run(() => closeClaim(openClaimRec.id, 'rejected', notes), 'common.saved')}>{t('claim.outcome.rejected')}</Button>
                <Button variant="default" onClick={() => run(() => closeClaim(openClaimRec.id, 'goodwill', notes), 'common.saved')}>{t('claim.outcome.goodwill')}</Button>
                <Button leftSection={<IconRepeat size={16} />} onClick={() => { setComplaint(openClaimRec.description); setWarrantyOpen(true); }}>{t('claim.warrantyOrder')}</Button>
              </Group>
            </>
          )}
        </Paper>
      </Stack>
      <Modal opened={warrantyOpen} onClose={() => setWarrantyOpen(false)} title={t('claim.warrantyOrder')}>
        <Textarea label={t('order.complaint')} value={complaint} onChange={(e) => setComplaint(e.currentTarget.value)} />
        <Button mt="md" fullWidth onClick={() => run(async () => { const o = await createWarrantyOrder(b.order.id, complaint, openClaimRec?.id); navigate(`/orders/${o.id}/intake`); })}>{t('claim.createWarranty')}</Button>
      </Modal>
      <SendDialog customer={b.customer} request={send} onClose={() => setSend(null)} />
    </>
  );
}
