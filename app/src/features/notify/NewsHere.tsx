import { notifications } from '@mantine/notifications';
import { useEffect } from 'react';
import { onNewsHere } from '../../services/news';
import { openRoute } from '../../ui/openRoute';

/**
 * News seen by this device while it is on screen (v0.97, services/news.ts): not pushed back to it — shown here, its words
 * as the phone's notification would say them; a tap opens the job.
 */
export function NewsHere() {
  useEffect(
    () =>
      onNewsHere((n) => {
        const id = `news:${n.key}`;
        notifications.show({
          id,
          title: n.title,
          message: n.body ?? '',
          autoClose: 7000,
          className: 'news-here',
          onClick: () => {
            notifications.hide(id);
            if (n.url?.startsWith('#/')) openRoute(n.url.slice(1));
          },
        });
      }),
    [],
  );
  return null;
}
