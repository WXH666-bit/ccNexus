import type { ReactNode } from 'react';
import { FileCode2, Globe2, PanelRightClose, ScanSearch } from 'lucide-react';

export type RightWorkspaceTab = 'review' | 'file' | 'web';

interface Props {
  activeTab: RightWorkspaceTab | null;
  onTabChange: (tab: RightWorkspaceTab | null) => void;
  reviewContent: ReactNode;
  fileContent: ReactNode;
  webContent: ReactNode;
  reviewCount?: number;
  pendingWebCount?: number;
  selectedFileName?: string;
}

const TAB_META: Record<RightWorkspaceTab, {
  label: string;
  description: string;
  icon: typeof ScanSearch;
}> = {
  review: {
    label: '审查',
    description: '任务、子代理与文件变更',
    icon: ScanSearch,
  },
  file: {
    label: '文件',
    description: '查看和编辑当前选中的文件',
    icon: FileCode2,
  },
  web: {
    label: '网页搜索',
    description: '审批并查看 AI 联网活动',
    icon: Globe2,
  },
};

export default function RightWorkspaceSidebar({
  activeTab,
  onTabChange,
  reviewContent,
  fileContent,
  webContent,
  reviewCount = 0,
  pendingWebCount = 0,
  selectedFileName,
}: Props) {
  const open = activeTab !== null;
  const activeMeta = activeTab ? TAB_META[activeTab] : null;
  const ActiveIcon = activeMeta?.icon;

  const selectTab = (tab: RightWorkspaceTab) => {
    onTabChange(activeTab === tab ? null : tab);
  };

  return (
    <aside className={`codex-right-sidebar ${open ? 'is-open' : 'is-collapsed'}`} aria-label="工作区工具">
      <div className="codex-right-panel" aria-hidden={!open}>
        {activeMeta && ActiveIcon ? (
          <div className="codex-right-panel-header">
            <div className="codex-right-panel-heading">
              <span className="codex-right-panel-mark"><ActiveIcon size={16} /></span>
              <div>
                <strong>{activeMeta.label}</strong>
                <span>{activeTab === 'file' && selectedFileName ? selectedFileName : activeMeta.description}</span>
              </div>
            </div>
            <button type="button" onClick={() => onTabChange(null)} title="收起右侧栏" aria-label="收起右侧栏">
              <PanelRightClose size={17} />
            </button>
          </div>
        ) : null}

        <section className="codex-right-panel-view" role="tabpanel" aria-label="审查" hidden={activeTab !== 'review'}>
          {reviewContent}
        </section>
        <section className="codex-right-panel-view" role="tabpanel" aria-label="文件内容" hidden={activeTab !== 'file'}>
          {fileContent}
        </section>
        <section className="codex-right-panel-view" role="tabpanel" aria-label="网页搜索" hidden={activeTab !== 'web'}>
          {webContent}
        </section>
      </div>

      <div className="codex-right-rail" role="tablist" aria-label="右侧工具">
        {(Object.keys(TAB_META) as RightWorkspaceTab[]).map(tab => {
          const meta = TAB_META[tab];
          const Icon = meta.icon;
          const badge = tab === 'web' ? pendingWebCount : tab === 'review' ? reviewCount : 0;
          return (
            <button
              type="button"
              role="tab"
              key={tab}
              className={activeTab === tab ? 'is-active' : ''}
              onClick={() => selectTab(tab)}
              aria-selected={activeTab === tab}
              title={meta.label}
            >
              <Icon size={17} />
              <span>{tab === 'web' ? '网页' : meta.label}</span>
              {badge > 0 && <b>{Math.min(badge, 99)}</b>}
              {tab === 'file' && selectedFileName && <i aria-label={`已选择 ${selectedFileName}`} />}
            </button>
          );
        })}
      </div>
    </aside>
  );
}
