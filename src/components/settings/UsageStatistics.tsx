import { useTranslation } from 'react-i18next';
import { BarChart3 } from 'lucide-react';

export default function UsageStatistics() {
  const { t } = useTranslation();

  // Mock data
  const stats = {
    today: { input: 1250, output: 890, total: 2140 },
    week: { input: 8750, output: 6230, total: 14980 },
    month: { input: 35000, output: 24920, total: 59920 },
  };

  return (
    <div className="settings-section-content">
      <h3>{t('settings.usage.title')}</h3>
      <p className="settings-desc">{t('settings.usage.desc')}</p>

      <div className="usage-stats">
        <div className="stat-card">
          <h4>{t('settings.usage.today')}</h4>
          <div className="stat-value">{stats.today.total.toLocaleString()}</div>
          <div className="stat-detail">
            <span>Input: {stats.today.input.toLocaleString()}</span>
            <span>Output: {stats.today.output.toLocaleString()}</span>
          </div>
        </div>

        <div className="stat-card">
          <h4>{t('settings.usage.thisWeek')}</h4>
          <div className="stat-value">{stats.week.total.toLocaleString()}</div>
          <div className="stat-detail">
            <span>Input: {stats.week.input.toLocaleString()}</span>
            <span>Output: {stats.week.output.toLocaleString()}</span>
          </div>
        </div>

        <div className="stat-card">
          <h4>{t('settings.usage.thisMonth')}</h4>
          <div className="stat-value">{stats.month.total.toLocaleString()}</div>
          <div className="stat-detail">
            <span>Input: {stats.month.input.toLocaleString()}</span>
            <span>Output: {stats.month.output.toLocaleString()}</span>
          </div>
        </div>
      </div>

      <div className="usage-chart">
        <BarChart3 size={200} className="chart-placeholder" />
        <p>Chart visualization coming soon</p>
      </div>
    </div>
  );
}
