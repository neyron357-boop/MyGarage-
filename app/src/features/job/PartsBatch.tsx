import { Button, Modal, Stack, Text } from '@mantine/core';
import { IconCheck } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { OrderItem, ProcurementStatus, Vehicle } from '../../domain/types';
import { setPartsBatch } from '../../services/parts';
import { haptic } from '../../ui/haptics';
import { useAction } from '../../ui/hooks';
import { PART_COLOR } from './LineSheet';
import { SupplierChips } from './PartTools';
import { useOrderGuard } from '../fitment/Fitment';

const STATES: Extract<ProcurementStatus, 'needed' | 'ordered' | 'received'>[] = ['needed', 'ordered', 'received'];

/**
 * The parts picked on a job, all at once (v0.29): one supplier for them (the chips of the car's make, «＋» — a new one),
 * and where they stand — whichever of the two is chosen goes to every picked part (not the customer's own).
 */
export function PartsBatchSheet({ parts, vehicle, opened, onClose, onDone }: { parts: OrderItem[]; vehicle: Vehicle; opened: boolean; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  const order = useOrderGuard();
  const [supplierId, setSupplierId] = useState<string>();
  const [status, setStatus] = useState<(typeof STATES)[number]>();
  useEffect(() => {
    if (!opened) return;
    // The supplier they all share already, if they do.
    const same = new Set(parts.map((p) => p.supplierId ?? ''));
    setSupplierId(same.size === 1 ? [...same][0] || undefined : undefined);
    setStatus(undefined);
  }, [opened, parts]);
  const save = async () => {
    // Ordered with numbers not verified (v0.65): the manager's reason first — else nothing is set.
    if (status === 'ordered' && !(await order.guard(parts.filter((p) => !['ordered', 'in_transit'].includes(p.procurementStatus ?? '')).map((p) => p.id)))) return undefined;
    return run(async () => {
      const n = await setPartsBatch(
        parts.map((p) => p.id),
        { supplierId: supplierId ?? undefined, status },
      );
      haptic('success');
      onDone();
      return n;
    }, 'job.partsSet');
  };
  return (
    <Modal opened={opened} onClose={onClose} title={t('job.partsN', { n: parts.length })}>
      {order.node}
      <Stack gap="lg">
        <div>
          <Text size="sm" fw={600} mb={8}>
            {t('job.supplier')}
          </Text>
          <SupplierChips value={supplierId} onChange={setSupplierId} make={vehicle.make} />
        </div>
        <div>
          <Text size="sm" fw={600} mb={8}>
            {t('job.partState')}
          </Text>
          <div className="chip-row wrap" role="radiogroup">
            {STATES.map((s) => (
              <button
                key={s}
                type="button"
                className="chip"
                role="radio"
                aria-checked={status === s}
                data-active={status === s}
                style={{ '--chip-on': `var(--mantine-color-${PART_COLOR[s]}-filled)` } as React.CSSProperties}
                onClick={() => setStatus(status === s ? undefined : s)}
              >
                {t(`job.part.${s}`)}
              </button>
            ))}
          </div>
        </div>
        <Button size="lg" leftSection={<IconCheck size={20} />} loading={busy} disabled={!supplierId && !status} onClick={() => void save()}>
          {t('job.applyN', { n: parts.length })}
        </Button>
      </Stack>
    </Modal>
  );
}
