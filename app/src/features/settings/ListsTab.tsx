import { ActionIcon, Button, Stack, Text } from '@mantine/core';
import { IconArrowUp, IconListDetails, IconPlus, IconX } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cleanList, moveLine, quickList, QUICK_LIST_KEYS, type QuickListKey } from '../../domain/quickLists';
import type { Settings } from '../../domain/types';
import { saveSettings } from '../../services/settings';
import { Section, Tip } from '../../ui/components';
import { useAction } from '../../ui/hooks';

/** A line of a list, edited in place like an iPhone settings row: it is saved when you leave it. */
function LineInput({ value, onCommit, label }: { value: string; onCommit: (v: string) => void; label: string }) {
  const [v, setV] = useState(value);
  const dirty = useRef(false);
  useEffect(() => {
    if (!dirty.current) setV(value);
  }, [value]);
  return (
    <input
      className="quick-input"
      value={v}
      aria-label={label}
      enterKeyHint="done"
      autoCapitalize="sentences"
      onChange={(e) => {
        dirty.current = true;
        setV(e.currentTarget.value);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
      onBlur={() => {
        if (!dirty.current) return;
        dirty.current = false;
        const next = v.trim();
        if (next && next !== value) onCommit(next);
        else setV(value);
      }}
    />
  );
}

function ListEditor({ s, k }: { s: Settings; k: QuickListKey }) {
  const { t } = useTranslation();
  const { run } = useAction();
  const items = quickList(s, k);
  const own = s.quickLists?.[k] !== undefined;
  const [draft, setDraft] = useState('');
  const store = (next: string[]) => run(() => saveSettings({ quickLists: { ...s.quickLists, [k]: cleanList(next) } }));
  const add = () => {
    const v = draft.trim();
    if (!v) return;
    void store([...items, v]);
    setDraft('');
  };
  return (
    <Section title={t(`settings.lists.${k}`)} description={t(`settings.lists.${k}Hint`)}>
      <div className="list">
        {items.map((it, i) => (
          <div className="list-row quick-row" key={`${i}-${it}`}>
            <div className="body">
              <LineInput value={it} label={t('settings.lists.edit')} onCommit={(v) => void store(items.map((x, j) => (j === i ? v : x)))} />
            </div>
            {i > 0 && (
              <ActionIcon variant="subtle" color="gray" size={34} aria-label={t('settings.lists.moveUp')} onClick={() => void store(moveLine(items, i, i - 1))}>
                <IconArrowUp size={18} />
              </ActionIcon>
            )}
            <ActionIcon variant="subtle" color="red" size={34} aria-label={t('common.delete')} onClick={() => void store(items.filter((_, j) => j !== i))}>
              <IconX size={18} />
            </ActionIcon>
          </div>
        ))}
        <div className="list-row quick-row">
          <IconPlus size={18} className="quick-add-icon" aria-hidden />
          <div className="body">
            <input
              className="quick-input"
              value={draft}
              placeholder={t('settings.lists.addPlaceholder')}
              aria-label={t('settings.lists.addPlaceholder')}
              enterKeyHint="done"
              autoCapitalize="sentences"
              onChange={(e) => setDraft(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') add();
              }}
            />
          </div>
          <Button variant="subtle" size="compact-md" disabled={!draft.trim()} onMouseDown={(e) => e.preventDefault()} onClick={add}>
            {t('settings.lists.add')}
          </Button>
        </div>
      </div>
      {own && (
        <Button variant="subtle" size="compact-sm" mt={6} px={4} onClick={() => run(() => saveSettings({ quickLists: { ...s.quickLists, [k]: undefined } }), 'settings.lists.resetDone')}>
          {t('settings.lists.reset')}
        </Button>
      )}
    </Section>
  );
}

/**
 * Settings → Lists: the quick picks that go into customer documents (complaints, warning lights, what
 * works, why a photo is missing) — English by default, edited here line by line.
 */
export function ListsTab({ s, onOpenPrices }: { s: Settings; onOpenPrices: () => void }) {
  const { t } = useTranslation();
  return (
    <Stack gap={0}>
      <Text size="sm" c="dimmed">
        {t('settings.lists.intro')}
      </Text>
      {QUICK_LIST_KEYS.map((k) => (
        <ListEditor key={k} s={s} k={k} />
      ))}
      <Stack mt="xl">
        <Tip
          icon={IconListDetails}
          title={t('settings.tab.prices')}
          actions={
            <Button variant="subtle" onClick={onOpenPrices}>
              {t('settings.lists.openPrices')}
            </Button>
          }
        >
          {t('settings.lists.fromPrices')}
        </Tip>
      </Stack>
    </Stack>
  );
}
