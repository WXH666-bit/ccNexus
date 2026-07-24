import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './i18n';
import './index.css';

// Apply saved theme and font size on load
const savedTheme = localStorage.getItem('theme') || 'dark';
const savedFontSize = localStorage.getItem('fontSize') || '14';
document.documentElement.setAttribute('data-theme', savedTheme);
document.documentElement.style.setProperty('--base-font-size', `${savedFontSize}px`);

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
);
