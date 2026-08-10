import { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, ChevronLeft, ChevronRight, Folder, FolderOpen, LayoutDashboard, List, RefreshCw, Sparkles, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getUsageStatistics } from '../../utils/desktopBridgeApi';

interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
}

interface UsageDay {
  date: string;
  sessions: number;
  requestCount?: number;
  usage: UsageTotals;
  cost: number;
  modelsUsed?: string[];
}

interface UsageToday extends UsageTotals {
  requestCount: number;
  sessions: number;
  cost: number;
}

interface UsageSession {
  sessionId: string;
  timestamp: number;
  model: string;
  usage: UsageTotals;
  cost: number;
  summary?: string;
}

interface UsageModel {
  model: string;
  totalCost: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  sessionCount: number;
}

interface UsageStatisticsData {
  scope?: 'current' | 'all';
  projectName?: string;
  totalSessions: number;
  totalUsage: UsageTotals;
  estimatedCost: number;
  sessions: UsageSession[];
  dailyUsage: UsageDay[];
  todayUsage: UsageToday;
  byModel: UsageModel[];
  lastUpdated?: number;
  weeklyComparison?: {
    currentWeek: { sessions: number; cost: number; tokens: number };
    lastWeek: { sessions: number; cost: number; tokens: number };
    trends: { sessions: number; cost: number; tokens: number };
  };
}

type UsageTab = 'overview' | 'models' | 'sessions' | 'timeline';
type DateRange = '7d' | '30d' | 'all';
type ProjectScope = 'current' | 'all';

const EMPTY_USAGE: UsageTotals = {
  inputTokens: 0,
  outputTokens: 0,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
  totalTokens: 0,
};

const EMPTY_TODAY_USAGE: UsageToday = {
  ...EMPTY_USAGE,
  requestCount: 0,
  sessions: 0,
  cost: 0,
};

function formatTokens(value: number) {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return Math.round(value).toLocaleString();
}

function formatCost(value: number) {
  return `$${value.toFixed(4)}`;
}

function formatExactTokens(value: number) {
  return Math.round(value).toLocaleString();
}

function formatWan(value: number) {
  return value >= 10_000 ? `≈ ${(value / 10_000).toFixed(2)} 万` : '';
}

function addUsage(target: UsageTotals, source: UsageTotals) {
  target.inputTokens += source.inputTokens || 0;
  target.outputTokens += source.outputTokens || 0;
  target.cacheWriteTokens += source.cacheWriteTokens || 0;
  target.cacheReadTokens += source.cacheReadTokens || 0;
  target.totalTokens += source.totalTokens || 0;
}

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next.getTime();
}

function dateKeyStart(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number);
  if (!year || !month || !day) return Number.NaN;
  return new Date(year, month - 1, day).getTime();
}

function calculateCacheHitRate(usage: UsageTotals) {
  const denominator = usage.inputTokens + usage.cacheWriteTokens + usage.cacheReadTokens;
  return denominator > 0 ? (usage.cacheReadTokens / denominator) * 100 : 0;
}

function formatDate(timestamp: number) {
  return new Date(timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function UsageStatistics() {
  const { t } = useTranslation();
  const [statistics, setStatistics] = useState<UsageStatisticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<UsageTab>('overview');
  const [projectScope, setProjectScope] = useState<ProjectScope>('current');
  const [dateRange, setDateRange] = useState<DateRange>('7d');
  const [sessionSort, setSessionSort] = useState<'cost' | 'time'>('cost');
  const [sessionPage, setSessionPage] = useState(1);

  const loadStatistics = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setStatistics(await getUsageStatistics({ scope: projectScope, dateRange }) as UsageStatisticsData);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, [dateRange, projectScope]);

  useEffect(() => {
    void loadStatistics();
  }, [loadStatistics]);

  const periods = useMemo(() => {
    const now = Date.now();
    const todayStart = startOfDay(new Date(now));
    const weekStart = todayStart - 6 * 24 * 60 * 60 * 1000;
    const monthStart = todayStart - 29 * 24 * 60 * 60 * 1000;
    const sumSince = (since: number) => {
      const usage = { ...EMPTY_USAGE };
      for (const day of statistics?.dailyUsage || []) {
        if (dateKeyStart(day.date) >= since) addUsage(usage, day.usage);
      }
      return usage;
    };
    return { week: sumSince(weekStart), month: sumSince(monthStart) };
  }, [statistics]);

  const todayUsage = statistics?.todayUsage || EMPTY_TODAY_USAGE;

  const cacheHitRate = useMemo(() => {
    return calculateCacheHitRate(statistics?.totalUsage || EMPTY_USAGE);
  }, [statistics]);

  const todayCacheHitRate = useMemo(() => calculateCacheHitRate(todayUsage), [todayUsage]);

  const filteredSessions = useMemo(() => {
    const cutoff = dateRange === 'all'
      ? 0
      : Date.now() - (dateRange === '7d' ? 7 : 30) * 24 * 60 * 60 * 1000;
    return [...(statistics?.sessions || [])]
      .filter(session => session.timestamp >= cutoff)
      .sort((left, right) => sessionSort === 'cost'
        ? right.cost - left.cost
        : right.timestamp - left.timestamp);
  }, [dateRange, sessionSort, statistics]);

  const filteredDays = useMemo(() => {
    const cutoff = dateRange === 'all'
      ? 0
      : Date.now() - (dateRange === '7d' ? 7 : 30) * 24 * 60 * 60 * 1000;
    return (statistics?.dailyUsage || []).filter(day => dateKeyStart(day.date) >= cutoff);
  }, [dateRange, statistics]);

  const pageSize = 12;
  const totalPages = Math.max(1, Math.ceil(filteredSessions.length / pageSize));
  const visibleSessions = filteredSessions.slice((sessionPage - 1) * pageSize, sessionPage * pageSize);
  const maxDailyCost = Math.max(...filteredDays.map(day => day.cost), 0);

  useEffect(() => {
    setSessionPage(1);
  }, [dateRange, sessionSort]);

  const trend = (value?: number) => {
    if (!value) return '→ 0%';
    return `${value > 0 ? '↑' : '↓'} ${Math.abs(value).toFixed(1)}%`;
  };

  return (
    <div className="settings-section-content usage-statistics-section">
      <div className="settings-section-heading-row">
        <div>
          <h3>{t('settings.usage.title')}</h3>
          <p className="settings-desc">{t('settings.usage.desc')} 按 ccgui 方式读取真实 assistant usage，并按内层 message.id 去重。</p>
        </div>
        <button className="icon-button" onClick={() => void loadStatistics()} disabled={loading} title="刷新">
          <RefreshCw size={16} className={loading ? 'spin' : ''} />
        </button>
      </div>

      {loading && !statistics ? <div className="empty-state"><p>{t('common.loading')}</p></div> : error ? <div className="empty-state"><p>{error}</p></div> : !statistics ? <div className="empty-state"><BarChart3 size={42} className="empty-icon" /><p>暂无用量数据</p></div> : (
        <>
          <div className="usage-controls">
            <div className="usage-scope-buttons">
              <button
                className={projectScope === 'current' ? 'active' : ''}
                onClick={() => { setProjectScope('current'); setSessionPage(1); }}
              >
                <Folder size={14} />
                当前项目
              </button>
              <button
                className={projectScope === 'all' ? 'active' : ''}
                onClick={() => { setProjectScope('all'); setSessionPage(1); }}
              >
                <FolderOpen size={14} />
                全部项目
              </button>
            </div>
            <div className="usage-range-buttons">
              {(['7d', '30d', 'all'] as const).map(range => (
                <button key={range} className={dateRange === range ? 'active' : ''} onClick={() => setDateRange(range)}>
                  {range === '7d' ? '近 7 天' : range === '30d' ? '近 30 天' : '全部'}
                </button>
              ))}
            </div>
            <span className="usage-project-name">{statistics.projectName || '当前项目'}</span>
          </div>

          <div className="usage-tabs" role="tablist">
            <button className={activeTab === 'overview' ? 'active' : ''} onClick={() => setActiveTab('overview')}><LayoutDashboard size={14} /> 概览</button>
            <button className={activeTab === 'models' ? 'active' : ''} onClick={() => setActiveTab('models')}><Sparkles size={14} /> 模型</button>
            <button className={activeTab === 'sessions' ? 'active' : ''} onClick={() => setActiveTab('sessions')}><List size={14} /> 会话</button>
            <button className={activeTab === 'timeline' ? 'active' : ''} onClick={() => setActiveTab('timeline')}><BarChart3 size={14} /> 时间线</button>
          </div>

          {activeTab === 'overview' && (
            <>
              <section className="usage-today-summary" aria-label="今日用量统计">
                <div className="usage-today-header">
                  <div className="usage-today-primary">
                    <div className="usage-today-icon"><Zap size={24} /></div>
                    <div>
                      <span className="usage-today-label">今日真实消耗 Tokens</span>
                      <div className="usage-today-value">
                        {formatExactTokens(todayUsage.totalTokens)}
                        {formatWan(todayUsage.totalTokens) && <span className="usage-today-wan">{formatWan(todayUsage.totalTokens)}</span>}
                      </div>
                    </div>
                  </div>
                  <div className="usage-today-side">
                    <div><span>总请求数</span><strong>{formatExactTokens(todayUsage.requestCount)}</strong></div>
                    <div><span>估算成本</span><strong className="usage-today-cost">{formatCost(todayUsage.cost)}</strong></div>
                  </div>
                </div>
                <div className="usage-today-breakdown">
                  <div className="usage-today-metric"><span>输入</span><strong>{formatTokens(todayUsage.inputTokens)}</strong></div>
                  <div className="usage-today-metric"><span>输出</span><strong>{formatTokens(todayUsage.outputTokens)}</strong></div>
                  <div className="usage-today-metric"><span>缓存创建</span><strong>{formatTokens(todayUsage.cacheWriteTokens)}</strong></div>
                  <div className="usage-today-metric"><span>缓存读取</span><strong>{formatTokens(todayUsage.cacheReadTokens)}</strong></div>
                  <div className="usage-today-metric usage-today-cache">
                    <div><span>缓存命中率</span><strong>{todayCacheHitRate.toFixed(1)}%</strong></div>
                    <div className="usage-today-progress"><span style={{ width: `${Math.min(100, todayCacheHitRate)}%` }} /></div>
                  </div>
                </div>
              </section>
              <div className="usage-stats">
                <div className="stat-card"><h4>总费用</h4><div className="stat-value">{formatCost(statistics.estimatedCost)}</div><div className="stat-detail"><span>{trend(statistics.weeklyComparison?.trends.cost)} 较上周</span></div></div>
                <div className="stat-card"><h4>总会话</h4><div className="stat-value">{statistics.totalSessions}</div><div className="stat-detail"><span>{trend(statistics.weeklyComparison?.trends.sessions)} 较上周</span></div></div>
                <div className="stat-card"><h4>总 Tokens</h4><div className="stat-value">{formatTokens(statistics.totalUsage.totalTokens)}</div><div className="stat-detail"><span>{trend(statistics.weeklyComparison?.trends.tokens)} 较上周</span></div></div>
                <div className="stat-card"><h4>缓存命中率</h4><div className="stat-value">{cacheHitRate.toFixed(1)}%</div><div className="stat-detail"><span>{formatTokens(statistics.totalUsage.cacheReadTokens)} 缓存读取</span></div></div>
              </div>
              <div className="usage-token-breakdown">
                {([
                  ['输入', statistics.totalUsage.inputTokens, 'input'],
                  ['输出', statistics.totalUsage.outputTokens, 'output'],
                  ['缓存写入', statistics.totalUsage.cacheWriteTokens, 'cache-write'],
                  ['缓存读取', statistics.totalUsage.cacheReadTokens, 'cache-read'],
                ] as const).map(([label, value, className]) => (
                  <div key={className} className="usage-token-row"><div><span>{label}</span><strong>{formatTokens(value)}</strong></div><div className="usage-token-track"><span className={className} style={{ width: `${statistics.totalUsage.totalTokens ? Math.min(100, (value / statistics.totalUsage.totalTokens) * 100) : 0}%` }} /></div></div>
                ))}
              </div>
              <div className="usage-period-summary"><span>本周 {formatTokens(periods.week.totalTokens)}</span><span>本月 {formatTokens(periods.month.totalTokens)}</span></div>
            </>
          )}

          {activeTab === 'models' && (
            <div className="usage-model-list">
              {(statistics.byModel || []).map(model => (
                <div key={model.model} className="usage-model-row"><div><strong>{model.model}</strong><span>{model.sessionCount} 个会话 · {formatTokens(model.totalTokens)} tokens</span></div><div><strong>{formatCost(model.totalCost)}</strong><span>输入 {formatTokens(model.inputTokens)} · 输出 {formatTokens(model.outputTokens)}</span></div></div>
              ))}
              {statistics.byModel.length === 0 && <div className="empty-state"><p>暂无模型用量</p></div>}
            </div>
          )}

          {activeTab === 'sessions' && (
            <div className="usage-session-list">
              <div className="usage-list-toolbar"><span>{filteredSessions.length} 个会话</span><div><button className={sessionSort === 'cost' ? 'active' : ''} onClick={() => setSessionSort('cost')}>按费用</button><button className={sessionSort === 'time' ? 'active' : ''} onClick={() => setSessionSort('time')}>按时间</button></div></div>
              {visibleSessions.map(session => <div key={session.sessionId} className="usage-session-row"><div><strong>{session.summary || session.sessionId}</strong><span>{formatDate(session.timestamp)} · {session.model} · {formatTokens(session.usage.totalTokens)} tokens</span></div><strong>{formatCost(session.cost)}</strong></div>)}
              {visibleSessions.length === 0 && <div className="empty-state"><p>当前时间范围暂无会话</p></div>}
              {totalPages > 1 && <div className="usage-pagination"><button onClick={() => setSessionPage(page => Math.max(1, page - 1))} disabled={sessionPage === 1} title="上一页"><ChevronLeft size={16} /></button><span>{sessionPage} / {totalPages}</span><button onClick={() => setSessionPage(page => Math.min(totalPages, page + 1))} disabled={sessionPage === totalPages} title="下一页"><ChevronRight size={16} /></button></div>}
            </div>
          )}

          {activeTab === 'timeline' && (
            <div className="usage-timeline"><div className="usage-timeline-bars">{filteredDays.map(day => <div key={day.date} className="usage-day-column" title={`${day.date} · ${formatCost(day.cost)} · ${day.sessions} 个会话`}><div className="usage-day-bar" style={{ height: `${maxDailyCost > 0 ? Math.max(3, (day.cost / maxDailyCost) * 100) : 3}%` }} /><span>{day.date.slice(5)}</span></div>)}</div>{filteredDays.length === 0 && <div className="empty-state"><p>当前时间范围暂无数据</p></div>}</div>
          )}

          {statistics.lastUpdated && <div className="usage-last-updated">最后更新：{formatDate(statistics.lastUpdated)}</div>}
        </>
      )}
    </div>
  );
}
