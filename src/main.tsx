import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import './i18n';
import './index.css';
import './codex.css';
import {
  applyAppearancePreferences,
  getLocalAppearancePreferences,
} from './utils/appearancePreferences';

async function bootstrap() {
  const localAppearance = getLocalAppearancePreferences();
  applyAppearancePreferences(localAppearance);

  const savedFontSize = localStorage.getItem('fontSize') || '14';
  document.documentElement.style.setProperty('--base-font-size', `${savedFontSize}px`);

  let appearance = localAppearance;
  if (window.ccNexusDesktop) {
    try {
      appearance = await window.ccNexusDesktop.getAppearancePreferences();
    } catch {
      // Browser/dev mode can run without the Electron appearance bridge.
    }
  }
  applyAppearancePreferences(appearance);

  createRoot(document.getElementById('root')!).render(
    <HashRouter>
      <App />
    </HashRouter>
  );
}

void bootstrap();
