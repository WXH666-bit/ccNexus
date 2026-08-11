import { MessageSquare, Code, FolderOpen } from 'lucide-react';

interface Props {
  onSuggestion: (text: string) => void;
}

const suggestions = [
  { icon: <Code size={16} />, text: '帮我重构这个项目的代码结构' },
  { icon: <FolderOpen size={16} />, text: '浏览项目文件并生成 README' },
  { icon: <MessageSquare size={16} />, text: '解释一下这个项目的架构' },
];

export default function WelcomeScreen({ onSuggestion }: Props) {
  return (
    <div className="welcome-screen">
      <div className="welcome-logo">
        <div className="logo-icon">
          <img className="welcome-brand-logo" src="/ccnexus-logo.png" alt="" draggable="false" />
        </div>
        <h1 className="welcome-title">ccNexus</h1>
        <p className="welcome-subtitle">可视化 Claude Code 客户端</p>
      </div>
      <div className="suggestions">
        {suggestions.map((s, i) => (
          <button key={i} className="suggestion-card" onClick={() => onSuggestion(s.text)}>
            <span className="suggestion-icon">{s.icon}</span>
            <span className="suggestion-text">{s.text}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
