import type { FC } from 'react';
import { Button } from '../ui/Button';

interface Props {
  t: (key: string) => string;
  busy: boolean;
  onReset: () => void;
  bordered?: boolean;
  descriptionClassName?: string;
}

/**
 * Shared "wipe all app data" danger-zone block for encryption dead-end recovery flows —
 * one copy instead of the near-identical block previously repeated across the unlock modal
 * and both branches of the recovery modal.
 */
export const FactoryResetDangerZone: FC<Props> = ({
  t,
  busy,
  onReset,
  bordered = true,
  descriptionClassName = 'text-xs text-[var(--sc-danger-fg)] mb-2',
}) => {
  const content = (
    <>
      <p className={descriptionClassName}>
        {t('settings.data.dangerZone.factoryReset.modalDescription')}
      </p>
      <Button variant="danger" onClick={onReset} disabled={busy} aria-busy={busy}>
        {t('settings.data.dangerZone.factoryReset.button')}
      </Button>
    </>
  );
  return bordered ? (
    <div className="border-t border-[var(--sc-border-subtle)] pt-3">{content}</div>
  ) : (
    content
  );
};
