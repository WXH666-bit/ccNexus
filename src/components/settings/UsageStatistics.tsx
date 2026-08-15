import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { BarChart3, ChevronLeft, ChevronRight, Folder, FolderOpen, LayoutDashboard, List, Sparkles, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import RefreshIcon from '../RefreshIcon';
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
  promptEnhancementUsage?: UsageTotals;
  estimatedCost: number;
  sessions: UsageSession[];
  dailyUsage: UsageDay[];
  todayUsage: UsageToday;
  byModel: UsageModel[];
  runtimeLifecycle?: {
    coldRequests: number;
    warmRequests: number;
  };
  lastUpdated?: number;
  weeklyComparison?: {
    currentWeek: { sessions: number; cost: number; tokens: number };
    lastWeek: { sessions: number; cost: number; tokens: number };
    trends: { sessions: number; cost: number; tokens: number };
  };
}

type UsageTab = 'overview' | 'models' | 'sessions' | 'timeline';
type DateRange = 'today' | '7d' | '30d' | 'all';
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

function subtractUsage(total: UsageTotals, excluded: UsageTotals): UsageTotals {
  return {
    inputTokens: Math.max(0, (total.inputTokens || 0) - (excluded.inputTokens || 0)),
    outputTokens: Math.max(0, (total.outputTokens || 0) - (excluded.outputTokens || 0)),
    cacheWriteTokens: Math.max(0, (total.cacheWriteTokens || 0) - (excluded.cacheWriteTokens || 0)),
    cacheReadTokens: Math.max(0, (total.cacheReadTokens || 0) - (excluded.cacheReadTokens || 0)),
    totalTokens: Math.max(0, (total.totalTokens || 0) - (excluded.totalTokens || 0)),
  };
}

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next.getTime();
}

function dateRangeStart(range: DateRange, now = Date.now()) {
  const todayStart = startOfDay(new Date(now));
  if (range === 'all') return 0;
  if (range === 'today') return todayStart;
  return todayStart - (range === '7d' ? 6 : 29) * 24 * 60 * 60 * 1000;
}

function dateRangeLabel(range: DateRange) {
  if (range === 'today') return '今日';
  if (range === '7d') return '近 7 天';
  if (range === '30d') return '近 30 天';
  return '全部';
}

function dateKeyStart(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number);
  if (!year || !month || !day) return Number.NaN;
  return new Date(year, month - 1, day).getTime();
}

function buildTimelineSlots(dailyUsage: UsageDay[], range: DateRange): UsageDay[] {
  const byDate = new Map(dailyUsage.map((day) => [day.date, day]));
  const slotCount = range === '7d' ? 7 : range === 'today' ? 1 : 30;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const slots: UsageDay[] = [];
  for (let i = slotCount - 1; i >= 0; i -= 1) {
    const d = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    slots.push(byDate.get(key) ?? {
      date: key,
      sessions: 0,
      requestCount: 0,
      usage: { ...EMPTY_USAGE },
      cost: 0,
    });
  }
  return slots;
}

function niceCeil(value: number) {
  if (value <= 0) return 0;
  const base = 10 ** Math.floor(Math.log10(value));
  for (const m of [1, 2, 5, 10]) {
    if (value <= m * base) return m * base;
  }
  return 10 * base;
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
  const [dateRange, setDateRange] = useState<DateRange>('today');
  const [sessionSort, setSessionSort] = useState<'cost' | 'time'>('cost');
  const [sessionPage, setSessionPage] = useState(1);
  const [hoveredDay, setHoveredDay] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

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

  const selectedUsage = useMemo<UsageToday>(() => {
    const summary = {
      ...EMPTY_TODAY_USAGE,
      sessions: statistics?.totalSessions || 0,
    };
    addUsage(summary, statistics?.totalUsage || EMPTY_USAGE);
    for (const day of statistics?.dailyUsage || []) {
      summary.requestCount += day.requestCount || 0;
      summary.cost += day.cost || 0;
    }
    return summary;
  }, [statistics]);

  const cacheWriteUnknown =
    selectedUsage.cacheWriteTokens === 0 && selectedUsage.cacheReadTokens > 0;

  const conversationUsage = useMemo(() => (
    subtractUsage(
      statistics?.totalUsage || EMPTY_USAGE,
      statistics?.promptEnhancementUsage || EMPTY_USAGE,
    )
  ), [statistics]);

  const cacheHitRate = useMemo(() => {
    return calculateCacheHitRate(conversationUsage);
  }, [conversationUsage]);

  const filteredSessions = useMemo(() => {
    const cutoff = dateRangeStart(dateRange);
    return [...(statistics?.sessions || [])]
      .filter(session => session.timestamp >= cutoff)
      .sort((left, right) => sessionSort === 'cost'
        ? right.cost - left.cost
        : right.timestamp - left.timestamp);
  }, [dateRange, sessionSort, statistics]);

  const timelineDays = useMemo(
    () => buildTimelineSlots(statistics?.dailyUsage || [], dateRange),
    [statistics, dateRange],
  );
  const maxDailyTokens = Math.max(...timelineDays.map((day) => day.usage.totalTokens), 0);
  const axisMax = niceCeil(maxDailyTokens);

  const dayFilteredSessions = selectedDay
    ? filteredSessions.filter((session) => {
        const dayStart = dateKeyStart(selectedDay);
        return Number.isFinite(dayStart)
          && session.timestamp >= dayStart
          && session.timestamp < dayStart + 24 * 60 * 60 * 1000;
      })
    : filteredSessions;
  const pageSize = 12;
  const totalPages = Math.max(1, Math.ceil(dayFilteredSessions.length / pageSize));
  const visibleSessions = dayFilteredSessions.slice((sessionPage - 1) * pageSize, sessionPage * pageSize);

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
          <RefreshIcon size={16} spinning={loading} />
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
              {(['today', '7d', '30d', 'all'] as const).map(range => (
                <button key={range} className={dateRange === range ? 'active' : ''} onClick={() => setDateRange(range)}>
                  {dateRangeLabel(range)}
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
                      <span className="usage-today-label">{dateRangeLabel(dateRange)}真实消耗 Tokens</span>
                      <div className="usage-today-value">
                        {formatExactTokens(selectedUsage.totalTokens)}
                        {formatWan(selectedUsage.totalTokens) && <span className="usage-today-wan">{formatWan(selectedUsage.totalTokens)}</span>}
                      </div>
                    </div>
                  </div>
                  <div className="usage-today-side">
                    <div><span>总请求数</span><strong>{formatExactTokens(selectedUsage.requestCount)}</strong></div>
                    <div><span>估算成本</span><strong className="usage-today-cost">{formatCost(selectedUsage.cost)}</strong></div>
                  </div>
                </div>
                <div className="usage-today-breakdown">
                  <div className="usage-today-metric"><span>输入</span><strong>{formatTokens(selectedUsage.inputTokens)}</strong></div>
                  <div className="usage-today-metric"><span>输出</span><strong>{formatTokens(selectedUsage.outputTokens)}</strong></div>
                  <div className="usage-today-metric">
                    <span>缓存创建</span>
                    <strong
                      className={cacheWriteUnknown ? 'usage-write-unknown' : undefined}
                      title={cacheWriteUnknown ? '当前端点未报告缓存写入（新缓存计入输入）' : undefined}
                    >
                      {cacheWriteUnknown ? '—' : formatTokens(selectedUsage.cacheWriteTokens)}
                    </strong>
                  </div>
                  <div className="usage-today-metric"><span>缓存读取</span><strong>{formatTokens(selectedUsage.cacheReadTokens)}</strong></div>
                  <div className="usage-today-metric usage-today-cache">
                    <div><span>正常对话缓存命中率</span><strong>{cacheHitRate.toFixed(1)}%</strong></div>
                    <div className="usage-today-progress"><span style={{ width: `${Math.min(100, cacheHitRate)}%` }} /></div>
                  </div>
                </div>
              </section>
              <div className="usage-stats">
                <div className="stat-card"><h4>总费用</h4><div className="stat-value">{formatCost(selectedUsage.cost)}</div><div className="stat-detail"><span>{trend(statistics.weeklyComparison?.trends.cost)} 较上周</span></div></div>
                <div className="stat-card"><h4>总会话</h4><div className="stat-value">{selectedUsage.sessions}</div><div className="stat-detail"><span>{trend(statistics.weeklyComparison?.trends.sessions)} 较上周</span></div></div>
                <div className="stat-card"><h4>总 Tokens</h4><div className="stat-value">{formatTokens(selectedUsage.totalTokens)}</div><div className="stat-detail"><span>{trend(statistics.weeklyComparison?.trends.tokens)} 较上周</span></div></div>
              <div className="stat-card"><h4>正常对话缓存命中率</h4><div className="stat-value">{cacheHitRate.toFixed(1)}%</div><div className="stat-detail"><span>{formatTokens(conversationUsage.cacheReadTokens)} 缓存读取</span></div></div>
              </div>
              <div className="usage-runtime-lifecycle" aria-label="Runtime 生命周期统计">
                <span>Runtime 请求：冷启动 {formatExactTokens(statistics.runtimeLifecycle?.coldRequests || 0)}</span>
                <span>热复用 {formatExactTokens(statistics.runtimeLifecycle?.warmRequests || 0)}</span>
              </div>
              <div className="usage-token-breakdown">
                {([
                  ['输入', selectedUsage.inputTokens, 'input', false],
                  ['输出', selectedUsage.outputTokens, 'output', false],
                  ['缓存写入', cacheWriteUnknown ? 0 : selectedUsage.cacheWriteTokens, 'cache-write', cacheWriteUnknown],
                  ['缓存读取', selectedUsage.cacheReadTokens, 'cache-read', false],
                ] as const).map(([label, value, className, unknown]) => (
                  <div key={label} className={`usage-token-row${unknown ? ' muted' : ''}`}>
                    <div><span>{label}</span><strong>{unknown ? '—' : formatTokens(value)}</strong></div>
                    <div className="usage-token-track"><span className={className} style={{ width: `${selectedUsage.totalTokens ? Math.min(100, (value / selectedUsage.totalTokens) * 100) : 0}%` }} /></div>
                  </div>
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
              <div className="usage-list-toolbar"><span>{dayFilteredSessions.length} 个会话</span>{selectedDay && <button type="button" className="usage-day-filter-chip" onClick={() => setSelectedDay(null)}>{selectedDay} ×</button>}<div><button className={sessionSort === 'cost' ? 'active' : ''} onClick={() => setSessionSort('cost')}>按费用</button><button className={sessionSort === 'time' ? 'active' : ''} onClick={() => setSessionSort('time')}>按时间</button></div></div>
              {visibleSessions.map(session => <div key={session.sessionId} className="usage-session-row"><div><strong>{session.summary || session.sessionId}</strong><span>{formatDate(session.timestamp)} · {session.model} · {formatTokens(session.usage.totalTokens)} tokens</span></div><strong>{formatCost(session.cost)}</strong></div>)}
              {visibleSessions.length === 0 && <div className="empty-state"><p>当前时间范围暂无会话</p></div>}
              {totalPages > 1 && <div className="usage-pagination"><button onClick={() => setSessionPage(page => Math.max(1, page - 1))} disabled={sessionPage === 1} title="上一页"><ChevronLeft size={16} /></button><span>{sessionPage} / {totalPages}</span><button onClick={() => setSessionPage(page => Math.min(totalPages, page + 1))} disabled={sessionPage === totalPages} title="下一页"><ChevronRight size={16} /></button></div>}
            </div>
          )}

          {activeTab === 'timeline' && (
            <div className="usage-timeline">
              {timelineDays.length <= 1 && (
                <div className="usage-timeline-hint">
                  <span>今日仅 1 天数据，柱状图建议看趋势</span>
                  <button type="button" onClick={() => setDateRange('7d')}>查看近 7 天 →</button>
                </div>
              )}
              {maxDailyTokens === 0 ? (
                <div className="empty-state"><p>当前时间范围暂无数据</p></div>
              ) : (
                <div className="usage-timeline-chart">
                  <div className="usage-timeline-yaxis">
                    <span>{formatTokens(axisMax)}</span>
                    <span>{formatTokens(axisMax * 0.75)}</span>
                    <span>{formatTokens(axisMax * 0.5)}</span>
                    <span>{formatTokens(axisMax * 0.25)}</span>
                    <span>0</span>
                  </div>
                  <div className="usage-timeline-bars">
                    {[75, 50, 25].map((p) => (
                      <div key={p} className="usage-gridline" style={{ bottom: `${p}%` }} />
                    ))}
                    {timelineDays.map((day, idx) => {
                      const total = day.usage.totalTokens;
                      const hasData = total > 0;
                      const segments: [string, number][] = hasData
                        ? ([
                            ['cache-read', day.usage.cacheReadTokens],
                            ['input', day.usage.inputTokens],
                            ['output', day.usage.outputTokens],
                            ['cache-write', day.usage.cacheWriteTokens],
                          ] as [string, number][]).filter(([, v]) => v > 0)
                        : [];
                      const showLabel =
                        timelineDays.length <= 7 || idx % 5 === 0 || idx === timelineDays.length - 1;
                      const popoverStyle: CSSProperties | undefined =
                        idx === 0
                          ? { left: 0, transform: 'none' }
                          : idx === timelineDays.length - 1
                            ? { left: 'auto', right: 0, transform: 'none' }
                            : undefined;
                      return (
                        <div
                          key={day.date}
                          className={`usage-day-column${hasData ? '' : ' empty'}${selectedDay === day.date ? ' selected' : ''}`}
                          onMouseEnter={() => setHoveredDay(day.date)}
                          onMouseLeave={() => setHoveredDay(null)}
                          onClick={() => { setSelectedDay(day.date); setActiveTab('sessions'); }}
                        >
                          {hoveredDay === day.date && hasData && (
                            <div className="usage-day-popover" style={popoverStyle}>
                              <div className="usage-day-popover-date">{day.date}</div>
                              <div className="usage-day-popover-row">
                                <span className="dot total" />总 Tokens<strong>{formatTokens(total)}</strong>
                              </div>
                              <div className="usage-day-popover-row">
                                <span className="dot cache-read" />缓存读取<strong>{formatTokens(day.usage.cacheReadTokens)}</strong>
                              </div>
                              <div className="usage-day-popover-row">
                                <span className="dot input" />输入<strong>{formatTokens(day.usage.inputTokens)}</strong>
                              </div>
                              <div className="usage-day-popover-row">
                                <span className="dot output" />输出<strong>{formatTokens(day.usage.outputTokens)}</strong>
                              </div>
                              <div className="usage-day-popover-meta">
                                {formatCost(day.cost)} · {day.requestCount || 0} 次请求 · {day.sessions} 个会话
                              </div>
                            </div>
                          )}
                          <div
                            className="usage-day-bar-stack"
                            style={{ height: `${hasData ? Math.max(2, (total / axisMax) * 100) : 0}%`, animationDelay: `${idx * 12}ms` }}
                          >
                            {segments.map(([seg, v]) => (
                              <div key={seg} className={`seg ${seg}`} style={{ flexGrow: v }} />
                            ))}
                          </div>
                          {showLabel && <span className="usage-day-label">{day.date.slice(5)}</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              <div className="usage-timeline-legend">
                <span><i className="dot input" />输入</span>
                <span><i className="dot output" />输出</span>
                <span><i className="dot cache-read" />缓存读取</span>
                <span className="usage-timeline-note">柱高按 tokens 口径 · 点击柱子查看当天会话</span>
              </div>
            </div>
          )}

          {statistics.lastUpdated && <div className="usage-last-updated">最后更新：{formatDate(statistics.lastUpdated)}</div>}
        </>
      )}
    </div>
  );
}
