import { createRoot } from 'react-dom/client';
import { installStorage } from './storage.js';
import { AppWithAuth } from './AuthUI.jsx';
import App from './App.jsx';
import './index.css';

// Artifact-compatible persistence. Must be installed before App mounts.
installStorage();

createRoot(document.getElementById('root')).render(
  <AppWithAuth>
    <App />
  </AppWithAuth>
);
