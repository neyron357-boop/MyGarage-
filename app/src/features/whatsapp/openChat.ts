import { notifications } from '@mantine/notifications';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { chatPath } from '../../domain/whatsapp';
import { openWhatsApp } from '../../services/messages';
import { chatOfNumber, chatOfPhone, waReady } from '../../services/whatsapp';
import { useErrorText } from '../../ui/hooks';

/**
 * A customer's WhatsApp from a card of the board (v0.80, the owner: «когда нажимаю на ватсап, открывается внешний
 * ватсап — нужно чтобы если ватсап интегрирован, открылся прямо в приложении чат»): the chat in the app while the
 * garage's WhatsApp is linked; WhatsApp itself, as before, when it is not.
 */
export function useOpenChat(): (phone: string) => void {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const errorText = useErrorText();
  return useCallback(
    (phone: string) => {
      if (!waReady()) return openWhatsApp(phone);
      const listed = chatOfPhone(phone);
      if (listed) return navigate(chatPath(listed.id));
      void chatOfNumber(phone)
        .then((id) => (id ? navigate(chatPath(id)) : notifications.show({ color: 'orange', message: t('wa.notOnWa') })))
        .catch((e) => notifications.show({ color: 'red', message: errorText(e) }));
    },
    [navigate, t, errorText],
  );
}
