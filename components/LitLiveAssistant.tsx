import React, { useState, useCallback } from 'react';
import { useAppSelector } from '../app/hooks';
import { selectEnableLiveLiteratureAssistant } from '../features/featureFlags/featureFlagsSlice';
import { useTranslation } from '../hooks/useTranslation';

// Stub for LitLive Assistant - full implementation would include inline chat, RAG context from project, AI calls via existing services/ai or packages/ai-core
// Workflow pipeline assistance: tracks stages, proactive inline suggestions, immersive UI for beginners
// Local & global AI via existing facade

const LitLiveAssistant: React.FC = () => {
  const { t } = useTranslation();
  const isEnabled = useAppSelector(selectEnableLiveLiteratureAssistant);
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);

  const handleSendMessage = useCallback(async (message: string) => {
    if (!message.trim()) return;
    setMessages((prev) => [...prev, { role: 'user' as const, content: message }]);
    // TODO: Full integration - call AI with full project context (RAG on manuscript, characters, world) and workflow state
    // Prefer local AI (Ollama/WebLLM) for privacy, fallback global
    setTimeout(() => {
      setMessages((prev) => [...prev, { role: 'assistant' as const, content: `Danke für deine Nachricht! Als dein Literatur-Live-Assistent unterstütze ich den gesamten Pipeline-Workflow: Von der Idee über Charakterentwicklung, Plot-Board, Drafting bis zur finalen Polishing & Export. Nächster Schritt?` }]);
    }, 1000);
  }, []);

  if (!isEnabled) return null;

  return (
    <>
      {/* Floating immersive trigger - always visible when enabled */}
      <div className="fixed bottom-8 right-8 z-[9999] flex flex-col items-end">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="group relative flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-violet-500 via-indigo-500 to-purple-600 shadow-2xl transition-all hover:scale-110 active:scale-95"
          title={t('liveAssistant.title', 'LitLive Assistant')}
        >
          <span className="text-4xl drop-shadow-md group-active:rotate-12 transition-transform">📖</span>
          <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-400 text-[10px] font-bold text-white ring-2 ring-white">AI</span>
        </button>
      </div>

      {/* Immersive Panel */}
      {isOpen && (
        <div className="fixed bottom-28 right-8 z-[10000] w-96 max-h-[70vh] bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col">
          <div className="px-6 py-4 border-b flex items-center justify-between bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-slate-800 dark:to-slate-900">
            <div className="flex items-center gap-3">
              <span className="text-2xl">📖</span>
              <div>
                <h2 className="font-semibold tracking-tight">LitLive Assistant</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">Dein immersiver Literatur-Co-Pilot</p>
              </div>
            </div>
            <button onClick={() => setIsOpen(false)} className="text-slate-400 hover:text-red-500">✕</button>
          </div>
          <div className="flex-1 p-6 overflow-y-auto space-y-6 text-sm leading-relaxed">
            {messages.length === 0 ? (
              <div className="prose dark:prose-invert">
                <p>Hallo! Ich bin dein <strong>Literatur-Live-Assistent</strong>. Opt-in Feature für Einsteiger & Interessierte.</p>
                <p>Full-scale Pipeline Assistance: Idea → World/Char → Outline → Draft → Revise → Publish.</p>
                <p>Frage mich alles – inline, kontextuell, lokal oder global AI.</p>
              </div>
            ) : (
              messages.map((msg, index) => (
                <div key={index} className={`flex ${msg.role === 'user' ? 'justify-end' : ''}`}>
                  <div className={`inline-block max-w-[85%] px-5 py-3 rounded-3xl ${msg.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-slate-100'}`}>
                    {msg.content}
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="p-4 border-t bg-slate-50 dark:bg-slate-950">
            <form onSubmit={(e) => { e.preventDefault(); const input = e.currentTarget.querySelector('input') as HTMLInputElement; if (input) { handleSendMessage(input.value); input.value = ''; } }}>
              <input
                type="text"
                placeholder="Wie kann ich dir bei deiner Geschichte helfen?"
                className="w-full px-5 py-4 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-3xl focus:outline-none focus:ring-2 focus:ring-indigo-400 text-base"
              />
            </form>
          </div>
        </div>
      )}
    </>
  );
};

export default LitLiveAssistant;
