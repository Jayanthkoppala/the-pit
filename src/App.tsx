import { useEffect } from 'react';
import { FloorCanvas } from './floor/FloorCanvas';
import { Dossier } from './ui/Dossier';
import { useFleet } from './fleet/store';
import { mockSource } from './fleet/mockFeed';
import './App.css';

export default function App() {
  useEffect(() => {
    const apply = useFleet.getState().apply;
    const source = mockSource();
    useFleet.getState().setSourceLabel(source.label);
    const stop = source.start(apply);
    return stop;
  }, []);

  const sourceLabel = useFleet((s) => s.sourceLabel);
  const liveCount = useFleet((s) => Object.values(s.agents).filter((a) => a.state !== 'done' && a.state !== 'failed').length);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" />
          forge&nbsp;floor
        </div>
        <div className="topbar-meta">
          <span className="live-dot" />
          {liveCount} live · <span className="src">{sourceLabel}</span>
        </div>
      </header>
      <main className="stage">
        <div className="floor-wrap">
          <FloorCanvas />
        </div>
        <Dossier />
      </main>
    </div>
  );
}
