import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// No StrictMode: it double-mounts effects, which fights a single long-lived
// PixiJS Application. Canvas apps conventionally opt out.
createRoot(document.getElementById('root')!).render(<App />);
