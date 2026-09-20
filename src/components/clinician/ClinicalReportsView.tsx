import React, { useEffect, useMemo, useState } from 'react';
import type { ClientProfile, ClinicBrandConfig, SessionRecord } from '../../types';
import { storageEngine } from '../../services/storageEngine';
import { generatePatientClinicalPDF, generatePracticeOutcomePDF } from '../../services/pdfReportGenerator';
import { Activity, CheckCircle2, Download, FileText, HardDrive, Target, Users } from 'lucide-react';
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

const cardStyle: React.CSSProperties = { padding: '16px', backgroundColor: '#FFFFFF' };
const labelStyle: React.CSSProperties = { fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' };

function MetricCard({ label, value, detail, icon }: { label: string; value: string; detail: string; icon: React.ReactNode }) {
  return (
    <div className="card-clinician" style={cardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={labelStyle}>{label}</span>{icon}
      </div>
      <div style={{ fontSize: '24px', fontWeight: 700, color: 'var(--text-primary)', marginTop: '8px' }}>{value}</div>
      <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>{detail}</div>
    </div>
  );
}

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
  const metric = (value: number | null, suffix = '') => available ? formatMetric(value, suffix) : 'Unavailable';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 className="font-body" style={{ fontSize: '22px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>Session Activity Reports</h1>
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>Persisted session activity and measurement coverage for the selected interval.</p>
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
              <button key={id} onClick={() => setFilterCohort(id)} className={filterCohort === id ? 'btn btn-dense' : 'btn btn-ghost'}>{label}</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={labelStyle}>Window:</span>
            {([['30d', 'Last 30 Days'], ['90d', 'Last 90 Days'], ['ytd', 'YTD']] as Array<[ClinicalReportRange, string]>).map(([id, label]) => (
              <button key={id} onClick={() => setDateRange(id)} className={dateRange === id ? 'btn btn-dense' : 'btn btn-ghost'}>{label}</button>
            ))}
          </div>
        </div>
        <div style={{ marginTop: '10px', fontSize: '11px', color: 'var(--text-tertiary)' }}>
          Interval: {intervalText} · Source: authenticated session repository fields · Intentional training Demo sessions remain included and are labeled by provenance · Adherence: persisted interval sessions ÷ scheduled sessions (weekly prescription × {interval.dayCount}/7)
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

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(185px, 1fr))', gap: '12px' }}>
        <MetricCard label="Selected Cohort" value={available ? `${analytics.clients.length}` : 'Unavailable'} detail="Patient profiles in the selected cohort" icon={<Users size={16} />} />
        <MetricCard label="Clinical Sessions" value={available ? `${analytics.totalSessions}` : 'Unavailable'} detail={`${metric(analytics.averageDurationMinutes.value, ' min')} average duration (${available ? `${analytics.averageDurationMinutes.recordedSessions}/${analytics.averageDurationMinutes.eligibleSessions}` : 'unavailable'} recorded)`} icon={<Activity size={16} />} />
        <MetricCard label="Training Demo Completions" value={available ? `${analytics.demoSessionCount}` : 'Unavailable'} detail="Included in aggregates; labeled as synthetic acquisition" icon={<Activity size={16} />} />
        <MetricCard label="Interval Adherence" value={metric(analytics.adherencePercent, '%')} detail={available && analytics.expectedSessions != null ? `${analytics.totalSessions} of ${analytics.expectedSessions} scheduled sessions` : 'Schedule unavailable'} icon={<CheckCircle2 size={16} />} />
        <MetricCard label="Average In-Zone Time" value={metric(analytics.averageInZonePercent.value, '%')} detail={available ? `${analytics.averageInZonePercent.recordedSessions}/${analytics.averageInZonePercent.eligibleSessions} sessions recorded` : 'Coverage unavailable'} icon={<Target size={16} />} />
        <MetricCard label="Device Snapshot Coverage" value={metric(analytics.deviceCoverage.value, '%')} detail={available ? `${analytics.deviceCoverage.recordedSessions}/${analytics.deviceCoverage.eligibleSessions} sessions identify a device` : 'Coverage unavailable'} icon={<HardDrive size={16} />} />
      </div>

      <div className="card-clinician" style={{ padding: '18px', background: '#FFFFFF' }}>
        <h2 style={{ fontSize: '15px', margin: 0 }}>Observed in-zone activity</h2>
        {!available ? (
          <p style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>Unavailable until session loading completes.</p>
        ) : analytics.timeInZoneTrend ? (
          <p style={{ color: 'var(--text-secondary)', fontSize: '12px', marginBottom: 0 }}>
            First-half average {analytics.timeInZoneTrend.firstAverage}% · recent-half average {analytics.timeInZoneTrend.recentAverage}% · descriptive change {analytics.timeInZoneTrend.change > 0 ? '+' : ''}{analytics.timeInZoneTrend.change} percentage points across {analytics.timeInZoneTrend.recordedSessions} recorded sessions. This is not a clinical outcome or significance claim.
          </p>
        ) : (
          <p style={{ color: 'var(--text-secondary)', fontSize: '12px', marginBottom: 0 }}>Unavailable — at least two sessions with recorded in-zone measurements are required.</p>
        )}
        {available && <p style={{ color: 'var(--text-tertiary)', fontSize: '11px', marginBottom: 0 }}>Device models recorded: {analytics.deviceModels.length ? analytics.deviceModels.map(item => `${item.model} (${item.sessions})`).join(', ') : 'Unavailable'}.</p>}
      </div>

      <div className="card-clinician" style={{ padding: 0, overflow: 'hidden', background: '#FFFFFF' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border-default)', display: 'flex', justifyContent: 'space-between' }}>
          <h2 style={{ fontSize: '15px', margin: 0 }}>Patient interval activity</h2><span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{intervalText}</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
            <thead><tr style={{ background: 'var(--surface-clinician-sidebar)' }}>{['Patient', 'Clinical sessions', 'Demo completions', 'Duration', 'Adherence', 'In-zone average', 'Device coverage', 'Export'].map(label => <th key={label} style={{ padding: '10px 14px', color: 'var(--text-secondary)' }}>{label}</th>)}</tr></thead>
            <tbody>
              {analytics.patientRows.map(row => (
                <tr key={row.client.id} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                  <td style={{ padding: '12px 14px' }}><button className="btn btn-ghost" disabled={!onSelectClient} onClick={() => onSelectClient?.(row.client)} style={{ padding: 0, fontWeight: 600 }}>{row.client.name}</button><div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>{row.client.isDemo ? 'Sample record' : row.client.assignedProtocol.replace(/-/g, ' ')}</div></td>
                  <td style={{ padding: '12px 14px' }}>{available ? row.sessionCount : 'Unavailable'}</td>
                  <td style={{ padding: '12px 14px' }}>{available ? row.demoSessionCount : 'Unavailable'}<div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>{available && row.demoSessionCount > 0 ? 'Included · synthetic provenance' : ''}</div></td>
                  <td style={{ padding: '12px 14px' }}>{available ? formatMetric(row.durationMinutes, ' min') : 'Unavailable'}</td>
                  <td style={{ padding: '12px 14px' }}>{available ? formatMetric(row.adherencePercent, '%') : 'Unavailable'}<div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>{available && row.expectedSessions != null ? `${row.sessionCount} / ${row.expectedSessions} scheduled` : ''}</div></td>
                  <td style={{ padding: '12px 14px' }}>{available ? formatMetric(row.averageInZonePercent, '%') : 'Unavailable'}<div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>{available ? `${row.inZoneRecordedSessions}/${row.sessionCount} recorded` : ''}</div></td>
                  <td style={{ padding: '12px 14px' }}>{available && row.sessionCount > 0 ? `${Math.round(row.deviceRecordedSessions / row.sessionCount * 100)}%` : 'Unavailable'}<div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>{available ? `${row.deviceRecordedSessions}/${row.sessionCount} sessions` : ''}</div></td>
                  <td style={{ padding: '12px 14px' }}><button className="btn btn-ghost" disabled={viewModel.exportDisabled} onClick={() => void exportReport(row.client)}><FileText size={13} /> PDF</button></td>
                </tr>
              ))}
              {available && analytics.patientRows.length === 0 && <tr><td colSpan={8} style={{ padding: '24px', textAlign: 'center', color: 'var(--text-secondary)' }}>No patients are in this cohort.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
