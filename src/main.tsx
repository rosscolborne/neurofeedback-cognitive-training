import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { App } from './App';
import { AuthProvider } from './contexts/AuthContext';
import './styles/index.css';

// Existing shared links used the physical pathname before the app adopted
// HashRouter. Preserve them when the hosting server serves the app at that URL.
const legacyInvitationCode = window.location.pathname.match(/^\/connect\/([^/]+)\/?$/i)?.[1];
if (legacyInvitationCode && !window.location.hash) {
  window.history.replaceState(window.history.state, '', `/#/connect/${legacyInvitationCode}`);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </HashRouter>
  </StrictMode>
);
