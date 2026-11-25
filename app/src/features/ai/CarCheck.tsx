import { Box, Button, Modal, Stack, Text } from '@mantine/core';
import { IconCamera, IconHelpCircle, IconPencil, IconScan } from '@tabler/icons-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PhotoCar, VinSaid } from '../../domain/carPhoto';
import type { Vehicle } from '../../domain/types';
import { settleCarCheck } from '../../services/carPhoto';
import { haptic } from '../../ui/haptics';
import { useAction } from '../../ui/hooks';
import { LazySheet } from '../../ui/lazy';
import { VehicleModal } from '../customers/forms';

/*
 * The photo and the VIN say different cars (v0.89, the owner: «если есть разногласия — приложение должно попросить ручное
 * вмешательство»): what each said, one tap each; «Другая» — the car's card to write it. In «Новый заказ» under the make
 * and model; on a job, the orange «Фото ≠ VIN» under the car's name opens it.
 */

const named = (c: { make?: string; model?: string }) => [c.make, c.model].filter(Boolean).join(' ');

/** The two answers, one tap each. */
export function CarChoice({ check, onPick }: { check: { photo: PhotoCar; vin: VinSaid }; onPick: (pick: { make?: string; model?: string }) => void }) {
  const { t } = useTranslation();
  const rows = [
    { key: 'photo', icon: <IconCamera size={20} stroke={2} />, label: t('ai.byPhotoShort'), car: check.photo },
    { key: 'vin', icon: <IconScan size={20} stroke={2} />, label: t('ai.byVin'), car: check.vin },
  ];
  return (
    <Stack gap={8}>
      {rows.map((r) => (
        <button
          key={r.key}
          type="button"
          className="suggest"
          data-car-pick={r.key}
          onClick={() => {
            haptic('selection');
            onPick({ make: r.car.make, model: r.car.model });
          }}
        >
          <span className="car-pick-icon" aria-hidden>
            {r.icon}
          </span>
          <Box style={{ flex: 1, minWidth: 0 }}>
            <Text size="xs" c="dimmed" lh={1.2}>
              {r.label}
            </Text>
            <Text fw={600} lineClamp={1}>
              {named(r.car) || '—'}
              {!r.car.model && (
                <Text span c="dimmed" fw={500}>
                  {' '}
                  ?
                </Text>
              )}
            </Text>
          </Box>
        </button>
      ))}
    </Stack>
  );
}

/** On a job: the orange «Фото ≠ VIN» under the car's name while the question stands; a tap — the choice. */
export function CarCheckPill({ vehicle }: { vehicle: Vehicle }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState(false);
  const { run } = useAction();
  const check = vehicle.carCheck;
  if (!check && !open && !edit) return null;
  return (
    <>
      {check && (
        <button type="button" className="car-check-pill" onClick={() => setOpen(true)} data-car-check>
          <IconHelpCircle size={14} stroke={2.2} aria-hidden />
          {t('ai.checkPill')}
        </button>
      )}
      <LazySheet opened={open && !!check}>
        {(o) => (
          <Modal opened={o} onClose={() => setOpen(false)} title={t('ai.checkTitle')}>
            {check && (
              <Stack gap="md">
                <CarChoice
                  check={check}
                  onPick={(pick) =>
                    run(async () => {
                      await settleCarCheck(vehicle.id, pick);
                      setOpen(false);
                    })
                  }
                />
                <Button
                  variant="subtle"
                  leftSection={<IconPencil size={18} />}
                  onClick={() => {
                    setOpen(false);
                    setEdit(true);
                  }}
                  data-car-other
                >
                  {t('ai.otherCar')}
                </Button>
              </Stack>
            )}
          </Modal>
        )}
      </LazySheet>
      <LazySheet opened={edit}>{(o) => <VehicleModal opened={o} onClose={() => setEdit(false)} vehicle={vehicle} />}</LazySheet>
    </>
  );
}
