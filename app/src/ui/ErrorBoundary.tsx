import { Button, Code, Group, Stack, Text, ThemeIcon, Title } from '@mantine/core';
import { IconAlertTriangle, IconDownload, IconHome, IconRefresh } from '@tabler/icons-react';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { dubaiDate } from '../domain/dates';
import { saveBackupFile } from '../services/backup';

function Fallback({ error, onReset }: { error: Error; onReset: () => void }) {
  const { t } = useTranslation();
  const isChunk = /dynamically imported module|Importing a module script failed|Failed to fetch/i.test(error.message);
  return (
    <Stack align="center" ta="center" gap="sm" py={48} px="md" className="surface page-enter" maw={560} mx="auto">
      <ThemeIcon size={56} radius="xl" color={isChunk ? 'cobalt' : 'red'} variant="light">
        {isChunk ? <IconRefresh size={28} /> : <IconAlertTriangle size={28} />}
      </ThemeIcon>
      <Title order={3}>{isChunk ? t('crash.updateTitle') : t('crash.title')}</Title>
      <Text size="sm" c="dimmed" maw={420}>
        {isChunk ? t('crash.updateText') : t('crash.text')}
      </Text>
      {!isChunk && (
        <Code block maw="100%" style={{ whiteSpace: 'pre-wrap', textAlign: 'left', fontSize: 12 }}>
          {error.message}
        </Code>
      )}
      <Group justify="center" gap="xs" mt="xs">
        <Button leftSection={<IconRefresh size={18} />} onClick={() => window.location.reload()}>
          {t('crash.reload')}
        </Button>
        {!isChunk && (
          <Button
            variant="default"
            leftSection={<IconHome size={18} />}
            onClick={() => {
              window.location.hash = '#/';
              onReset();
            }}
          >
            {t('crash.home')}
          </Button>
        )}
      </Group>
      {!isChunk && (
        <Button
          variant="subtle"
          size="compact-sm"
          leftSection={<IconDownload size={16} />}
          onClick={() => void saveBackupFile(`mygarage-backup-${dubaiDate()}.mygarage`)}
        >
          {t('crash.backup')}
        </Button>
      )}
    </Stack>
  );
}

/** Keeps one broken screen from blanking the whole app; the data on the device is untouched. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Screen crashed', error, info.componentStack);
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (this.state.error) return <Fallback error={this.state.error} onReset={() => this.setState({ error: null })} />;
    return this.props.children;
  }
}
