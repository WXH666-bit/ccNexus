import { MessageSquare, Code, FolderOpen, Search } from 'lucide-react';

interface Props {
  onSuggestion: (text: string) => void;
  onResearch?: () => void;
}

const suggestions = [
  { icon: <Code size={16} />, text: '梳理这个项目的架构与关键调用链' },
  { icon: <FolderOpen size={16} />, text: '检查当前改动并给出下一步建议' },
  { icon: <Search size={16} />, text: '打开网页研究，检索并筛选可信来源', research: true },
  { icon: <MessageSquare size={16} />, text: '帮我把需求拆成可执行的计划' },
];

export default function WelcomeScreen({ onSuggestion, onResearch }: Props) {
  return (
    <div className="welcome-screen">
      <div className="welcome-logo">
        <div className="logo-icon">
          <img className="welcome-brand-logo" src="./ccnexus-logo.png" alt="" draggable="false" />
        </div>
        <h1 className="welcome-title">ccNexus</h1>
        <p className="welcome-subtitle">从代码到证据，在一个工作台里推进任务</p>
      </div>
      <div className="suggestions">
        {suggestions.map((s, i) => (
          <button key={i} className="suggestion-card" onClick={() => s.research && onResearch ? onResearch() : onSuggestion(s.text)}>
            <span className="suggestion-icon">{s.icon}</span>
            <span className="suggestion-text">{s.text}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
