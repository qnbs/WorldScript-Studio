import { MindMapViewContext } from '../contexts/MindMapViewContext';
import { useMindMapView } from '../hooks/useMindMapView';
import { MindMapCanvas } from './mind-map/MindMapCanvas';
import { MindMapListPanel } from './mind-map/MindMapListPanel';
import { MindMapNodeEditor } from './mind-map/MindMapNodeEditor';
import { MindMapToolbar } from './mind-map/MindMapToolbar';

function MindMapViewContent() {
  return (
    <div className="flex flex-col h-full">
      <MindMapToolbar />
      {/* QNBS-v3: flex-col on mobile — w-56 sidebar would eat too much of a narrow viewport. */}
      <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
        <MindMapListPanel />
        <MindMapCanvas />
        <MindMapNodeEditor />
      </div>
    </div>
  );
}

export default function MindMapView() {
  const value = useMindMapView();
  return (
    <MindMapViewContext.Provider value={value}>
      <MindMapViewContent />
    </MindMapViewContext.Provider>
  );
}
