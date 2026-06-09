import { ONNX_SUPPORTED_MODELS, WEBLLM_SUPPORTED_MODELS } from '@domain/ai-core';
import type React from 'react';
import { useSettingsViewContext } from '../../contexts/SettingsViewContext';
import { Card, CardContent, CardHeader } from '../ui/Card';

const WEBLLM_USE_CASES: Record<string, string> = {
  'Qwen2.5-0.5B-Instruct-q4f16_1-MLC': 'settings.community.useCase.eco',
  'Llama-3.2-1B-Instruct-q4f16_1-MLC': 'settings.community.useCase.fast',
  'Llama-3.2-3B-Instruct-q4f16_1-MLC': 'settings.community.useCase.balanced',
  'Phi-4-mini-instruct-q4f16_1-MLC': 'settings.community.useCase.reasoning',
  'gemma-3-1b-it-q4f16_1-MLC': 'settings.community.useCase.fast',
  'gemma-3-4b-it-q4f32_1-MLC': 'settings.community.useCase.balanced',
  'Llama-3.3-70B-Instruct-q3f16_1-MLC': 'settings.community.useCase.highEnd',
};

export const CommunitySection: React.FC = () => {
  const { t } = useSettingsViewContext();

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <h2 className="text-xl font-semibold text-[var(--sc-text-primary)]">
            {t('settings.community.title')}
          </h2>
          <p className="text-sm text-[var(--sc-text-muted)] mt-1">
            {t('settings.community.description')}
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <a
              href="https://github.com/qnbs/StoryCraft-Studio/discussions"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 rounded-sc-md border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-raised)] px-4 py-3 hover:bg-[var(--sc-surface-overlay)] transition-colors group min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sc-ring-focus)]"
            >
              <svg
                aria-hidden="true"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                className="w-5 h-5 shrink-0 text-[var(--sc-text-muted)] group-hover:text-[var(--sc-text-primary)]"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z"
                />
              </svg>
              <div>
                <p className="text-sm font-medium text-[var(--sc-text-primary)]">
                  {t('settings.community.discussionsLink')}
                </p>
                <p className="text-xs text-[var(--sc-text-muted)]">
                  {t('settings.community.discussionsHint')}
                </p>
              </div>
            </a>

            <a
              href="https://github.com/qnbs/StoryCraft-Studio/issues"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 rounded-sc-md border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-raised)] px-4 py-3 hover:bg-[var(--sc-surface-overlay)] transition-colors group min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sc-ring-focus)]"
            >
              <svg
                aria-hidden="true"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                className="w-5 h-5 shrink-0 text-[var(--sc-text-muted)] group-hover:text-[var(--sc-text-primary)]"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
                />
              </svg>
              <div>
                <p className="text-sm font-medium text-[var(--sc-text-primary)]">
                  {t('settings.community.issuesLink')}
                </p>
                <p className="text-xs text-[var(--sc-text-muted)]">
                  {t('settings.community.issuesHint')}
                </p>
              </div>
            </a>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-xl font-semibold text-[var(--sc-text-primary)]">
            {t('settings.community.modelListTitle')}
          </h2>
          <p className="text-sm text-[var(--sc-text-muted)] mt-1">
            {t('settings.community.modelListDescription')}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--sc-text-muted)] mb-2">
              {t('settings.community.webllmModels')}
            </h3>
            <ul className="space-y-2">
              {WEBLLM_SUPPORTED_MODELS.map((m) => (
                <li
                  key={m.id}
                  className="flex items-start justify-between gap-3 rounded-sc-md border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-raised)] px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[var(--sc-text-primary)] truncate">
                      {m.label}
                    </p>
                    <p className="text-xs text-[var(--sc-text-muted)]">
                      {t(WEBLLM_USE_CASES[m.id] ?? 'settings.community.useCase.balanced')}
                    </p>
                  </div>
                  {/* QNBS-v3: --sc-interactive-bg/fg tokens don't exist; --sc-info-bg/fg do and semantically fit */}
                  <span className="shrink-0 text-xs bg-[var(--sc-info-bg)] text-[var(--sc-info-fg)] px-1.5 py-0.5 rounded">
                    WebGPU
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--sc-text-muted)] mb-2">
              {t('settings.community.onnxModels')}
            </h3>
            <ul className="space-y-2">
              {ONNX_SUPPORTED_MODELS.map((m) => (
                <li
                  key={m.id}
                  className="flex items-start justify-between gap-3 rounded-sc-md border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-raised)] px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[var(--sc-text-primary)] truncate">
                      {m.label}
                    </p>
                    <p className="text-xs text-[var(--sc-text-muted)]">
                      {t('settings.community.useCase.wasm')}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs bg-[var(--sc-surface-overlay)] text-[var(--sc-text-secondary)] px-1.5 py-0.5 rounded">
                    WASM
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
