import type { FC } from 'react';
import { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import type { NodeObject, LinkObject } from 'react-force-graph-2d';
import ForceGraph2D from 'react-force-graph-2d';
import { Card, CardContent, CardHeader } from './ui/Card';
import { useCharacterGraphView } from '../hooks/useCharacterGraphView';
import {
  CharacterGraphViewContext,
  useCharacterGraphViewContext,
} from '../contexts/CharacterGraphViewContext';

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
  const { characters, relationships } = useCharacterGraphViewContext();
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 500 });

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
    [characters, relationships]
  );

  const nodeCanvasObject = useCallback(
    (node: NodeObject, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const n = node as GraphNode;
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      const r = 18;

      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = '#4f46e5';
      ctx.fill();
      ctx.strokeStyle = '#818cf8';
      ctx.lineWidth = 2;
      ctx.stroke();

      const initials = n.name.slice(0, 2).toUpperCase();
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.max(8, 13 / globalScale)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(initials, x, y);

      if (globalScale >= 0.6) {
        const label = n.name.length > 14 ? n.name.slice(0, 13) + '\u2026' : n.name;
        ctx.fillStyle = '#e2e8f0';
        ctx.font = `${Math.max(6, 10 / globalScale)}px sans-serif`;
        ctx.textBaseline = 'top';
        ctx.fillText(label, x, y + r + 3);
      }
    },
    []
  );

  if (characters.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-[var(--foreground-muted)]">
        <svg
          className="w-12 h-12 mb-3 opacity-30"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z"
          />
        </svg>
        <p>Keine Charaktere vorhanden</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="w-full h-full" style={{ minHeight: 400 }}>
      <ForceGraph2D
        graphData={graphData}
        width={dimensions.width}
        height={dimensions.height}
        backgroundColor="rgba(0,0,0,0)"
        nodeCanvasObject={nodeCanvasObject}
        nodeCanvasObjectMode={() => 'replace'}
        nodeRelSize={18}
        nodeLabel={(node) => (node as GraphNode).name}
        linkColor={(link) => getRelationshipColor((link as GraphLink).type) + 'cc'}
        linkWidth={(link) => Math.max(0.5, ((link as GraphLink).strength ?? 5) / 2.5)}
        linkDirectionalArrowLength={5}
        linkDirectionalArrowRelPos={1}
        linkLabel={(link) => (link as GraphLink).type}
        warmupTicks={80}
        cooldownTime={4000}
        d3AlphaDecay={0.03}
        d3VelocityDecay={0.3}
      />
    </div>
  );
};

const CharacterGraphUI: FC = () => {
  const { t, characters, relationships, onUpdateRelationship } = useCharacterGraphViewContext();

  return (
    <div className="h-full flex flex-col">
      <div className="mb-4 flex items-center justify-between flex-shrink-0">
        <h1 className="text-2xl font-bold text-[var(--foreground-primary)]">
          {t('characterGraph.title')}
        </h1>
        <div className="flex items-center gap-2 text-xs text-[var(--foreground-muted)]">
          <span>
            {characters.length} Charaktere &middot; {relationships.length} Beziehungen
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 flex-grow min-h-0">
        {/* Graph */}
        <div className="lg:col-span-3">
          <Card className="h-full min-h-[400px]">
            <CardContent className="p-0 h-full min-h-[400px] rounded-xl overflow-hidden">
              <CharacterForceGraph />
            </CardContent>
          </Card>
        </div>

        {/* Sidebar: Legende + Beziehungsliste */}
        <div className="lg:col-span-1 space-y-4 overflow-y-auto">
          <Card>
            <CardHeader>
              <h3 className="text-sm font-semibold text-[var(--foreground-primary)]">
                {t('characterGraph.legend')}
              </h3>
            </CardHeader>
            <CardContent className="space-y-1 pt-0">
              {Object.entries(RELATIONSHIP_COLORS).map(([type, color]) => (
                <div
                  key={type}
                  className="flex items-center text-xs text-[var(--foreground-secondary)] gap-2"
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
                <h3 className="text-sm font-semibold text-[var(--foreground-primary)]">
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
                      className="p-2 rounded-md border border-[var(--border-primary)] text-xs space-y-1"
                    >
                      <div className="flex items-center gap-1">
                        <div
                          className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{ backgroundColor: color }}
                        />
                        <span className="font-medium text-[var(--foreground-primary)] truncate">
                          {fromChar?.name}
                        </span>
                        <span className="text-[var(--foreground-muted)]">&rarr;</span>
                        <span className="font-medium text-[var(--foreground-primary)] truncate">
                          {toChar?.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="capitalize text-[var(--foreground-muted)]">
                          {rel.type}
                        </span>
                        <input
                          type="range"
                          min="1"
                          max="10"
                          value={rel.strength || 5}
                          onChange={(e) =>
                            onUpdateRelationship(rel.id, { strength: parseInt(e.target.value) })
                          }
                          className="flex-1 h-1 accent-indigo-500"
                        />
                        <span className="text-[var(--foreground-muted)] w-4 text-right">
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
