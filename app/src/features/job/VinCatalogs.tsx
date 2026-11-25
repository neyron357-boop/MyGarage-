import { notifications } from '@mantine/notifications';
import { IconExternalLink } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { isVin } from '../../domain/vin';
import { vinCatalogs } from '../../domain/vinCatalogs';
import { copyText } from '../../ui/clipboard';
import { haptic } from '../../ui/haptics';

type Car = { vin?: string; make?: string; model?: string; year?: number };

/**
 * The parts catalogues by this car's VIN (v0.66, domain/vinCatalogs.ts), the likeliest for where it was built first: a tap
 * opens one on this car — the VIN in the address (EMEX, EXIST), else copied for pasting into its search. Links only: the
 * manager looks the part up there himself (v0.85 — the AI's catalogue search is gone).
 */
export function VinCatalogsRow({ car }: { car: Car }) {
  const { t } = useTranslation();
  const v = (car.vin ?? '').toUpperCase().replace(/\s/g, '');
  const vin = isVin(v) ? v : '';
  const list = vinCatalogs(car);
  return (
    <div className="ios-row vin-cats" data-vin-catalogs>
      <div className="vin-cats-head">
        <span className="label">{t('vinCats.title')}</span>
        {!vin && <span className="vin-cats-novin">{t('vinCats.noVin')}</span>}
      </div>
      <div className="chip-row wrap vin-cat-row">
        {list.map((c) => (
          <a
            key={c.id}
            className="chip vin-cat"
            href={c.url}
            target="_blank"
            rel="noopener noreferrer"
            data-catalog={c.id}
            data-vin={c.vinInUrl || undefined}
            onClick={() => {
              haptic('selection');
              // A site that does not take the VIN in its address: the VIN copied, to paste into its search.
              if (!c.vinInUrl && vin) void copyText(vin).then((ok) => ok && notifications.show({ message: t('vinCats.copied', { vin }), autoClose: 2500 }));
            }}
          >
            {c.name}
            <IconExternalLink size={13} stroke={2} aria-hidden />
          </a>
        ))}
      </div>
    </div>
  );
}
