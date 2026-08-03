import { Routes, Route, Navigate } from 'react-router-dom';
import ChatView from './views/ChatView';
import HistoryView from './views/HistoryView';
import SettingsView from './views/SettingsView';

export default function App() {
  return (
    <div className="app-root">
      <div className="window-drag-region" aria-hidden="true">
        <span className="window-title">ccNexus</span>
      </div>
      <Routes>
        <Route path="/" element={<Navigate to="/chat" replace />} />
        <Route path="/chat" element={<ChatView />} />
        <Route path="/chat/:sessionId" element={<ChatView />} />
        <Route path="/history" element={<HistoryView />} />
        <Route path="/settings" element={<SettingsView />} />
      </Routes>
    </div>
  );
}
