import { Box, Text } from '@mantine/core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PaperLine } from '../../domain/types';
import { List, ListRow } from '../../ui/components';

/** Shown whole up to this many; longer — the first five and «Ещё N». */
const FOLD_AFTER = 6;

/**
 * A receipt's positions as a list of their own (v0.77, the owner: «если в инвойсе есть позиции — отображать их отдельным
 * списком, а не всё одной строкой в заметках»): a row each — the name as read, how many beside it.
 */
export function PaperLines({ lines }: { lines: readonly PaperLine[] }) {
  const { t } = useTranslation();
  const [all, setAll] = useState(false);
  if (!lines.length) return null;
  const shown = all || lines.length <= FOLD_AFTER ? lines : lines.slice(0, FOLD_AFTER - 1);
  return (
    <Box data-paper-lines={lines.length}>
      <div className="group-title">
        {t('ledger.paperLines')} <span className="count">{lines.length}</span>
      </div>
      <List>
        {shown.map((l, i) => (
          <ListRow
            key={i}
            title={
              <Text span inherit lineClamp={2} data-paper-line>
                {l.name}
              </Text>
            }
            right={
              l.qty !== 1 ? (
                <Text span size="sm" c="dimmed" className="tnum">
                  ×{l.qty}
                </Text>
              ) : undefined
            }
          />
        ))}
        {shown.length < lines.length && (
          <ListRow
            onClick={() => setAll(true)}
            title={
              <Text span inherit c="cobalt.6" fw={500}>
                {t('ledger.moreLines', { n: lines.length - shown.length })}
              </Text>
            }
          />
        )}
      </List>
    </Box>
  );
}
