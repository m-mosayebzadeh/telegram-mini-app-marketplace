import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/newsreader/400.css';
import '@fontsource/newsreader/400-italic.css';
import '@fontsource/newsreader/500.css';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/app.css';
import { App } from './App';
import { WorldProvider } from './state/WorldContext';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WorldProvider>
      <App />
    </WorldProvider>
  </StrictMode>,
);
