import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import ChatView from './views/ChatView';
import HistoryView from './views/HistoryView';
import SettingsView from './views/SettingsView';

export default function App() {
  const location = useLocation();
  const isChatRoute = location.pathname === '/chat' || location.pathname.startsWith('/chat/');
  const routeSessionId = isChatRoute && location.pathname.startsWith('/chat/')
    ? decodeURIComponent(location.pathname.slice('/chat/'.length).split('/')[0] || '') || undefined
    : undefined;

  return (
    <div className="app-root">
      <div className="window-drag-region" aria-hidden="true">
        <div className="window-title-brand">
          <img className="window-title-logo" src="/ccnexus-logo.png" alt="ccNexus" draggable="false" />
          <span className="window-title">ccNexus</span>
        </div>
      </div>
      <div className={`persistent-chat-shell ${isChatRoute ? '' : 'route-hidden'}`}>
        <ChatView routeSessionId={routeSessionId} />
      </div>
      <div className={`secondary-route-shell ${isChatRoute ? 'route-hidden' : ''}`}>
        <Routes>
          <Route path="/" element={<Navigate to="/chat" replace />} />
          <Route path="/chat/*" element={null} />
          <Route path="/history" element={<HistoryView />} />
          <Route path="/settings" element={<SettingsView />} />
        </Routes>
      </div>
    </div>
  );
}
