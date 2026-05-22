import type React from 'react';
import { useAppSelector } from '../../app/hooks';
import { useTranslation } from '../../hooks/useTranslation';
import { Spinner } from './Spinner';

export const SaveStatusIndicator: React.FC = () => {
  const { t } = useTranslation();
  const savingStatus = useAppSelector((state) => state.status.saving);

  if (savingStatus === 'idle') {
    return null;
  }

  return (
    <div className="flex items-center text-sm text-[var(--sc-text-muted)] transition-opacity duration-sc-normal">
      {savingStatus === 'saving' && (
        <>
          <Spinner className="w-4 h-4 mr-2 border-current" />
          <span>{t('common.saving')}</span>
        </>
      )}
      {savingStatus === 'saved' && <span className="text-green-400">{t('common.saved')}</span>}
    </div>
  );
};
