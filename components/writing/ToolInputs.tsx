// QNBS-v3: Extracted from ToolsPanel to keep ToolsPanel ≤350 lines
import type { FC } from 'react';
import { useWriterViewContext } from '../../contexts/WriterViewContext';
import { writerActions } from '../../features/writer/writerSlice';
import { useTranslation } from '../../hooks/useTranslation';
import { Checkbox } from '../ui/Checkbox';
import { DebouncedTextarea } from '../ui/DebouncedTextarea';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';

type ToolInputsProps = {
  activeTool: string;
  tone: string;
  isCustomTone: string | boolean;
  onToneSelect: (val: string) => void;
};

export const ToolInputs: FC<ToolInputsProps> = ({
  activeTool,
  tone,
  isCustomTone,
  onToneSelect,
}) => {
  const { t } = useTranslation();
  const { project, writerState, dispatch } = useWriterViewContext();
  const { selection, dialogueCharacters, scenario, brainstormContext } = writerState;

  switch (activeTool) {
    case 'improve':
      return (
        <p className="text-sm text-[var(--sc-text-muted)]">
          {t('writer.studio.tools.improve.instruction', {
            selection: selection.text
              ? `"${selection.text.substring(0, 50)}..."`
              : t('writer.studio.tools.improve.noSelection'),
          })}
        </p>
      );
    case 'changeTone':
      return (
        <div>
          <p className="text-sm text-[var(--sc-text-muted)] mb-3">
            {t('writer.studio.tools.improve.instruction', {
              selection: selection.text
                ? `"${selection.text.substring(0, 50)}..."`
                : t('writer.studio.tools.improve.noSelection'),
            })}
          </p>
          <Select
            id="tone"
            value={isCustomTone ? 'Custom' : tone}
            onChange={(v) => onToneSelect(v)}
            placeholder={t('writer.studio.controls.selectTone')}
            options={[
              { value: 'More Cinematic', label: t('writer.studio.controls.tones.cinematic') },
              { value: 'More Suspenseful', label: t('writer.studio.controls.tones.suspenseful') },
              { value: 'More Humorous', label: t('writer.studio.controls.tones.humorous') },
              { value: 'More Formal', label: t('writer.studio.controls.tones.formal') },
              { value: 'More Poetic', label: t('writer.studio.controls.tones.poetic') },
              { value: 'Custom', label: t('writer.studio.controls.custom') },
            ]}
          />
          {isCustomTone && (
            <div className="mt-2 animate-in">
              <Input
                placeholder={t('writer.studio.controls.customTonePlaceholder')}
                value={tone}
                onChange={(e) => dispatch(writerActions.setTone(e.target.value))}
              />
            </div>
          )}
        </div>
      );
    case 'dialogue':
      return (
        <div className="space-y-4">
          <div>
            <span className="text-sm font-medium text-[var(--sc-text-secondary)] mb-2 block">
              {t('writer.studio.tools.dialogue.charactersLabel')}
            </span>
            <div className="space-y-2 max-h-32 overflow-y-auto bg-[var(--glass-bg)] p-2 rounded-md border border-[var(--sc-border-subtle)]">
              {project.characters.map((char) => (
                <div key={char.id}>
                  <Checkbox
                    id={`char-${char.id}`}
                    label={char.name}
                    checked={dialogueCharacters.some((c) => c.id === char.id)}
                    onChange={() => dispatch(writerActions.toggleDialogueCharacter(char))}
                  />
                </div>
              ))}
            </div>
          </div>
          <div>
            <label
              htmlFor="scenario"
              className="text-sm font-medium text-[var(--sc-text-secondary)] mb-2 block"
            >
              {t('writer.studio.tools.dialogue.scenarioLabel')}
            </label>
            <DebouncedTextarea
              id="scenario"
              value={scenario}
              onDebouncedChange={(val) => dispatch(writerActions.setScenario(val))}
              placeholder={t('writer.studio.tools.dialogue.scenarioPlaceholder')}
              rows={3}
            />
          </div>
        </div>
      );
    case 'brainstorm':
      return (
        <div>
          <label
            htmlFor="brainstorm-context"
            className="text-sm font-medium text-[var(--sc-text-secondary)] mb-2 block"
          >
            {t('writer.studio.tools.brainstorm.contextLabel')}
          </label>
          <DebouncedTextarea
            id="brainstorm-context"
            value={brainstormContext}
            onDebouncedChange={(val) => dispatch(writerActions.setBrainstormContext(val))}
            placeholder={t('writer.studio.tools.brainstorm.contextPlaceholder')}
            rows={4}
          />
        </div>
      );
    case 'imagePrompt':
      return (
        <div className="space-y-2">
          <p className="text-sm text-[var(--sc-text-muted)]">
            {t('writer.imagePrompt.description')}
          </p>
          <div className="text-xs text-[var(--sc-text-muted)] bg-[var(--sc-surface-overlay)]/50 border border-[var(--sc-border-subtle)] rounded p-2 space-y-1">
            <p>
              💡 <strong>{t('writer.imagePrompt.tip')}</strong>
            </p>
            <p>🎨 {t('writer.imagePrompt.note')}</p>
          </div>
        </div>
      );
    case 'synopsis':
      return (
        <p className="text-sm text-[var(--sc-text-muted)]">
          {t('writer.studio.tools.synopsis.instruction')}
        </p>
      );
    case 'critic':
      return (
        <p className="text-sm text-[var(--sc-text-muted)]">
          {t('writer.studio.tools.critic.instruction')}
        </p>
      );
    case 'plotholes':
      return (
        <p className="text-sm text-[var(--sc-text-muted)]">
          {t('writer.studio.tools.plotholes.instruction')}
        </p>
      );
    case 'consistency':
      return (
        <p className="text-sm text-[var(--sc-text-muted)]">
          {t('writer.studio.tools.consistency.instruction')}
        </p>
      );
    case 'grammarCheck':
      return (
        <p className="text-sm text-[var(--sc-text-muted)]">
          {t('writer.studio.tools.grammarCheck.instruction')}
        </p>
      );
    default:
      return (
        <p className="text-sm text-[var(--sc-text-muted)]">
          {t('writer.studio.tools.continue.instruction')}
        </p>
      );
  }
};
