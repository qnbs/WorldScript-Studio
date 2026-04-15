import type { FC } from 'react';
import React, { useState, useEffect } from 'react';
import type { Template, View, CommunityTemplate } from '../types';
import { ICONS } from '../constants';
import { Card, CardContent, CardHeader } from './ui/Card';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { Textarea } from './ui/Textarea';
import { Input } from './ui/Input';
import { Spinner } from './ui/Spinner';
import { useTemplateView } from '../hooks/useTemplateView';
import { TemplateViewContext, useTemplateViewContext } from '../contexts/TemplateViewContext';
import { AddNewCard } from './ui/AddNewCard';
import { fetchCommunityTemplates } from '../services/communityTemplateService';

// --- SUB-COMPONENTS ---

const TemplateCard: FC<{ template: Template; animationIndex: number }> = React.memo(
  ({ template, animationIndex }) => {
    const { t, openPreviewModal } = useTemplateViewContext();
    return (
      <Card
        as="button"
        onClick={() => openPreviewModal(template)}
        className="flex flex-col group text-left transition-all duration-200 hover:-translate-y-1 animate-in"
        style={{ '--index': animationIndex } as React.CSSProperties}
      >
        <CardHeader>
          <h3 className="text-xl font-bold text-[var(--foreground-primary)] transition-colors">
            {t(template.name)}
          </h3>
          <span
            className={`inline-block px-2 py-1 text-xs font-semibold rounded-full mt-2 ${template.type === 'Genre' ? 'bg-[var(--accent-2-background)] text-[var(--accent-2-text)] border border-[var(--accent-2-border)]' : 'bg-[var(--accent-3-background)] text-[var(--accent-3-text)] border border-[var(--accent-3-border)]'}`}
          >
            {t(`templates.types.${template.type}`)}
          </span>
        </CardHeader>
        <CardContent className="flex-grow space-y-4">
          <p className="text-sm text-[var(--foreground-muted)]">{t(template.description)}</p>
          <div className="flex flex-wrap gap-2">
            {template.tags.map((tag) => (
              <span
                key={tag}
                className="px-2 py-1 text-xs bg-[var(--background-tertiary)]/80 text-[var(--foreground-secondary)] rounded-md"
              >
                {t(tag)}
              </span>
            ))}
          </div>
        </CardContent>
        <div className="p-4 pt-0 mt-auto">
          <Button className="w-full">{t('templates.previewAndRemix')}</Button>
        </div>
      </Card>
    );
  }
);
TemplateCard.displayName = 'TemplateCard';

const PreviewModal: FC = () => {
  const {
    t,
    selectedTemplate,
    closeModal,
    remixedSections,
    isRemixMode,
    setIsRemixMode,
    draggedItem,
    dragOverItem,
    handleDragSort,
    updateRemixedSectionTitle,
    addRemixedSection,
    deleteRemixedSection,
    aiConcept,
    setAiConcept,
    isAiLoading,
    handleAiApply,
    handleStandardApply,
  } = useTemplateViewContext();

  if (!selectedTemplate) return null;

  return (
    <Modal
      isOpen={true}
      onClose={closeModal}
      title={t('templates.modal.title', { name: t(selectedTemplate.name) })}
      size="xl"
    >
      <div className="flex flex-col md:grid md:grid-cols-2 gap-8">
        <div className="order-1 md:order-2 md:border-l border-[var(--border-primary)]/50 md:pl-8">
          <h3 className="text-lg font-semibold text-[var(--foreground-primary)] mb-2">
            {t('templates.modal.ai.title')}
          </h3>
          <p className="text-sm text-[var(--foreground-muted)] mb-3">
            {t('templates.modal.ai.description')}
          </p>
          <Textarea
            placeholder={t('templates.modal.ai.placeholder')}
            value={aiConcept}
            onChange={(e) => setAiConcept(e.target.value)}
            rows={4}
          />
          <div className="mt-6 flex flex-col sm:flex-row-reverse gap-3">
            <Button
              onClick={handleAiApply}
              disabled={isAiLoading || !aiConcept}
              className="w-full sm:w-auto"
            >
              {isAiLoading ? (
                <Spinner />
              ) : (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  className="w-5 h-5 mr-2"
                >
                  {ICONS.SPARKLES}
                </svg>
              )}
              {t('templates.modal.ai.button')}
            </Button>
            <Button onClick={handleStandardApply} variant="secondary" className="w-full sm:w-auto">
              {t('templates.modal.standardButton')}
            </Button>
          </div>
        </div>
        <div className="order-2 md:order-1 border-t md:border-t-0 border-[var(--border-primary)]/50 pt-6 md:pt-0">
          <h3 className="text-lg font-semibold text-[var(--foreground-primary)] mb-2">
            {isRemixMode ? t('templates.remix.title') : t('templates.modal.sectionsTitle')}
          </h3>
          <p className="text-sm text-[var(--foreground-muted)] mb-4">
            {isRemixMode ? t('templates.remix.description') : t('templates.remix.descriptionHint')}
          </p>
          <div className="space-y-2 max-h-64 sm:max-h-96 overflow-y-auto bg-white/5 p-2 rounded-md border border-[var(--border-primary)]/50">
            {remixedSections.map((sec, i) => (
              <div
                key={sec.id}
                role="listitem"
                draggable={isRemixMode}
                onDragStart={() => isRemixMode && (draggedItem.current = i)}
                onDragEnter={() => isRemixMode && (dragOverItem.current = i)}
                onDragEnd={handleDragSort}
                onDragOver={(e) => isRemixMode && e.preventDefault()}
                className={`flex items-center gap-2 p-2 rounded-md ${isRemixMode ? 'bg-[var(--foreground-primary)]/5 cursor-move' : 'bg-transparent'}`}
              >
                {isRemixMode && (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.5}
                    stroke="currentColor"
                    className="w-5 h-5 text-gray-500 flex-shrink-0"
                  >
                    {ICONS.GRIP_VERTICAL}
                  </svg>
                )}
                <Input
                  value={sec.title}
                  onChange={(e) => updateRemixedSectionTitle(sec.id, e.target.value)}
                  disabled={!isRemixMode}
                  className="bg-transparent border-0 text-[var(--foreground-secondary)] h-auto focus:ring-1 focus:bg-[var(--background-tertiary)] disabled:cursor-default"
                />
                {isRemixMode && (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => addRemixedSection(i)}
                      aria-label={t('outline.result.addTooltip')}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={1.5}
                        stroke="currentColor"
                        className="w-5 h-5"
                      >
                        {ICONS.ADD}
                      </svg>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteRemixedSection(sec.id)}
                      aria-label={t('outline.result.deleteTooltip')}
                      className="text-red-500 dark:text-red-400 hover:bg-red-500/10 dark:hover:bg-red-900/50"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={1.5}
                        stroke="currentColor"
                        className="w-5 h-5"
                      >
                        {ICONS.TRASH}
                      </svg>
                    </Button>
                  </>
                )}
              </div>
            ))}
          </div>
          {!isRemixMode && (
            <Button
              variant="secondary"
              onClick={() => setIsRemixMode(true)}
              className="w-full mt-3"
            >
              {t('templates.remix.button')}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
};

const CreateCustomModal: FC = () => {
  const {
    t,
    closeModal,
    customConcept,
    setCustomConcept,
    customElements,
    setCustomElements,
    customNumSections,
    setCustomNumSections,
    isAiLoading,
    handleGenerateCustom,
  } = useTemplateViewContext();
  return (
    <Modal isOpen={true} onClose={closeModal} title={t('templates.custom.modalTitle')} size="lg">
      <div className="space-y-4">
        <p className="text-[var(--foreground-secondary)]">
          {t('templates.custom.modalDescription')}
        </p>
        <div>
          <label
            htmlFor="custom-concept"
            className="block text-sm font-medium text-[var(--foreground-secondary)] mb-2"
          >
            {t('templates.custom.conceptLabel')}
          </label>
          <Textarea
            id="custom-concept"
            placeholder={t('templates.custom.conceptPlaceholder')}
            value={customConcept}
            onChange={(e) => setCustomConcept(e.target.value)}
            rows={3}
          />
        </div>
        <div>
          <label
            htmlFor="custom-elements"
            className="block text-sm font-medium text-[var(--foreground-secondary)] mb-2"
          >
            {t('templates.custom.elementsLabel')}
          </label>
          <Input
            id="custom-elements"
            placeholder={t('templates.custom.elementsPlaceholder')}
            value={customElements}
            onChange={(e) => setCustomElements(e.target.value)}
          />
        </div>
        <div>
          <label
            htmlFor="custom-sections"
            className="block text-sm font-medium text-[var(--foreground-secondary)] mb-2"
          >
            {t('templates.custom.sectionsLabel')}
          </label>
          <Input
            id="custom-sections"
            type="number"
            value={customNumSections}
            onChange={(e) => setCustomNumSections(Number(e.target.value))}
            min="3"
            max="50"
          />
        </div>
        <div className="flex justify-end pt-4">
          <Button
            onClick={handleGenerateCustom}
            disabled={isAiLoading || !customConcept || !customElements}
            className="w-full sm:w-auto"
          >
            {isAiLoading ? (
              <Spinner />
            ) : (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                className="w-5 h-5 mr-2"
              >
                {ICONS.SPARKLES}
              </svg>
            )}
            {t('templates.custom.generateButton')}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

// ─── Community Template Components ───────────────────────────────────────────

const CommunityTemplateCard: FC<{
  template: CommunityTemplate;
  onApply: (t: CommunityTemplate) => void;
  animationIndex: number;
}> = React.memo(({ template, onApply, animationIndex }) => (
  <Card
    className="flex flex-col group text-left transition-all duration-200 hover:-translate-y-1 animate-in"
    style={{ '--index': animationIndex } as React.CSSProperties}
  >
    <CardHeader>
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-xl font-bold text-[var(--foreground-primary)]">{template.name}</h3>
        <span className="flex items-center gap-1 text-xs text-amber-400 flex-shrink-0">
          ★ {template.stars ?? 0}
        </span>
      </div>
      <p className="text-xs text-[var(--foreground-muted)] mt-1">von {template.author}</p>
      <div className="flex flex-wrap gap-1 mt-2">
        {template.tags.map((tag) => (
          <span
            key={tag}
            className="px-2 py-0.5 text-xs bg-[var(--background-tertiary)]/80 text-[var(--foreground-secondary)] rounded-md"
          >
            {tag}
          </span>
        ))}
      </div>
    </CardHeader>
    <CardContent className="flex-grow space-y-2">
      <p className="text-sm text-[var(--foreground-muted)]">{template.description}</p>
      {template.arcDescription && (
        <p className="text-xs text-[var(--foreground-secondary)] italic">
          {template.arcDescription}
        </p>
      )}
      <p className="text-xs text-[var(--foreground-muted)]">{template.sections.length} Kapitel</p>
    </CardContent>
    <div className="p-4 pt-0 mt-auto">
      <Button className="w-full" onClick={() => onApply(template)}>
        Als Projekt übernehmen
      </Button>
    </div>
  </Card>
));
CommunityTemplateCard.displayName = 'CommunityTemplateCard';

const CommunityTab: FC = () => {
  const [templates, setTemplates] = useState<CommunityTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isFallback, setIsFallback] = useState(false);
  const { t: _t } = useTemplateViewContext();

  useEffect(() => {
    const ac = new AbortController();
    setIsLoading(true);
    fetchCommunityTemplates(ac.signal)
      .then((res) => {
        setTemplates(res.templates);
        setIsFallback(res.isFallback);
      })
      .catch((e) => {
        if (e?.name !== 'AbortError') setError(String(e));
      })
      .finally(() => setIsLoading(false));
    return () => ac.abort();
  }, []);

  const handleApply = (ct: CommunityTemplate) => {
    // Dispatch a new project with sections from community template — navigated via window event
    const sections = ct.sections.map((s, i) => ({
      id: `sec-${Date.now()}-${i}`,
      title: s.title,
      content: s.description ? `# ${s.title}\n\n${s.description}` : '',
    }));
    const event = new CustomEvent('storycraft:applyTemplate', {
      detail: { title: ct.name, sections },
    });
    window.dispatchEvent(event);
  };

  if (isLoading)
    return (
      <div className="flex justify-center py-20">
        <Spinner className="w-10 h-10" />
      </div>
    );
  if (error)
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-[var(--foreground-muted)]">
        <p className="text-sm">Fehler beim Laden der Community-Templates.</p>
        <p className="text-xs opacity-60">{error}</p>
      </div>
    );

  return (
    <div>
      {isFallback && (
        <div className="mb-6 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-sm text-amber-400">
          Du bist offline — zeige eingebettete Beispiel-Templates. Für das vollständige
          Community-Angebot verbinde dich mit dem Internet.
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {templates.map((ct, i) => (
          <CommunityTemplateCard
            key={ct.id}
            template={ct}
            onApply={handleApply}
            animationIndex={i}
          />
        ))}
      </div>
    </div>
  );
};

// ─── Main Template View UI ────────────────────────────────────────────────────

const TemplateViewUI: FC = () => {
  const { t, filter, setFilter, filteredTemplates, modalState, setModalState } =
    useTemplateViewContext();
  const [activeTab, setActiveTab] = useState<'local' | 'community'>('local');

  return (
    <div>
      {/* Tab Switcher */}
      <div className="flex items-center gap-2 mb-6 border-b border-[var(--border-primary)] pb-4">
        <button
          onClick={() => setActiveTab('local')}
          className={`px-4 py-2 text-sm font-semibold rounded-t-md transition-colors ${activeTab === 'local' ? 'text-[var(--foreground-primary)] border-b-2 border-[var(--background-interactive)] -mb-px' : 'text-[var(--foreground-muted)] hover:text-[var(--foreground-secondary)]'}`}
        >
          Meine Templates
        </button>
        <button
          onClick={() => setActiveTab('community')}
          className={`px-4 py-2 text-sm font-semibold rounded-t-md transition-colors ${activeTab === 'community' ? 'text-[var(--foreground-primary)] border-b-2 border-[var(--background-interactive)] -mb-px' : 'text-[var(--foreground-muted)] hover:text-[var(--foreground-secondary)]'}`}
        >
          🌐 Community
        </button>
      </div>

      {activeTab === 'community' ? (
        <CommunityTab />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-8">
            {(['All', 'Structure', 'Genre'] as const).map((f) => (
              <Button
                key={f}
                variant={filter === f ? 'primary' : 'secondary'}
                onClick={() => setFilter(f)}
                className="rounded-full px-4 text-sm"
              >
                {t(`templates.filters.${f}`)}
              </Button>
            ))}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            <div className="animate-in" style={{ '--index': 0 } as React.CSSProperties}>
              <AddNewCard
                title={t('templates.custom.title')}
                description={t('templates.custom.description')}
                onClick={() => setModalState('create')}
                icon={ICONS.SPARKLES}
              />
            </div>
            {filteredTemplates.map((template, index) => (
              <TemplateCard key={template.id} template={template} animationIndex={index + 1} />
            ))}
          </div>
          {modalState === 'preview' && <PreviewModal />}
          {modalState === 'create' && <CreateCustomModal />}
        </>
      )}
    </div>
  );
};

export const TemplateView: React.FC<{ onNavigate: (view: View) => void }> = ({ onNavigate }) => {
  // Explicitly casting onNavigate to fit internal hook needs if necessary, but changing prop type above is cleaner
  const contextValue = useTemplateView({
    onNavigate: onNavigate as (view: 'manuscript') => void,
  });
  return (
    <TemplateViewContext.Provider value={contextValue}>
      <TemplateViewUI />
    </TemplateViewContext.Provider>
  );
};
