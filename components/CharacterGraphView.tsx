import type { FC } from 'react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LinkObject, NodeObject } from 'react-force-graph-2d';

const ForceGraph2D = lazy(() =>
  import('react-force-graph-2d').then((m) => ({ default: m.default })),
);

import { useAppSelector } from '../app/hooks';
import {
  CharacterGraphViewContext,
  useCharacterGraphViewContext,
} from '../contexts/CharacterGraphViewContext';
import { useAnnounce } from '../contexts/LiveRegionContext';
import { useCharacterGraphView } from '../hooks/useCharacterGraphView';
import { Button } from './ui/Button';
import { Card, CardContent, CardHeader } from './ui/Card';
import { EmptyState } from './ui/EmptyState';
import { SectionIcon } from './ui/SectionIcon';

const RELATIONSHIP_COLORS: Record<string, string> = {
  family: '#ef4444',
  romantic: '#ec4899',
  friend: '#3b82f6',
  enemy: '#dc2626',
  mentor: '#f59e0b',
  rival: '#8b5cf6',
  ally: '#10b981',
  acquaintance: '#6b7280',
};

function getRelationshipColor(type: string): string {
  return RELATIONSHIP_COLORS[type] || '#6b7280';
}

type GraphNode = NodeObject & { id: string; name: string; role: string };
type GraphLink = LinkObject & { type: string; strength: number };

// ForceGraph2D-basierte Darstellung mit Physics-Layout
const CharacterForceGraph: FC = () => {
  const { t, characters, relationships } = useCharacterGraphViewContext();
  const theme = useAppSelector((s) => s.settings.theme);
  const appearancePreset = useAppSelector((s) => s.settings.appearancePreset);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 500 });
  const [paintColors, setPaintColors] = useState({
    fill: '#6366f1',
    stroke: '#a5b4fc',
    label: '#e2e8f0',
  });

  // QNBS-v3: Canvas nodes follow DS accent — refresh after body theme/preset classes update.
  // biome-ignore lint/correctness/useExhaustiveDependencies: theme/preset are intentional triggers; effect reads computed CSS after App updates body.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const id = requestAnimationFrame(() => {
      const body = document.body;
      setPaintColors({
        fill: getComputedStyle(body).getPropertyValue('--sc-accent').trim() || '#6366f1',
        stroke: getComputedStyle(body).getPropertyValue('--sc-text-secondary').trim() || '#a5b4fc',
        label: getComputedStyle(body).getPropertyValue('--sc-text-secondary').trim() || '#e2e8f0',
      });
    });
    return () => cancelAnimationFrame(id);
  }, [theme, appearancePreset]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const firstEntry = entries[0];
      if (!firstEntry) return;
      const { width, height } = firstEntry.contentRect;
      if (width > 0 && height > 0) setDimensions({ width, height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const graphData = useMemo(
    () => ({
      nodes: characters.map((c) => ({
        id: c.id,
        name: c.name,
        role: c.characterArc || '',
      })),
      links: relationships.map((r) => ({
        source: r.fromCharacterId,
        target: r.toCharacterId,
        type: r.type,
        strength: r.strength ?? 5,
      })),
    }),
    [characters, relationships],
  );

  const nodeCanvasObject = useCallback(
    (node: NodeObject, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const n = node as GraphNode;
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      const r = 18;

      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = paintColors.fill;
      ctx.fill();
      ctx.strokeStyle = paintColors.stroke;
      ctx.lineWidth = 2;
      ctx.stroke();

      const initials = n.name.slice(0, 2).toUpperCase();
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.max(8, 13 / globalScale)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(initials, x, y);

      if (globalScale >= 0.6) {
        const label = n.name.length > 14 ? `${n.name.slice(0, 13)}\u2026` : n.name;
        ctx.fillStyle = paintColors.label;
        ctx.font = `${Math.max(6, 10 / globalScale)}px sans-serif`;
        ctx.textBaseline = 'top';
        ctx.fillText(label, x, y + r + 3);
      }
    },
    [paintColors],
  );

  return (
    <section
      ref={containerRef}
      className="w-full h-full"
      style={{ minHeight: 400 }}
      aria-label={t('characterGraph.graphAriaLabel')}
    >
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center" role="status">
            <span className="text-sm text-[var(--sc-text-muted)]">{t('common.loading')}</span>
          </div>
        }
      >
        <ForceGraph2D
          graphData={graphData}
          width={dimensions.width}
          height={dimensions.height}
          backgroundColor="rgba(0,0,0,0)"
          nodeCanvasObject={nodeCanvasObject}
          nodeCanvasObjectMode={() => 'replace'}
          nodeRelSize={18}
          nodeLabel={(node) => (node as GraphNode).name}
          linkColor={(link) => `${getRelationshipColor((link as GraphLink).type)}cc`}
          linkWidth={(link) => Math.max(0.5, ((link as GraphLink).strength ?? 5) / 2.5)}
          linkDirectionalArrowLength={5}
          linkDirectionalArrowRelPos={1}
          linkLabel={(link) => (link as GraphLink).type}
          warmupTicks={80}
          cooldownTime={4000}
          d3AlphaDecay={0.03}
          d3VelocityDecay={0.3}
        />
      </Suspense>
    </section>
  );
};

const CharacterGraphUI: FC = () => {
  const { t, characters, relationships, onUpdateRelationship } = useCharacterGraphViewContext();
  // QNBS-v3: Default to table when screenReader preset is active — graph canvas is not keyboard-navigable.
  const screenReaderMode = useAppSelector((s) => s.settings.accessibility.screenReader);
  const [viewMode, setViewMode] = useState<'graph' | 'table'>(screenReaderMode ? 'table' : 'graph');
  const announce = useAnnounce();

  // QNBS-v3: G shortcut toggles graph/table without leaving the view; skip when typing in an input.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'g' && e.key !== 'G') return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.target as HTMLElement).isContentEditable) return;
      e.preventDefault();
      setViewMode((prev) => {
        const next = prev === 'graph' ? 'table' : 'graph';
        announce(t(next === 'graph' ? 'characterGraph.view.graph' : 'characterGraph.view.table'));
        return next;
      });
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [announce, t]);

  return (
    <div className="h-full flex flex-col">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <SectionIcon section="characterGraph" size="lg" />
          <h1 className="text-2xl font-bold text-[var(--sc-text-primary)]">
            {t('characterGraph.title')}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2 justify-between sm:justify-end">
          <div
            className="flex rounded-lg border border-[var(--sc-border-subtle)] p-0.5 bg-[var(--sc-surface-overlay)]/60"
            role="tablist"
            aria-label={t('characterGraph.title')}
          >
            <Button
              type="button"
              size="sm"
              variant={viewMode === 'graph' ? 'primary' : 'ghost'}
              className="rounded-md"
              aria-pressed={viewMode === 'graph'}
              aria-description={t('characterGraph.view.graphKeyboardHint')}
              onClick={() => setViewMode('graph')}
            >
              {t('characterGraph.view.graph')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={viewMode === 'table' ? 'primary' : 'ghost'}
              className="rounded-md"
              aria-pressed={viewMode === 'table'}
              onClick={() => setViewMode('table')}
            >
              {t('characterGraph.view.table')}
            </Button>
          </div>
          <span className="text-xs text-[var(--sc-text-muted)]">
            {characters.length} {t('charGraph.characters')} · {relationships.length}{' '}
            {t('charGraph.relationships')}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 flex-grow min-h-0">
        {/* Graph or accessible table alternative */}
        <div className="lg:col-span-3">
          <Card className="h-full min-h-[400px] shadow-sc-md border-[var(--sc-border-subtle)]">
            <CardContent className="p-0 h-full min-h-[400px] rounded-sc-lg overflow-hidden">
              {viewMode === 'graph' && characters.length === 0 ? (
                // QNBS-v3: Empty-state gated here so ForceGraph2D lazy import never triggers when there are no characters.
                <div className="flex items-center justify-center h-64 p-6">
                  <EmptyState
                    compact
                    icon={
                      <svg
                        className="w-10 h-10"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={1}
                        stroke="currentColor"
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z"
                        />
                      </svg>
                    }
                    title={t('charGraph.noCharacters')}
                    description={t('charGraph.noCharactersHint')}
                  />
                </div>
              ) : viewMode === 'graph' ? (
                <CharacterForceGraph />
              ) : (
                <div className="p-4 overflow-auto max-h-[min(70vh,560px)]">
                  {relationships.length === 0 ? (
                    <EmptyState
                      compact
                      icon={
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          fill="none"
                          viewBox="0 0 24 24"
                          strokeWidth={1.5}
                          stroke="currentColor"
                          className="w-8 h-8"
                          aria-hidden="true"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5"
                          />
                        </svg>
                      }
                      title={t('characterGraph.table.empty')}
                      description={t('characterGraph.table.emptyHint')}
                    />
                  ) : (
                    <table className="w-full text-sm border-collapse border border-[var(--sc-border-subtle)] rounded-lg overflow-hidden">
                      <caption className="text-left py-2 px-1 font-semibold text-[var(--sc-text-primary)]">
                        {t('characterGraph.table.caption')}
                      </caption>
                      <thead className="bg-[var(--sc-surface-overlay)]">
                        <tr>
                          <th
                            scope="col"
                            className="text-left p-3 border-b border-[var(--sc-border-subtle)]"
                          >
                            {t('characterGraph.table.from')}
                          </th>
                          <th
                            scope="col"
                            className="text-left p-3 border-b border-[var(--sc-border-subtle)]"
                          >
                            {t('characterGraph.table.to')}
                          </th>
                          <th
                            scope="col"
                            className="text-left p-3 border-b border-[var(--sc-border-subtle)]"
                          >
                            {t('characterGraph.table.type')}
                          </th>
                          <th
                            scope="col"
                            className="text-left p-3 border-b border-[var(--sc-border-subtle)]"
                          >
                            {t('characterGraph.table.strength')}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {relationships.map((rel) => {
                          const fromChar = characters.find((c) => c.id === rel.fromCharacterId);
                          const toChar = characters.find((c) => c.id === rel.toCharacterId);
                          return (
                            <tr key={rel.id} className="odd:bg-[var(--sc-surface-raised)]/40">
                              <td className="p-3 border-b border-[var(--sc-border-subtle)]">
                                {fromChar?.name ?? rel.fromCharacterId}
                              </td>
                              <td className="p-3 border-b border-[var(--sc-border-subtle)]">
                                {toChar?.name ?? rel.toCharacterId}
                              </td>
                              <td className="p-3 border-b border-[var(--sc-border-subtle)] capitalize">
                                {rel.type}
                              </td>
                              <td className="p-3 border-b border-[var(--sc-border-subtle)]">
                                <label className="sr-only" htmlFor={`rel-str-${rel.id}`}>
                                  {t('characterGraph.table.strength')}
                                </label>
                                <input
                                  id={`rel-str-${rel.id}`}
                                  type="range"
                                  min={1}
                                  max={10}
                                  value={rel.strength || 5}
                                  onChange={(e) =>
                                    onUpdateRelationship(rel.id, {
                                      strength: parseInt(e.target.value, 10),
                                    })
                                  }
                                  className="w-full accent-indigo-500"
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sidebar: Legende + Beziehungsliste */}
        <div className="lg:col-span-1 space-y-4 overflow-y-auto">
          <Card>
            <CardHeader>
              <h3 className="text-sm font-semibold text-[var(--sc-text-primary)]">
                {t('characterGraph.legend')}
              </h3>
            </CardHeader>
            <CardContent className="space-y-1 pt-0">
              {Object.entries(RELATIONSHIP_COLORS).map(([type, color]) => (
                <div
                  key={type}
                  className="flex items-center text-xs text-[var(--sc-text-secondary)] gap-2"
                >
                  <div
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: color }}
                  />
                  <span className="capitalize">{type}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          {relationships.length > 0 && (
            <Card>
              <CardHeader>
                <h3 className="text-sm font-semibold text-[var(--sc-text-primary)]">
                  {t('characterGraph.relationships')}
                </h3>
              </CardHeader>
              <CardContent className="space-y-2 pt-0 max-h-64 overflow-y-auto">
                {relationships.map((rel) => {
                  const fromChar = characters.find((c) => c.id === rel.fromCharacterId);
                  const toChar = characters.find((c) => c.id === rel.toCharacterId);
                  const color = getRelationshipColor(rel.type);
                  return (
                    <div
                      key={rel.id}
                      className="p-2 rounded-md border border-[var(--sc-border-subtle)] text-xs space-y-1"
                    >
                      <div className="flex items-center gap-1">
                        <div
                          className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{ backgroundColor: color }}
                        />
                        <span className="font-medium text-[var(--sc-text-primary)] truncate">
                          {fromChar?.name}
                        </span>
                        <span className="text-[var(--sc-text-muted)]">&rarr;</span>
                        <span className="font-medium text-[var(--sc-text-primary)] truncate">
                          {toChar?.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="capitalize text-[var(--sc-text-muted)]">{rel.type}</span>
                        <input
                          type="range"
                          min="1"
                          max="10"
                          value={rel.strength || 5}
                          onChange={(e) =>
                            onUpdateRelationship(rel.id, { strength: parseInt(e.target.value, 10) })
                          }
                          className="flex-1 h-1 accent-indigo-500"
                        />
                        <span className="text-[var(--sc-text-muted)] w-4 text-right">
                          {rel.strength || 5}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
};

export const CharacterGraphView: FC = () => {
  const contextValue = useCharacterGraphView();
  return (
    <CharacterGraphViewContext.Provider value={contextValue}>
      <CharacterGraphUI />
    </CharacterGraphViewContext.Provider>
  );
};
