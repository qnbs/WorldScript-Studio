import { useCharacterInterviewsViewContext } from '../../contexts/CharacterInterviewsViewContext';
import { useTranslation } from '../../hooks/useTranslation';
import { getAllTemplates } from '../../services/characterInterviewTemplates';
import type { CharacterArchetype } from '../../types';

const ARCHETYPE_LABEL_KEYS: Record<CharacterArchetype, string> = {
  hero: 'characterInterviews.archetypeHero',
  mentor: 'characterInterviews.archetypeMentor',
  villain: 'characterInterviews.archetypeVillain',
  shadow: 'characterInterviews.archetypeShadow',
  trickster: 'characterInterviews.archetypeTrickster',
  shapeshifter: 'characterInterviews.archetypeShapeshifter',
  herald: 'characterInterviews.archetypeHerald',
  ally: 'characterInterviews.archetypeAlly',
  'threshold-guardian': 'characterInterviews.archetypeThresholdGuardian',
};

const TEMPLATES = getAllTemplates();

export function ArchetypeSelector() {
  const { t } = useTranslation();
  const { selectedArchetype, selectArchetype } = useCharacterInterviewsViewContext();

  return (
    <div className="p-4">
      <p className="mb-3 text-sm text-[var(--sc-text-muted)]">
        {t('characterInterviews.archetypeDescription')}
      </p>
      <div
        role="listbox"
        aria-label={t('characterInterviews.selectArchetype')}
        className="grid grid-cols-1 gap-2 sm:grid-cols-2"
      >
        {TEMPLATES.map((tmpl) => {
          const isSelected = selectedArchetype === tmpl.archetype;
          return (
            <div
              key={tmpl.archetype}
              role="option"
              aria-selected={isSelected}
              tabIndex={0}
              onClick={() => selectArchetype(tmpl.archetype)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  selectArchetype(tmpl.archetype);
                }
              }}
              className={`cursor-pointer rounded-lg border p-3 transition-colors focus-visible:ring-2 focus-visible:ring-[var(--sc-ring-focus)] ${
                isSelected
                  ? 'border-[var(--sc-accent)] bg-[var(--sc-accent-subtle)]'
                  : 'border-[var(--sc-border-subtle)] hover:border-[var(--sc-accent)]'
              }`}
            >
              <p className="font-medium text-[var(--sc-text-primary)]">
                {t(ARCHETYPE_LABEL_KEYS[tmpl.archetype])}
              </p>
              <p className="mt-0.5 text-xs text-[var(--sc-text-muted)]">{tmpl.description}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
