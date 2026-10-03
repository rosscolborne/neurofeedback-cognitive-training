import React, { useEffect, useMemo, useState } from 'react';
import type { ClientProfile, ClinicBrandConfig, SessionRecord } from '../../types';
import { storageEngine } from '../../services/storageEngine';
import { resolvePatientProtocol } from '../../services/protocols';
import { getClinicalProtocolTemplate } from '../../services/clinicalProtocolTemplates';
import { generatePatientClinicalPDF, generatePracticeOutcomePDF } from '../../services/pdfReportGenerator';
import { Activity, ArrowRight, CheckCircle2, Download, FileText, Minus, Target, TrendingDown, TrendingUp, Users } from 'lucide-react';
import {
  buildClinicalReportViewModel,
  buildClinicalReportAnalytics,
  formatMetric,
  type ClinicalReportCohortFilter,
  type ClinicalReportExportState,
  type ClinicalReportLoadState,
  type ClinicalReportRange,
} from './clinicalReportAnalytics';

interface ClinicalReportsViewProps {
  clients: ClientProfile[];
  brand: ClinicBrandConfig;
  onSelectClient?: (client: ClientProfile) => void;
}

const labelStyle: React.CSSProperties = { fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' };

function StatTile({ label, value, detail, icon }: { label: string; value: string; detail: string; icon: React.ReactNode }) {
  return (
    <div className="card-clinician report-stat">
      <div className="report-stat-label"><span>{label}</span>{icon}</div>
      <div className="report-stat-value">{value}</div>
      <div className="report-stat-detail">{detail}</div>
    </div>
  );
}

/**
 * Per-session in-zone values in report order, with each half's average drawn over its half.
 * Lines scale with the container; labels and markers are HTML so text stays readable at any width.
 */
function InZoneTrendChart({ values, firstAverage, recentAverage }: { values: Array<{ value: number; label: string; demo: boolean }>; firstAverage: number; recentAverage: number }) {
  const hasDemo = values.some((point) => point.demo);
  const x = (index: number) => (values.length === 1 ? 50 : (index / (values.length - 1)) * 100);
  const y = (percent: number) => 100 - percent;
  const half = Math.floor(values.length / 2);
  const line = values.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(2)},${y(point.value).toFixed(2)}`).join(' ');
  return (
    <div className={`trend-chart${values.length > 30 ? ' is-dense' : ''}`} role="img" aria-label={`In-zone time for ${values.length} sessions: first-half average ${firstAverage}%, recent-half average ${recentAverage}%`}>
      <div className="trend-plot">
        {[100, 50, 0].map((tick) => <span key={tick} className="trend-tick" style={{ top: `${y(tick)}%` }}>{tick}%</span>)}
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {[0, 50, 100].map((tick) => <line key={tick} x1="0" x2="100" y1={y(tick)} y2={y(tick)} stroke="var(--border-subtle)" strokeWidth="1" vectorEffect="non-scaling-stroke" />)}
          {half > 0 && (
            <>
              <line x1={x(half - 0.5)} x2={x(half - 0.5)} y1="0" y2="100" stroke="var(--border-default)" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
              <line x1={x(0)} x2={x(half - 1)} y1={y(firstAverage)} y2={y(firstAverage)} stroke="var(--text-secondary)" strokeWidth="2" strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />
              <line x1={x(values.length - half)} x2={x(values.length - 1)} y1={y(recentAverage)} y2={y(recentAverage)} stroke="var(--text-primary)" strokeWidth="2" strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />
            </>
          )}
          <path d={line} fill="none" stroke="var(--brand-primary)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </svg>
        {values.length <= 60 && values.map((point, index) => (
          <span key={index} className={`trend-marker${point.demo ? ' is-demo' : ''}`} style={{ left: `${x(index)}%`, top: `${y(point.value)}%` }} title={`${point.label}: ${point.value}% in zone${point.demo ? ' (Demo, simulated)' : ''}`} />
        ))}
      </div>
      {half > 0 && (
        <div className="trend-foot">
          <span>First half · avg {firstAverage}%</span>
          <span>Recent half · avg {recentAverage}%</span>
        </div>
      )}
      {hasDemo && values.length <= 60 && <div className="trend-legend-demo"><span className="trend-marker is-demo" aria-hidden="true" /> Demo session (simulated)</div>}
    </div>
  );
}

// Phones show this as its own scrollable column so the pinned patient column stays narrow; desktop keeps it under the name.
const reportProtocolLabel = (client: ClientProfile) => client.isDemo
  ? 'Sample record'
  : getClinicalProtocolTemplate(resolvePatientProtocol(client))?.name ?? 'Protocol unavailable';

const filterButtonStyle: React.CSSProperties = { padding: '6px 12px', fontSize: '13px' };

export const ClinicalReportsView: React.FC<ClinicalReportsViewProps> = ({ clients, brand, onSelectClient }) => {
  const [filterCohort, setFilterCohort] = useState<ClinicalReportCohortFilter>('real');
  const [dateRange, setDateRange] = useState<ClinicalReportRange>('30d');
  const [allSessions, setAllSessions] = useState<SessionRecord[]>([]);
  const [loadState, setLoadState] = useState<ClinicalReportLoadState>('loading');
  const [reloadToken, setReloadToken] = useState(0);
  const [exportState, setExportState] = useState<ClinicalReportExportState>('idle');
  const [reportEndMs] = useState(() => Date.now());
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  useEffect(() => {
    let isMounted = true;
    storageEngine.getSessions()
      .then(data => {
        if (!isMounted) return;
        setAllSessions(data);
        setLoadState('ready');
      })
      .catch(error => {
        console.error('Unable to load clinical report sessions:', error);
        if (!isMounted) return;
        setAllSessions([]);
        setLoadState('error');
      });
    return () => { isMounted = false; };
  }, [reloadToken]);

  const viewModel = useMemo(() => buildClinicalReportViewModel({
    clients,
    sessions: allSessions,
    cohortFilter: filterCohort,
    range: dateRange,
    loadState,
    exportState,
    nowMs: reportEndMs,
    timeZone,
  }), [allSessions, clients, dateRange, exportState, filterCohort, loadState, reportEndMs, timeZone]);
  const { analytics, interval } = viewModel;
  const available = viewModel.loadState === 'ready';

  const exportReport = async (client?: ClientProfile) => {
    if (viewModel.exportDisabled) return;
    setExportState('exporting');
    try {
      if (client) {
        await generatePatientClinicalPDF(client, buildClinicalReportAnalytics([client], allSessions, interval), brand);
      } else {
        await generatePracticeOutcomePDF(analytics, brand);
      }
      setExportState('idle');
    } catch (error) {
      console.error('Unable to export clinical report:', error);
      setExportState('error');
    }
  };

  const intervalText = viewModel.intervalText;
  // Same series and order the analytics use for the first/recent-half comparison.
  const inZoneSeries = analytics.sessions
    .filter((session) => typeof session.timeInZonePercent === 'number' && Number.isFinite(session.timeInZonePercent) && session.timeInZonePercent >= 0 && session.timeInZonePercent <= 100)
    .map((session) => ({
      value: session.timeInZonePercent as number, // the filter above guarantees a number
      demo: session.isDemo === true,
      label: typeof session.timestamp === 'number' && Number.isFinite(session.timestamp)
        ? new Date(session.timestamp).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: interval.timeZone })
        : 'Session',
    }));
  const metric = (value: number | null, suffix = '') => available ? formatMetric(value, suffix) : 'Unavailable';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 className="font-body" style={{ fontSize: '22px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>Session Activity Reports</h1>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '2px' }}>Recorded sessions and measurement coverage for the selected cohort and window.</p>
        </div>
        <button onClick={() => void exportReport()} disabled={viewModel.exportDisabled} className="btn btn-dense" style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', fontSize: '13px' }}>
          <Download size={15} /> Export Practice Summary (PDF)
        </button>
      </div>

      <div className="card-clinician" style={{ padding: '12px 16px', background: '#FFFFFF' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={labelStyle}>Cohort:</span>
            {([
              ['all', `All (${clients.length})`],
              ['real', `Enrolled (${clients.filter(client => !client.isDemo).length})`],
              ['demo', `Sample (${clients.filter(client => client.isDemo).length})`],
            ] as Array<[ClinicalReportCohortFilter, string]>).map(([id, label]) => (
              <button key={id} onClick={() => setFilterCohort(id)} className={filterCohort === id ? 'btn btn-dense' : 'btn btn-ghost'} style={filterButtonStyle}>{label}</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={labelStyle}>Window:</span>
            {([['30d', 'Last 30 Days'], ['90d', 'Last 90 Days'], ['ytd', 'YTD']] as Array<[ClinicalReportRange, string]>).map(([id, label]) => (
              <button key={id} onClick={() => setDateRange(id)} className={dateRange === id ? 'btn btn-dense' : 'btn btn-ghost'} style={filterButtonStyle}>{label}</button>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: '6px 16px', marginTop: '10px', fontSize: '12px', color: 'var(--text-secondary)' }}>
          <span>Interval: {intervalText}</span>
          <details className="report-about">
            <summary>About this data</summary>
            <ul>
              <li>Source: authenticated session repository fields.</li>
              <li>Intentional training Demo sessions remain included and are labeled by provenance; fictional sample-workspace records are counted separately and excluded.</li>
              <li>Adherence: recorded sessions ÷ expected sessions, capped at 100%. Expected sessions come from each patient’s weekly target × {interval.dayCount}/7 days, so they grow with the selected window.</li>
              <li>Unavailable values are not replaced with defaults or zero.</li>
            </ul>
          </details>
        </div>
      </div>

      {viewModel.presentation === 'loading' && <div role="status" className="card-clinician" style={{ padding: '14px', color: 'var(--text-secondary)' }}>Loading persisted sessions… Report measurements and exports are unavailable until loading completes.</div>}
      {viewModel.presentation === 'error' && (
        <div role="alert" className="card-clinician" style={{ padding: '14px', color: 'var(--status-error)' }}>
          Session data could not be loaded. This is not an empty report. <button className="btn btn-ghost" onClick={() => { setExportState('idle'); setLoadState('loading'); setReloadToken(token => token + 1); }}>Retry</button>
        </div>
      )}
      {viewModel.presentation === 'empty' && <div className="card-clinician" style={{ padding: '14px', color: 'var(--text-secondary)' }}>No eligible clinical or training Demo sessions were found in this interval.</div>}
      {viewModel.exportError && <div role="alert" style={{ color: 'var(--status-error)', fontSize: '12px' }}>{viewModel.exportError}</div>}

      <div className="report-stats">
        <StatTile label="Sessions recorded" value={available ? `${analytics.totalSessions}` : 'Unavailable'} detail={available ? `${metric(analytics.averageDurationMinutes.value, ' min')} average · ${analytics.averageDurationMinutes.recordedSessions}/${analytics.averageDurationMinutes.eligibleSessions} durations recorded` : 'Unavailable'} icon={<Activity size={16} aria-hidden="true" />} />
        <StatTile label="Adherence" value={metric(analytics.adherencePercent, '%')} detail={available && analytics.expectedSessions != null ? `${analytics.totalSessions} of ${analytics.expectedSessions} expected sessions` : 'Needs a weekly target for every patient'} icon={<CheckCircle2 size={16} aria-hidden="true" />} />
        <StatTile label="Average in-zone time" value={metric(analytics.averageInZonePercent.value, '%')} detail={available ? `${analytics.averageInZonePercent.recordedSessions}/${analytics.averageInZonePercent.eligibleSessions} sessions measured${analytics.demoSessionCount > 0 ? ` · includes ${analytics.demoSessionCount} Demo` : ''}` : 'Coverage unavailable'} icon={<Target size={16} aria-hidden="true" />} />
        <StatTile label="Patients in cohort" value={available ? `${analytics.clients.length}` : 'Unavailable'} detail={filterCohort === 'real' ? 'Enrolled patients' : filterCohort === 'demo' ? 'Sample records only' : 'Enrolled and sample'} icon={<Users size={16} aria-hidden="true" />} />
      </div>

      <div className="card-clinician" style={{ padding: '18px', background: '#FFFFFF' }}>
        <h2 style={{ fontSize: '15px', margin: 0 }}>In-zone activity</h2>
        {!available ? (
          <p style={{ color: 'var(--text-secondary)', fontSize: '13px', margin: '8px 0 0' }}>Unavailable until session loading completes.</p>
        ) : analytics.timeInZoneTrend ? (
          <>
            <div className="trend-compare">
              <div><div className="trend-label">First half</div><div className="trend-value">{analytics.timeInZoneTrend.firstAverage}%</div></div>
              <ArrowRight size={18} aria-hidden="true" color="var(--text-tertiary)" />
              <div><div className="trend-label">Recent half</div><div className="trend-value">{analytics.timeInZoneTrend.recentAverage}%</div></div>
              <div className="trend-change">
                <div className="trend-label">Change (% points)</div>
                <div className="trend-value" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  {analytics.timeInZoneTrend.change > 0 ? <TrendingUp size={18} aria-hidden="true" /> : analytics.timeInZoneTrend.change < 0 ? <TrendingDown size={18} aria-hidden="true" /> : <Minus size={18} aria-hidden="true" />}
                  {analytics.timeInZoneTrend.change > 0 ? '+' : ''}{analytics.timeInZoneTrend.change}
                </div>
              </div>
              <div><div className="trend-label">Sessions</div><div className="trend-value">{analytics.timeInZoneTrend.recordedSessions}</div></div>
            </div>
            <InZoneTrendChart values={inZoneSeries} firstAverage={analytics.timeInZoneTrend.firstAverage} recentAverage={analytics.timeInZoneTrend.recentAverage} />
            <p style={{ margin: '6px 0 0', color: 'var(--text-secondary)', fontSize: '12px' }}>Descriptive comparison of recorded sessions; not a clinical outcome or significance claim.</p>
          </>
        ) : (
          <p style={{ color: 'var(--text-secondary)', fontSize: '13px', margin: '8px 0 0' }}>Needs at least two sessions with a recorded in-zone measurement.</p>
        )}
      </div>

      {available && (
        <div className="card-clinician report-coverage" aria-label="Data coverage">
          <div><span className="report-coverage-label">Demo sessions</span><strong>{analytics.demoSessionCount}</strong><span>Simulated, included in metrics</span></div>
          <div><span className="report-coverage-label">Sample records</span><strong>{analytics.sampleSessionCount}</strong><span>Fictional, excluded from metrics</span></div>
          <div><span className="report-coverage-label">Device snapshots</span><strong>{metric(analytics.deviceCoverage.value, '%')}</strong><span>{analytics.deviceCoverage.recordedSessions}/{analytics.deviceCoverage.eligibleSessions} sessions with device details</span></div>
          <div><span className="report-coverage-label">Device models</span><strong style={{ fontSize: '13px' }}>{analytics.deviceModels.length ? analytics.deviceModels.map(item => `${item.model} (${item.sessions})`).join(', ') : 'Not recorded'}</strong></div>
        </div>
      )}

      <div className="card-clinician" style={{ padding: 0, overflow: 'hidden', background: '#FFFFFF' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border-default)', display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'baseline', gap: '4px 16px' }}>
          <h2 style={{ fontSize: '15px', margin: 0 }}>Patient interval activity</h2><span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{intervalText}</span>
        </div>
        <div className="scroll-x">
          <table className="report-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
            <thead><tr style={{ background: 'var(--surface-clinician-sidebar)' }}>{['Patient', 'Sessions', 'Adherence', 'In zone', 'Duration', 'Demo', 'Sample', 'Device', 'Protocol', ''].map((label, index) => <th key={label || index} scope="col" className={label === 'Protocol' ? 'report-col-protocol' : undefined} style={{ color: 'var(--text-secondary)', fontSize: '12px', fontWeight: 600, whiteSpace: 'nowrap' }}>{label || <span className="visually-hidden">Export</span>}</th>)}</tr></thead>
            <tbody>
              {analytics.patientRows.map(row => (
                <tr key={row.client.id} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                  <td className="report-patient-cell"><button className="btn btn-ghost" disabled={!onSelectClient} onClick={() => onSelectClient?.(row.client)} style={{ padding: 0, fontWeight: 600, justifyContent: 'flex-start', textAlign: 'left', minHeight: 0 }}>{row.client.name}</button><div className="report-patient-protocol">{reportProtocolLabel(row.client)}</div></td>
                  <td>{available ? row.sessionCount : 'Unavailable'}</td>
                  <td>{available ? formatMetric(row.adherencePercent, '%') : 'Unavailable'}<div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>{available && row.expectedSessions != null ? `${row.sessionCount} of ${row.expectedSessions} expected` : ''}</div></td>
                  <td>{available ? formatMetric(row.averageInZonePercent, '%') : 'Unavailable'}<div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>{available ? `${row.inZoneRecordedSessions}/${row.sessionCount} recorded` : ''}</div></td>
                  <td>{available ? formatMetric(row.durationMinutes, ' min') : 'Unavailable'}</td>
                  <td>{available ? row.demoSessionCount : 'Unavailable'}</td>
                  <td>{available ? row.sampleSessionCount : 'Unavailable'}</td>
                  <td>{available && row.sessionCount > 0 ? `${Math.round(row.deviceRecordedSessions / row.sessionCount * 100)}%` : 'Unavailable'}<div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>{available ? `${row.deviceRecordedSessions}/${row.sessionCount} sessions` : ''}</div></td>
                  <td className="report-col-protocol">{reportProtocolLabel(row.client)}</td>
                  <td><button className="btn btn-ghost" disabled={viewModel.exportDisabled} onClick={() => void exportReport(row.client)}><FileText size={13} /> PDF</button></td>
                </tr>
              ))}
              {available && analytics.patientRows.length === 0 && <tr><td colSpan={10} style={{ padding: '24px', textAlign: 'center', color: 'var(--text-secondary)' }}>No patients are in this cohort.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
