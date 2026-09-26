import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './styles/globals.css';
import './i18n';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
