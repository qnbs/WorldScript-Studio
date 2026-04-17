import type { FC } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from '../hooks/useTranslation';
import { dbService } from '../services/dbService';
import { generateText, invalidateAiClientCache } from '../services/geminiService';
import { logger } from '../services/logger';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Spinner } from './ui/Spinner';

export const ApiKeySection: FC = () => {
  const { t } = useTranslation();
  const [apiKey, setApiKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showKey, setShowKey] = useState(false);

  const [decryptFailed, setDecryptFailed] = useState(false);

  const checkKeyStatus = useCallback(async () => {
    setIsLoading(true);
    try {
      const exists = await dbService.hasGeminiApiKey();
      setHasKey(exists);
      // Check if key exists but decryption failed (device change, cleared site data)
      if (!exists) {
        const raw = await dbService.getGeminiApiKey();
        if (raw === 'DECRYPT_FAILED') {
          setDecryptFailed(true);
        }
      }
    } catch (error) {
      logger.error('Failed to check API key status:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    checkKeyStatus();
  }, [checkKeyStatus]);

  const handleSaveKey = async () => {
    if (!apiKey.trim()) {
      setMessage({ type: 'error', text: t('settings.apiKey.errorEmpty') });
      return;
    }
    if (!apiKey.trim().startsWith('AIza')) {
      setMessage({ type: 'error', text: t('settings.apiKey.errorInvalid') });
      return;
    }
    setIsSaving(true);
    setMessage(null);
    try {
      await dbService.saveGeminiApiKey(apiKey.trim());
      invalidateAiClientCache();
      setApiKey('');
      setHasKey(true);
      setDecryptFailed(false);
      setMessage({ type: 'success', text: t('settings.apiKey.saved') });
      setTestResult(null);
    } catch (error: unknown) {
      logger.error('Failed to save API key:', error);
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : t('settings.apiKey.errorSave'),
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemoveKey = async () => {
    setIsSaving(true);
    setMessage(null);
    setTestResult(null);
    try {
      await dbService.clearGeminiApiKey();
      invalidateAiClientCache();
      setHasKey(false);
      setMessage({ type: 'success', text: t('settings.apiKey.removed') });
    } catch (error: unknown) {
      logger.error('Failed to remove API key:', error);
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : t('settings.apiKey.errorRemove'),
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      // Einfacher Ping: kurze Generierungsaufgabe
      const result = await generateText('Reply with exactly one word: "OK"', 'Focused');
      if (result && result.length > 0) {
        setTestResult({ ok: true, text: t('apiKey.connectionSuccess') });
      } else {
        setTestResult({ ok: false, text: 'API returned an empty response.' });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('apiKey.connectionFailed');
      if (msg.includes('INVALID_API_KEY')) {
        setTestResult({
          ok: false,
          text: t('apiKey.invalidKey'),
        });
        setHasKey(false);
      } else if (msg.includes('RATE_LIMITED')) {
        setTestResult({
          ok: false,
          text: t('apiKey.rateLimited'),
        });
      } else if (msg.includes('OFFLINE')) {
        setTestResult({ ok: false, text: t('apiKey.noInternet') });
      } else {
        setTestResult({ ok: false, text: msg });
      }
    } finally {
      setIsTesting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner className="w-6 h-6" />
      </div>
    );
  }

  return (
    <section className="space-y-4" aria-labelledby="api-key-heading">
      <div className="flex items-center justify-between">
        <h3 id="api-key-heading" className="text-lg font-semibold text-[var(--foreground-primary)]">
          {t('settings.apiKey.title')}
        </h3>
        <span
          className={`px-2 py-1 text-xs rounded-full ${
            hasKey ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'
          }`}
        >
          {hasKey ? t('settings.apiKey.statusActive') : t('settings.apiKey.statusInactive')}
        </span>
      </div>

      {/* Security Notice */}
      <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/30">
        <div className="flex items-start gap-3">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
            />
          </svg>
          <div className="text-sm text-amber-200">
            <p className="font-medium mb-1">{t('settings.apiKey.securityTitle')}</p>
            <ul className="list-disc list-inside space-y-1 text-amber-200/80">
              <li>{t('settings.apiKey.securityTip1')}</li>
              <li>{t('settings.apiKey.securityTip2')}</li>
              <li>{t('settings.apiKey.securityTip3')}</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Decrypt Failed Warning */}
      {decryptFailed && (
        <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/30">
          <div className="flex items-start gap-3">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
              />
            </svg>
            <div className="text-sm text-red-300">
              <p className="font-medium mb-1">{t('apiKey.decryptFailed')}</p>
              <p className="text-red-300/80">{t('apiKey.decryptFailedDetail')}</p>
            </div>
          </div>
        </div>
      )}

      {/* Key Status / Input */}
      {hasKey ? (
        <div className="flex items-center justify-between p-4 rounded-lg bg-[var(--background-tertiary)] border border-[var(--border-primary)]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                className="w-5 h-5 text-green-400"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <div>
              <p className="font-medium text-[var(--foreground-primary)]">
                {t('settings.apiKey.configured')}
              </p>
              <p className="text-sm text-[var(--foreground-secondary)]">
                {t('settings.apiKey.encryptedNote')}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            {/* Test-Verbindung Button */}
            <Button
              variant="secondary"
              size="sm"
              onClick={handleTestConnection}
              disabled={isTesting || isSaving}
              title={t('apiKey.testConnection')}
            >
              {isTesting ? (
                <>
                  <Spinner className="w-3 h-3 mr-1" /> {t('apiKey.testing')}
                </>
              ) : (
                <>
                  <svg
                    className="w-3.5 h-3.5 mr-1"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 010 1.972l-11.54 6.347a1.125 1.125 0 01-1.667-.986V5.653z"
                    />
                  </svg>
                  {t('apiKey.test')}
                </>
              )}
            </Button>
            <Button variant="danger" size="sm" onClick={handleRemoveKey} disabled={isSaving}>
              {isSaving ? <Spinner className="w-4 h-4" /> : t('settings.apiKey.remove')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <label
              htmlFor="gemini-api-key"
              className="block text-sm font-medium text-[var(--foreground-secondary)] mb-2"
            >
              {t('settings.apiKey.inputLabel')}
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  id="gemini-api-key"
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveKey()}
                  placeholder="AIza..."
                  autoComplete="off"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--foreground-muted)] hover:text-[var(--foreground-primary)]"
                  aria-label={showKey ? t('settings.apiKey.hide') : t('settings.apiKey.show')}
                >
                  {showKey ? (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={1.5}
                      stroke="currentColor"
                      className="w-5 h-5"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88"
                      />
                    </svg>
                  ) : (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={1.5}
                      stroke="currentColor"
                      className="w-5 h-5"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"
                      />
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                      />
                    </svg>
                  )}
                </button>
              </div>
              <Button onClick={handleSaveKey} disabled={isSaving || !apiKey.trim()}>
                {isSaving ? <Spinner className="w-4 h-4" /> : t('settings.apiKey.save')}
              </Button>
            </div>
          </div>

          <p className="text-sm text-[var(--foreground-muted)]">
            {t('settings.apiKey.getKeyHint')}{' '}
            <a
              href="https://aistudio.google.com/app/apikey"
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-400 hover:text-indigo-300 underline"
            >
              Google AI Studio
            </a>
          </p>
        </div>
      )}

      {/* Test-Ergebnis */}
      {testResult && (
        <div
          className={`p-3 rounded-lg text-sm flex items-start gap-2 ${
            testResult.ok
              ? 'bg-green-500/10 text-green-400 border border-green-500/30'
              : 'bg-red-500/10 text-red-400 border border-red-500/30'
          }`}
        >
          {testResult.ok ? (
            <svg
              className="w-4 h-4 flex-shrink-0 mt-0.5"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          ) : (
            <svg
              className="w-4 h-4 flex-shrink-0 mt-0.5"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
              />
            </svg>
          )}
          {testResult.text}
        </div>
      )}

      {/* Allgemeine Statusmeldung */}
      {message && (
        <div
          className={`p-3 rounded-lg text-sm ${
            message.type === 'success'
              ? 'bg-green-500/10 text-green-400 border border-green-500/30'
              : 'bg-red-500/10 text-red-400 border border-red-500/30'
          }`}
        >
          {message.text}
        </div>
      )}
    </section>
  );
};

export default ApiKeySection;
