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
      <p className="mb-3 text-sm text-gray-500 dark:text-gray-400">
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
              className={`cursor-pointer rounded-lg border p-3 transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 ${
                isSelected
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                  : 'border-gray-200 hover:border-blue-300 dark:border-gray-700 dark:hover:border-blue-600'
              }`}
            >
              <p className="font-medium text-gray-900 dark:text-white">
                {t(ARCHETYPE_LABEL_KEYS[tmpl.archetype])}
              </p>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{tmpl.description}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
