import { useCallback, useEffect, useRef, useState } from 'react';
import { useMindMapViewContext } from '../../contexts/MindMapViewContext';
import { useTranslation } from '../../hooks/useTranslation';
import { MindMapEdgeLayer } from './MindMapEdgeLayer';
import { MindMapNodeShape } from './MindMapNodeShape';

const NODE_COUNT_WARNING = 500;

export function MindMapCanvas() {
  const { t } = useTranslation();
  const {
    activeMindMap,
    zoom,
    panX,
    panY,
    selectedNodeId,
    selectedEdgeId,
    handleSelectNode,
    handleSelectEdge,
    handleOpenNodeEditor,
    handlePan,
  } = useMindMapViewContext();

  const svgRef = useRef<SVGSVGElement>(null);
  const isDragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const [rafId, setRafId] = useState<number | null>(null);
  const pendingPan = useRef({ dx: 0, dy: 0 });

  const flushPan = useCallback(() => {
    if (pendingPan.current.dx !== 0 || pendingPan.current.dy !== 0) {
      handlePan(pendingPan.current.dx, pendingPan.current.dy);
      pendingPan.current = { dx: 0, dy: 0 };
    }
    setRafId(null);
  }, [handlePan]);

  const onMouseDown = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (e.target !== e.currentTarget) return;
      isDragging.current = true;
      lastPos.current = { x: e.clientX, y: e.clientY };
      handleSelectNode(null);
      handleSelectEdge(null);
    },
    [handleSelectNode, handleSelectEdge],
  );

  const onMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!isDragging.current) return;
      // QNBS-v3: batch pan updates in rAF to avoid dispatching on every mousemove
      pendingPan.current.dx += (e.clientX - lastPos.current.x) / zoom;
      pendingPan.current.dy += (e.clientY - lastPos.current.y) / zoom;
      lastPos.current = { x: e.clientX, y: e.clientY };
      if (rafId === null) {
        setRafId(requestAnimationFrame(flushPan));
      }
    },
    [zoom, rafId, flushPan],
  );

  const onMouseUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  useEffect(() => {
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [rafId]);

  if (!activeMindMap) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--sc-text-muted)] text-sm">
        {t('mindmap.emptyState')}
      </div>
    );
  }

  const nodes = activeMindMap.nodes;
  const edges = activeMindMap.edges;
  const showWarning = nodes.length > NODE_COUNT_WARNING;

  return (
    <div className="relative flex-1 overflow-hidden bg-[var(--sc-surface-base)]">
      {showWarning && (
        <div
          role="alert"
          className="absolute top-2 left-1/2 -translate-x-1/2 z-10 bg-[var(--sc-warning-bg)] text-[var(--sc-warning-fg)] text-xs px-3 py-1.5 rounded-sc-sm shadow"
        >
          {t('mindmap.nodeCountWarning')}
        </div>
      )}

      <svg
        ref={svgRef}
        className="w-full h-full"
        role="img"
        aria-label={activeMindMap.name}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        style={{ cursor: isDragging.current ? 'grabbing' : 'grab' }}
      >
        <g transform={`scale(${zoom}) translate(${panX}, ${panY})`}>
          <MindMapEdgeLayer
            nodes={nodes}
            edges={edges}
            selectedEdgeId={selectedEdgeId}
            onSelectEdge={handleSelectEdge}
          />
          {nodes.map((node) => (
            <MindMapNodeShape
              key={node.id}
              node={node}
              isSelected={node.id === selectedNodeId}
              onClick={() => handleSelectNode(node.id)}
              onDoubleClick={() => handleOpenNodeEditor(node.id)}
            />
          ))}
        </g>
      </svg>
    </div>
  );
}
