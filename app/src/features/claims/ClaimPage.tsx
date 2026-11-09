import { Alert, Badge, Box, Button, Group, Image, Modal, SegmentedControl, SimpleGrid, Stack, Text, Textarea, TextInput } from '@mantine/core';
import { IconAlertTriangle, IconFileTypePdf, IconRepeat, IconSend } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { formatDateTime } from '../../domain/dates';
import { REQUIRED_SLOTS } from '../../domain/inspection';
import { lightLabel } from '../../domain/quickLists';
import type { DamageView } from '../../domain/types';
import { closeClaim, createWarrantyOrder, openClaim } from '../../services/claims';
import { inspectionPdf, openPdf } from '../../services/documents';
import { mediaUrl } from '../../services/media';
import { simpleMessage } from '../../services/messages';
import { Field, MediaImage, PageHeader, PageSkeleton, PlateText, ScrollTabs, Section } from '../../ui/components';
import { DamageDiagram } from '../../ui/DamageDiagram';
import { useAction, useOrderBundle } from '../../ui/hooks';
import { SendDialog, type SendRequest } from '../../ui/SendDialog';
import { VersionCard } from '../estimate/components';

function SignatureImg({ id }: { id?: string }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (id) void mediaUrl(id).then(setUrl);
  }, [id]);
  return url ? <Image src={url} h={56} w={160} fit="contain" bg="white" radius="sm" /> : <Text size="xs" c="dimmed">—</Text>;
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
  if (!b) return <PageSkeleton variant="detail" />;
  const before = b.media.find((m) => m.ownerId === b.intake?.id && m.slot === slot);
  const after = b.media.find((m) => m.ownerId === b.handover?.id && m.slot === slot);
  const intakeMarks = b.marks.filter((m) => m.inspectionId === b.intake?.id);
  const openClaimRec = b.claims.find((c) => !c.closedAt);
  const ctx = { customer: b.customer, vehicle: b.vehicle, order: b.order, garageName: b.settings.name };
  return (
    <>
      <PageHeader
        back={`/orders/${b.order.id}`}
        eyebrow={`${t('order.title')} №${b.order.number}`}
        title={t('claim.title')}
        subtitle={
          <Group gap={8}>
            <PlateText plate={b.vehicle.plate} size="xs" />
            {b.vehicle.make} {b.vehicle.model}
          </Group>
        }
      />
      <Stack gap="lg">
        {!b.intake?.locked && (
          <Alert color="red" icon={<IconAlertTriangle size={18} />}>
            {t('claim.noIntake')}
          </Alert>
        )}
        <Section title={t('claim.compare')} description={t('claim.compareHint')} mt={0}>
          <ScrollTabs value={slot} onChange={setSlot} mb="sm" items={[...REQUIRED_SLOTS, 'dashboard'].map((s) => ({ value: s, label: t(`slot.${s}`) }))} />
          <SimpleGrid cols={2} spacing="sm">
            {[
              { label: t('handover.before'), date: b.intake?.signedAt, m: before },
              { label: t('handover.after'), date: b.handover?.signedAt, m: after },
            ].map((x) => (
              <Box key={x.label} className="surface" p={6}>
                {x.m ? (
                  <MediaImage id={x.m.id} thumb={false} h={200} w="100%" />
                ) : (
                  <Box h={200} className="surface-soft" style={{ display: 'grid', placeItems: 'center', borderRadius: 'var(--mantine-radius-md)' }}>
                    <Text size="sm" c="dimmed">
                      {t('claim.noPhoto')}
                    </Text>
                  </Box>
                )}
                <Stack gap={2} px={4} pt={8} pb={2}>
                  <Badge variant="light" color={x.label === t('handover.before') ? 'gray' : 'cobalt'} w="fit-content">
                    {x.label}
                  </Badge>
                  <Text size="xs" c="dimmed">
                    {x.date ? formatDateTime(x.date) : '—'}
                  </Text>
                </Stack>
              </Box>
            ))}
          </SimpleGrid>
        </Section>
        <Section title={t('claim.damageAtIntake')} mt={0}>
          <Box className="surface" p="md">
            {b.intake?.noDamage ? (
              <Text size="sm">{t('damage.none')}</Text>
            ) : (
              <>
                <SegmentedControl fullWidth value={view} onChange={(v) => setView(v as DamageView)} data={(['top', 'left', 'right', 'front', 'rear'] as const).map((v) => ({ value: v, label: t(`damage.view.${v}`) }))} />
                <Box mt="sm">
                  <DamageDiagram view={view} marks={intakeMarks} height={220} />
                </Box>
                {intakeMarks.map((m, i) => (
                  <Text key={m.id} size="sm">
                    {i + 1}. {t(`damage.type.${m.type}`)} · {t(`damage.view.${m.view}`)} {m.note ?? ''}
                  </Text>
                ))}
              </>
            )}
          </Box>
        </Section>
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
          {[b.intake, b.handover].map((insp, idx) => (
            <Box key={idx} className="surface" p="md">
              <Text fw={700} mb="sm">
                {idx === 0 ? t('intake.title') : t('handover.title')}
              </Text>
              {insp ? (
                <Stack gap="sm">
                  <SimpleGrid cols={2} spacing="sm">
                    <Field label={t('intake.mileage')}>{insp.mileageKm !== undefined ? `${insp.mileageKm.toLocaleString('ru-RU')} ${t('unit.km')}` : '—'}</Field>
                    <Field label={t('intake.fuel')}>{insp.fuelLevel !== undefined ? t(`fuel.${insp.fuelLevel}`) : '—'}</Field>
                    <Field label={t('intake.lights')}>{insp.warningLights.length ? insp.warningLights.map((l) => lightLabel(t, l)).join(', ') : t('pdf.none')}</Field>
                    {idx === 0 && <Field label={t('step.obd')}>{insp.obdNoCodes ? t('intake.obdNone') : insp.obdCodes.join(', ') || insp.obdSkipReason || '—'}</Field>}
                  </SimpleGrid>
                  <Field label={t('sign.signedBy')}>
                    {insp.signerName ?? '—'} · {formatDateTime(insp.signedAt)}
                  </Field>
                  <SignatureImg id={insp.signatureMediaId} />
                  {insp.locked && (
                    <Group gap="xs">
                      <Button size="compact-md" variant="default" leftSection={<IconFileTypePdf size={16} />} onClick={() => run(async () => openPdf(await inspectionPdf(insp.id)))}>
                        PDF
                      </Button>
                      <Button size="compact-md" variant="light" leftSection={<IconSend size={16} />} onClick={() => setSend({ text: simpleMessage('documents', ctx, b.order.docLanguage), template: 'evidence', lang: b.order.docLanguage, orderId: b.order.id, pdf: () => inspectionPdf(insp.id) })}>
                        {t('claim.sendEvidence')}
                      </Button>
                    </Group>
                  )}
                </Stack>
              ) : (
                <Text size="sm" c="dimmed">
                  —
                </Text>
              )}
            </Box>
          ))}
        </SimpleGrid>
        <Section title={t('claim.approvals')} description={t('claim.approvalsHint')} mt={0}>
          {b.versions.length === 0 ? (
            <Text size="sm" c="dimmed">
              —
            </Text>
          ) : (
            <Stack gap="sm">
              {b.versions.map((v) => (
                <VersionCard key={v.id} v={v} b={b} />
              ))}
            </Stack>
          )}
        </Section>
        <Section title={t('claim.record')} mt={0}>
          <Box className="surface" p="md">
            <Stack gap="sm">
              {b.claims.map((c) => (
                <Box key={c.id} className="surface-soft" p="sm">
                  <Group justify="space-between" wrap="nowrap" align="flex-start">
                    <Text size="sm" fw={600}>
                      {c.description}
                    </Text>
                    {c.closedAt ? <Badge color="gray">{t(`claim.outcome.${c.outcome}`)}</Badge> : <Badge color="orange">{t('claim.openStatus')}</Badge>}
                  </Group>
                  <Text size="xs" c="dimmed">
                    {formatDateTime(c.openedAt)}
                    {c.notes ? ` · ${c.notes}` : ''}
                  </Text>
                </Box>
              ))}
              {!openClaimRec ? (
                <>
                  <Textarea label={t('claim.description')} value={desc} onChange={(e) => setDesc(e.currentTarget.value)} autosize minRows={2} />
                  <Button w="fit-content" disabled={!desc.trim()} loading={busy} onClick={() => run(async () => { await openClaim(b.order.id, desc); setDesc(''); }, 'common.saved')}>
                    {t('claim.create')}
                  </Button>
                </>
              ) : (
                <>
                  <TextInput label={t('claim.result')} value={notes} onChange={(e) => setNotes(e.currentTarget.value)} />
                  <Group gap="xs">
                    <Button variant="default" onClick={() => run(() => closeClaim(openClaimRec.id, 'rejected', notes), 'common.saved')}>
                      {t('claim.outcome.rejected')}
                    </Button>
                    <Button variant="default" onClick={() => run(() => closeClaim(openClaimRec.id, 'goodwill', notes), 'common.saved')}>
                      {t('claim.outcome.goodwill')}
                    </Button>
                    <Button leftSection={<IconRepeat size={16} />} onClick={() => { setComplaint(openClaimRec.description); setWarrantyOpen(true); }}>
                      {t('claim.warrantyOrder')}
                    </Button>
                  </Group>
                </>
              )}
            </Stack>
          </Box>
        </Section>
      </Stack>
      <Modal opened={warrantyOpen} onClose={() => setWarrantyOpen(false)} title={t('claim.warrantyOrder')}>
        <Textarea label={t('order.complaint')} value={complaint} onChange={(e) => setComplaint(e.currentTarget.value)} autosize minRows={3} />
        <Button mt="md" fullWidth onClick={() => run(async () => { const o = await createWarrantyOrder(b.order.id, complaint, openClaimRec?.id); navigate(`/orders/${o.id}/intake`); })}>
          {t('claim.createWarranty')}
        </Button>
      </Modal>
      <SendDialog customer={b.customer} request={send} onClose={() => setSend(null)} />
    </>
  );
}
