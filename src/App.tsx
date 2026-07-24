import { Routes, Route, Navigate } from 'react-router-dom';
import ChatView from './views/ChatView';
import HistoryView from './views/HistoryView';
import SettingsView from './views/SettingsView';

export default function App() {
  return (
    <div className="app-root">
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
