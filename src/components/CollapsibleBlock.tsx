import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

interface CollapsibleBlockProps {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export default function CollapsibleBlock({ title, defaultOpen = false, children }: CollapsibleBlockProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="collapsible-block">
      <div className="collapsible-header" onClick={() => setOpen(!open)}>
        <span className="expand-icon">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
        <span className="collapsible-title">{title}</span>
      </div>
      {open && <div className="collapsible-body">{children}</div>}
    </div>
  );
}
