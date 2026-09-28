import React, { useState, useEffect, useRef } from 'react';
import { ClientProfile, ClinicBrandConfig, ProtocolTemplate, QEEGBrainMap, SessionRecord } from '../../types';
import { storageEngine } from '../../services/storageEngine';
import { getCalibrationDisplayState } from '../../services/dataMappers';
import { getProtocolTypeForTemplate, resolvePatientProtocol, STANDARD_EEG_BANDS_HZ } from '../../services/protocols';
import { getClinicalProtocolTemplate, getProtocolAssignmentAlias } from '../../services/clinicalProtocolTemplates';
import { resolveProtocolRuntime } from '../../services/adaptiveEngine';
import { generatePatientClinicalPDF } from '../../services/pdfReportGenerator';
import { ProtocolBuilderModal } from './ProtocolBuilderModal';
import { BrainMapUploadModal } from './BrainMapUploadModal';
import { PatientAvatar } from './PatientAvatar';
import { ClinicianSessionDetail } from './ClinicianSessionDetail';
import { appendBrainMapForDisplay, comparePersistedBrainMaps, parsePersistedRecordingDate, type ManualBrainMapSave } from './brainMapManualEntry';
import {
  assessQeegRecord,
  deriveLearningScorePoints,
  deriveSessionBandRows,
  finiteMetric,
  formatSigned,
  getSessionContentState,
  getSessionTabLabel,
} from './clinicalDetailMetrics';
import {
  ArrowLeft,
  Send,
  Calendar,
  Settings2,
  Download,
  Upload,
  Brain,
  FileText,
} from 'lucide-react';

interface ClientDetailViewProps {
  client: ClientProfile;
  brand: ClinicBrandConfig;
  onBack: () => void;
  onUpdateClient: (updated: ClientProfile) => Promise<void>;
  /** Integration seam for the centrally owned authorized append transaction. */
  onAppendBrainMap?: ManualBrainMapSave;
  onSendMessage: () => void;
  onScheduleClient?: () => void;
}

export const ClientDetailView: React.FC<ClientDetailViewProps> = ({
  client,
  brand,
  onBack,
  onUpdateClient,
  onAppendBrainMap,
  onSendMessage,
  onScheduleClient,
}) => {
  const [activeTab, setActiveTab] = useState<'eeg' | 'protocol' | 'brainmaps' | 'sessions'>('eeg');
  const [showProtocolBuilder, setShowProtocolBuilder] = useState(false);
  const [showBrainMapUpload, setShowBrainMapUpload] = useState(false);
  const [persistedBrainMapsByPatient, setPersistedBrainMapsByPatient] = useState<Record<string, QEEGBrainMap[]>>({});
  const [brainMapLoadResult, setBrainMapLoadResult] = useState<{ clientId: string; state: 'ready' | 'error' } | null>(null);
  const [brainMapReloadToken, setBrainMapReloadToken] = useState(0);

  const [sessionResult, setSessionResult] = useState<{
    clientId: string;
    state: 'ready' | 'error';
    sessions: SessionRecord[];
  } | null>(null);
  const [selectedSession, setSelectedSession] = useState<{ clientId: string; sessionId: string } | null>(null);
  const [openedSessions, setOpenedSessions] = useState<Record<string, string[]>>({});
  const [pdfUi, setPdfUi] = useState<{ clientId: string; pendingSessionId: string | null | undefined; error: string | null }>({
    clientId: client.id, pendingSessionId: undefined, error: null,
  });
  if (pdfUi.clientId !== client.id) setPdfUi({ clientId: client.id, pendingSessionId: undefined, error: null });
  const pdfRequestRef = useRef<{ clientId: string; generation: number } | null>(null);
  const pdfGenerationRef = useRef(0);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    pdfGenerationRef.current += 1;
    return () => { pdfGenerationRef.current += 1; };
  }, [client.id]);

  useEffect(() => {
    let isMounted = true;
    storageEngine.getSessions(client.id).then((data) => {
      if (isMounted) {
        setSessionResult({ clientId: client.id, state: 'ready', sessions: data });
      }
    }).catch(() => {
      if (isMounted) {
        setSessionResult({ clientId: client.id, state: 'error', sessions: [] });
      }
    });
    return () => {
      isMounted = false;
    };
  }, [client.id]);

  useEffect(() => {
    let isMounted = true;
    setBrainMapLoadResult(null);
    storageEngine.getBrainMaps(client.id).then((maps) => {
      if (!isMounted) return;
      setPersistedBrainMapsByPatient((current) => {
        const local = current[client.id] ?? [];
        const loadedIds = new Set(maps.map((map) => map.id));
        return { ...current, [client.id]: [...local.filter((map) => !loadedIds.has(map.id)), ...maps] };
      });
      setBrainMapLoadResult({ clientId: client.id, state: 'ready' });
    }).catch(() => {
      if (isMounted) setBrainMapLoadResult({ clientId: client.id, state: 'error' });
    });
    return () => {
      isMounted = false;
    };
  }, [client.id, brainMapReloadToken]);

  const sessions = sessionResult?.clientId === client.id ? sessionResult.sessions : [];
  const sessionsState = sessionResult?.clientId === client.id ? sessionResult.state : 'loading';
  const openedSession = selectedSession?.clientId === client.id
    ? sessions.find((session) => session.id === selectedSession.sessionId) : undefined;
  const handleFeedbackSaved = (sessionId: string, clinicianNotes: string | null) => {
    setSessionResult((current) => current?.clientId === client.id ? {
      ...current,
      sessions: current.sessions.map((entry) => entry.id === sessionId
        ? { ...entry, clinicianNotes: clinicianNotes || undefined } : entry),
    } : current);
  };

  const handleDownloadPDF = async (selected?: SessionRecord) => {
    if (sessionsState !== 'ready' || (pdfRequestRef.current?.clientId === client.id && pdfRequestRef.current.generation === pdfGenerationRef.current)) return;
    const request = { clientId: client.id, generation: pdfGenerationRef.current };
    pdfRequestRef.current = request;
    setPdfUi({ clientId: client.id, pendingSessionId: selected?.id ?? null, error: null });
    try {
      await generatePatientClinicalPDF(client, selected ? [selected] : sessions, brand);
    } catch {
      if (mountedRef.current && pdfGenerationRef.current === request.generation) {
        setPdfUi((current) => current.clientId === client.id
          ? { ...current, error: 'PDF export failed. Please try again.' } : current);
      }
    } finally {
      if (pdfRequestRef.current === request) pdfRequestRef.current = null;
      if (mountedRef.current && pdfGenerationRef.current === request.generation) {
        setPdfUi((current) => current.clientId === client.id
          ? { ...current, pendingSessionId: undefined } : current);
      }
    }
  };

  const handleSaveProtocol = async (newTemplate: ProtocolTemplate) => {
    const assigned = getProtocolTypeForTemplate(newTemplate, client.assignedProtocol);

    const updated: ClientProfile = {
      ...client,
      assignedProtocol: assigned,
      customProtocolConfig: newTemplate,
      allowedExperiences: newTemplate.recommendedExperiences,
    };
    const runtime = resolveProtocolRuntime(updated);
    if (!runtime.ok) throw new Error(runtime.error);
    await onUpdateClient(updated);
  };

  const handleSaveBrainMap = async (map: QEEGBrainMap) => {
    return appendBrainMapForDisplay(map, onAppendBrainMap, (canonical) => {
      setPersistedBrainMapsByPatient((current) => {
        const patientMaps = current[client.id] ?? [];
        return {
          ...current,
          [client.id]: [canonical, ...patientMaps.filter((entry) => entry.id !== canonical.id)],
        };
      });
    });
  };

  const assignedProtocol = resolvePatientProtocol(client);
  const evidenceProtocolName = getClinicalProtocolTemplate(assignedProtocol)?.name ?? assignedProtocol.replace(/-/g, ' ').toUpperCase();
  const persistedBrainMaps = persistedBrainMapsByPatient[client.id] ?? [];
  const brainMapLoadState = brainMapLoadResult?.clientId === client.id ? brainMapLoadResult.state : 'loading';
  const persistedIds = new Set(persistedBrainMaps.map((map) => map.id));
  const profileBrainMaps: unknown[] = Array.isArray(client.brainMaps) ? client.brainMaps : [];
  const brainMaps: unknown[] = [
    ...persistedBrainMaps,
    ...profileBrainMaps.filter((value) => {
      const id = value != null && typeof value === 'object' && 'id' in value ? (value as { id?: unknown }).id : undefined;
      return typeof id !== 'string' || !persistedIds.has(id);
    }),
  ].sort(comparePersistedBrainMaps);
  const sessionContentState = getSessionContentState(sessionsState, sessions);
  const psdRows = deriveSessionBandRows(sessions);
  const psdGroups = psdRows.filter((row) => row.bands != null);
  const invalidPsdRows = psdRows.filter((row) => row.issue);
  const psdMaximum = Math.max(1, ...psdGroups.flatMap((row) => Object.values(row.bands!)));
  const psdAxisMaximum = Math.ceil(psdMaximum / 10) * 10 || 1;
  const psdAxisValues = [0, 0.25, 0.5, 0.75, 1].map((fraction) => psdAxisMaximum * fraction);
  const learningScores = deriveLearningScorePoints(sessions);
  const assignedDeviceName = [client.assignedDevice?.displayName, client.assignedDevice?.model]
    .find((name) => typeof name === 'string' && name.trim().length > 0)?.trim();
  const learningScoreX = (index: number) => learningScores.points.length === 1
    ? 365 : 65 + (index * 600) / (learningScores.points.length - 1);
  const imprintState = getCalibrationDisplayState(client.individualBaselineModel);
  const imprintLabel = imprintState.status === 'valid' ? 'Current'
    : imprintState.status === 'expired' ? 'Expired'
      : imprintState.status === 'invalid' ? 'Needs recalibration' : 'Not calibrated';
  const pdfIsPending = pdfUi.clientId === client.id && pdfUi.pendingSessionId !== undefined;
  const pdfExportDisabled = sessionsState !== 'ready' || pdfIsPending;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Back breadcrumb & Quick Export */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
        <button
          onClick={onBack}
          className="btn btn-ghost"
          style={{ padding: '6px 10px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          <ArrowLeft size={16} /> Back to Patient Roster
        </button>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            onClick={() => setShowBrainMapUpload(true)}
            disabled={brainMapLoadState !== 'ready'}
            className="btn btn-ghost"
            style={{ border: '1px solid var(--border-default)', fontSize: '12px', padding: '6px 12px', display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <Upload size={14} /> Add Manual QEEG Record
          </button>
          <button
            onClick={() => { void handleDownloadPDF(); }}
            disabled={pdfExportDisabled}
            className="btn btn-dense"
            style={{ fontSize: '12px', padding: '6px 14px', display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <Download size={14} /> Export Clinical PDF
          </button>
        </div>
      </div>
      {pdfUi.clientId === client.id && pdfUi.error && <div role="alert" style={{ color: 'var(--status-alert)', fontSize: '13px' }}>{pdfUi.error}</div>}
      {pdfIsPending && <div role="status" style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{pdfUi.pendingSessionId ? `Exporting session ${pdfUi.pendingSessionId} PDF…` : 'Exporting clinical PDF…'}</div>}

      {/* Client Profile Header Card */}
      <div
        className="card-clinician"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '16px',
          padding: '18px 20px',
          backgroundColor: '#FFFFFF',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
          <PatientAvatar avatarUrl={client.avatarUrl} size={52} />
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <h1 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                {client.name}
              </h1>
              <span className={`status-tag status-tag-${client.status}`} style={{ fontSize: '10px', padding: '2px 7px' }}>
                ● {client.status.toUpperCase()}
              </span>
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px', lineHeight: 1.4 }}>
              {client.condition || 'Condition unavailable'} • Protocol: <strong>{evidenceProtocolName}</strong>{assignedDeviceName && <> • Assigned device: <strong>{assignedDeviceName}</strong></>}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
              Neural Imprint: <strong>{imprintLabel}</strong>
              {imprintState.calibratedAt != null && <> • Calibrated <time dateTime={new Date(imprintState.calibratedAt).toISOString()}>{new Date(imprintState.calibratedAt).toLocaleDateString()}</time></>}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            onClick={() => setShowProtocolBuilder(true)}
            className="btn btn-ghost"
            style={{ border: '1px solid var(--border-default)', fontSize: '12px', padding: '7px 12px', display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <Settings2 size={14} /> Adjust Protocol
          </button>
          <button
            onClick={onSendMessage}
            className="btn btn-secondary"
            style={{ padding: '7px 14px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <Send size={14} /> Message Patient
          </button>
          {onScheduleClient && <button type="button" onClick={onScheduleClient} className="btn btn-secondary" style={{ padding: '7px 14px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}><Calendar size={14} /> Schedule</button>}
        </div>
      </div>

      {/* Horizontally Scrollable Navigation Tabs */}
      <div className="clinician-tabs-scroll">
        {[
          { id: 'eeg', label: 'EEG Overview & Spectral PSD' },
          { id: 'protocol', label: 'Protocol Settings' },
          { id: 'brainmaps', label: `QEEG Records (${brainMaps.length})` },
          { id: 'sessions', label: getSessionTabLabel(sessionContentState, sessions.length) },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            style={{
              background: 'none',
              border: 'none',
              borderBottom: activeTab === tab.id ? '2px solid var(--brand-primary)' : '2px solid transparent',
              color: activeTab === tab.id ? 'var(--text-primary)' : 'var(--text-secondary)',
              fontWeight: activeTab === tab.id ? 600 : 500,
              fontSize: '13px',
              padding: '8px 4px',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              flexShrink: 0,
              transition: 'all 0.15s ease',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* TAB 1: EEG OVERVIEW & PSD CHART */}
      {activeTab === 'eeg' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div className="card-clinician" style={{ padding: '20px 16px', backgroundColor: '#FFFFFF' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
              <div>
                <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                  Spectral Power Distribution (µV²) Across Sessions
                </h3>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                  Comparable BrainFlow Welch band powers. These overview bands are fixed; the active reward frequencies are shown in Protocol Settings.
                </p>
              </div>

              {/* Chart Legend */}
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', fontSize: '11px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <div style={{ width: '10px', height: '10px', borderRadius: '2px', background: 'var(--chart-delta)' }} />
                  <span>Delta ({STANDARD_EEG_BANDS_HZ.delta.min}–{STANDARD_EEG_BANDS_HZ.delta.max} Hz)</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <div style={{ width: '10px', height: '10px', borderRadius: '2px', background: 'var(--chart-theta)' }} />
                  <span>Theta ({STANDARD_EEG_BANDS_HZ.theta.min}–{STANDARD_EEG_BANDS_HZ.theta.max} Hz)</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <div style={{ width: '10px', height: '10px', borderRadius: '2px', background: 'var(--chart-alpha)' }} />
                  <span>Alpha ({STANDARD_EEG_BANDS_HZ.alpha.min}–{STANDARD_EEG_BANDS_HZ.alpha.max} Hz)</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <div style={{ width: '10px', height: '10px', borderRadius: '2px', background: 'var(--chart-beta)' }} />
                  <span>Beta ({STANDARD_EEG_BANDS_HZ.beta.min}–{STANDARD_EEG_BANDS_HZ.beta.max} Hz)</span>
                </div>
              </div>
            </div>

            {sessionContentState === 'loading' ? (
              <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '13px' }}>Loading recorded sessions…</div>
            ) : sessionContentState === 'error' ? (
              <div role="alert" style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--status-alert)', fontSize: '13px' }}>Session measurements could not be loaded.</div>
            ) : psdGroups.length === 0 ? (
              <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '13px' }}>No complete persisted band-power measurements are available.</div>
            ) : <div className="chart-touch-container" style={{ width: '100%', height: '220px' }}>
              <svg viewBox="0 0 700 240" style={{ width: '100%', minWidth: '420px', height: '100%' }}>
                {psdAxisValues.map((val) => {
                  const y = 200 - (val / psdAxisMaximum) * 176;
                  return (
                    <g key={val}>
                      <text x="25" y={y + 4} fill="var(--text-tertiary)" fontSize="10" textAnchor="end" fontFamily="var(--font-mono)">
                        {Number.isInteger(val) ? val : val.toFixed(1)}
                      </text>
                      <line x1="35" y1={y} x2="680" y2={y} stroke="var(--border-subtle)" strokeWidth="1" />
                    </g>
                  );
                })}

                {psdGroups.map((group, gIdx) => {
                  const groupX = 65 + gIdx * 155;
                  const barWidth = 24;
                  const bands = group.bands!;
                  return (
                    <g key={group.id}>
                      <rect x={groupX} y={200 - (bands.delta / psdAxisMaximum) * 176} width={barWidth} height={(bands.delta / psdAxisMaximum) * 176} fill="var(--chart-delta)" rx="2"><title>{`Delta: ${bands.delta}`}</title></rect>
                      <rect x={groupX + 28} y={200 - (bands.theta / psdAxisMaximum) * 176} width={barWidth} height={(bands.theta / psdAxisMaximum) * 176} fill="var(--chart-theta)" rx="2"><title>{`Theta: ${bands.theta}`}</title></rect>
                      <rect x={groupX + 56} y={200 - (bands.alpha / psdAxisMaximum) * 176} width={barWidth} height={(bands.alpha / psdAxisMaximum) * 176} fill="var(--chart-alpha)" rx="2"><title>{`Alpha: ${bands.alpha}`}</title></rect>
                      <rect x={groupX + 84} y={200 - (bands.beta / psdAxisMaximum) * 176} width={barWidth} height={(bands.beta / psdAxisMaximum) * 176} fill="var(--chart-beta)" rx="2"><title>{`Beta: ${bands.beta}`}</title></rect>
                      <text x={groupX + 54} y="222" fill="var(--text-secondary)" fontSize="11" textAnchor="middle" fontWeight="500">
                        {group.label}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>}
            {psdGroups.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '8px', fontSize: '10px', color: 'var(--text-secondary)' }}>
                {psdGroups.map((row) => (
                  <div key={`values-${row.id}`}>
                    <strong>{row.label}:</strong> Delta {row.bands!.delta} · Theta {row.bands!.theta} · Alpha {row.bands!.alpha} · Beta {row.bands!.beta} µV²
                  </div>
                ))}
              </div>
            )}
            {invalidPsdRows.length > 0 && sessionsState === 'ready' && (
              <div role="status" style={{ marginTop: '8px', color: 'var(--status-alert)', fontSize: '11px' }}>
                {invalidPsdRows.length} session{invalidPsdRows.length === 1 ? '' : 's'} omitted because comparable BrainFlow Welch band power is unavailable or incomplete.
              </div>
            )}
            
            {/* Learning Curve Chart */}
            {learningScores.points.length > 0 && <div style={{ marginTop: '24px', borderTop: '1px solid var(--border-subtle)', paddingTop: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
                <div>
                  <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                    Self-Regulation Learning Curve
                  </h3>
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                    Persisted learning-rate scores only (0–100). Missing scores are not estimated.
                  </p>
                </div>
              </div>
              
              <div className="chart-touch-container" style={{ width: '100%', height: '160px' }}>
                <svg viewBox="0 0 700 160" style={{ width: '100%', minWidth: '420px', height: '100%' }}>
                  {[0, 25, 50, 75, 100].map((val) => {
                    const y = 140 - val * 1.2;
                    return (
                      <g key={`lc-${val}`}>
                        <text x="25" y={y + 4} fill="var(--text-tertiary)" fontSize="10" textAnchor="end" fontFamily="var(--font-mono)">
                          {val}
                        </text>
                        <line x1="35" y1={y} x2="680" y2={y} stroke="var(--border-subtle)" strokeWidth="1" strokeDasharray="4 4" />
                      </g>
                    );
                  })}
                  
                  {/* Line Path */}
                  <path
                    d={learningScores.points.map((point, idx) => `${idx === 0 ? 'M' : 'L'} ${learningScoreX(idx)} ${140 - point.value * 1.2}`).join(' ')}
                    fill="none"
                    stroke="var(--brand-primary)"
                    strokeWidth="3"
                  />
                  
                  {/* Points */}
                  {learningScores.points.map((point, idx) => (
                    <circle key={point.id} cx={learningScoreX(idx)} cy={140 - point.value * 1.2} r="5" fill="var(--surface-clinician-base)" stroke="var(--brand-primary)" strokeWidth="2" />
                  ))}
                </svg>
              </div>
              {learningScores.invalidCount > 0 && (
                <div role="status" style={{ color: 'var(--status-alert)', fontSize: '11px' }}>
                  {learningScores.invalidCount} session{learningScores.invalidCount === 1 ? '' : 's'} omitted because the score is missing or invalid.
                </div>
              )}
              {learningScores.invalidDateCount > 0 && (
                <div role="status" style={{ color: 'var(--status-alert)', fontSize: '11px' }}>
                  {learningScores.invalidDateCount} scored session{learningScores.invalidDateCount === 1 ? '' : 's'} omitted because the recorded date is invalid.
                </div>
              )}
            </div>}
          </div>
        </div>
      )}

      {/* TAB 2: PROTOCOL SETTINGS */}
      {activeTab === 'protocol' && (
        <div className="card-clinician" style={{ padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: '14px', backgroundColor: '#FFFFFF' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                Active Protocol: {client.customProtocolConfig
                  ? (assignedProtocol ? getProtocolAssignmentAlias(client.customProtocolConfig, assignedProtocol) : undefined) || client.customProtocolConfig.name || 'Unavailable'
                  : evidenceProtocolName}
              </h3>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                {client.customProtocolConfig && <>Evidence-Based Protocol: <strong>{client.customProtocolConfig.name}</strong> • </>}
                10-20 Site: <strong>{client.customProtocolConfig?.montageSite || 'Unavailable'}</strong> • Channel mapping: <strong>{client.customProtocolConfig?.museChannelMapping || 'Unavailable'}</strong>
              </p>
            </div>
            <button onClick={() => setShowProtocolBuilder(true)} className="btn btn-dense" style={{ fontSize: '12px', padding: '6px 12px' }}>
              Edit Protocol
            </button>
          </div>

          <div className="card-patient-recessed" style={{ fontSize: '13px', lineHeight: 1.5, padding: '12px 14px' }}>
            <strong>Clinical notes:</strong> {client.customProtocolConfig?.clinicalNotes || 'Unavailable — no notes are stored with this assignment.'}
          </div>
        </div>
      )}

      {/* TAB 3: IN-CLINIC BRAIN MAPS */}
      {activeTab === 'brainmaps' && (
        <div className="card-clinician" style={{ padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: '14px', backgroundColor: '#FFFFFF' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px' }}>
            <div>
              <h3 style={{ fontSize: '15px', fontWeight: 600, margin: 0 }}>In-Clinic QEEG Brain Maps</h3>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                Manually entered values from a validated clinical source. Neurasticity does not calculate normative transforms here.
              </p>
            </div>
            <button onClick={() => setShowBrainMapUpload(true)} disabled={brainMapLoadState !== 'ready'} className="btn btn-dense" style={{ fontSize: '12px', padding: '6px 12px', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Upload size={13} /> Add Manual Record
            </button>
          </div>

          {brainMapLoadState === 'loading' && (
            <div role="status" style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Loading saved QEEG records…</div>
          )}
          {brainMapLoadState === 'error' && (
            <div role="alert" style={{ fontSize: '12px', color: 'var(--status-alert)', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span>Saved QEEG records are unavailable. Retry before adding a record.</span>
              <button type="button" className="btn btn-ghost" onClick={() => setBrainMapReloadToken((value) => value + 1)}>Retry</button>
            </div>
          )}

          {brainMaps.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {brainMaps.map((value, index) => {
                const bm = value != null && typeof value === 'object' ? value as Partial<QEEGBrainMap> : {};
                const assessment = assessQeegRecord(bm);
                return (
                <div
                  key={typeof bm.id === 'string' && bm.id ? bm.id : `malformed-qeeg-${index}`}
                  style={{
                    border: '1px solid var(--border-default)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '14px',
                    backgroundColor: 'var(--surface-clinician-base)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Brain size={16} color="var(--brand-primary)" />
                      <span style={{ fontWeight: 600, fontSize: '13px' }}>{typeof bm.deviceSource === 'string' && bm.deviceSource.trim() ? bm.deviceSource : 'Source unavailable'}</span>
                    </div>
                    <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>Recorded {parsePersistedRecordingDate(bm.recordingDate) ?? 'date unavailable'}</span>
                  </div>

                  {assessment.status !== 'complete' && (
                    <div role="status" style={{ marginTop: '10px', fontSize: '11px', color: 'var(--status-alert)' }}>
                      {assessment.status === 'malformed' ? 'Malformed record' : 'Partial record'}: {assessment.issues.join('; ')}.
                    </div>
                  )}

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '8px', margin: '12px 0' }}>
                    <div className="card-clinician" style={{ padding: '8px 10px' }}>
                      <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>Frontal Theta (Z)</div>
                      <div className="font-mono" style={{ fontSize: '13px', fontWeight: 700 }}>
                        {assessment.zScores.frontalTheta == null ? 'Unavailable' : `Z = ${formatSigned(assessment.zScores.frontalTheta)}`}
                      </div>
                    </div>
                    <div className="card-clinician" style={{ padding: '8px 10px' }}>
                      <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>Central Beta (Z)</div>
                      <div className="font-mono" style={{ fontSize: '13px', fontWeight: 700 }}>
                        {assessment.zScores.centralBeta == null ? 'Unavailable' : `Z = ${formatSigned(assessment.zScores.centralBeta)}`}
                      </div>
                    </div>
                    <div className="card-clinician" style={{ padding: '8px 10px' }}>
                      <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>Occipital Alpha (Z)</div>
                      <div className="font-mono" style={{ fontSize: '13px', fontWeight: 700 }}>
                        {assessment.zScores.occipitalAlpha == null ? 'Unavailable' : `Z = ${formatSigned(assessment.zScores.occipitalAlpha)}`}
                      </div>
                    </div>
                    <div className="card-clinician" style={{ padding: '8px 10px' }}>
                      <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>Temporal Delta (Z)</div>
                      <div className="font-mono" style={{ fontSize: '13px', fontWeight: 700 }}>
                        {assessment.zScores.temporalDelta == null ? 'Unavailable' : `Z = ${formatSigned(assessment.zScores.temporalDelta)}`}
                      </div>
                    </div>
                    <div className="card-clinician" style={{ padding: '8px 10px' }}>
                      <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>Sensorimotor SMR (Z)</div>
                      <div className="font-mono" style={{ fontSize: '13px', fontWeight: 700 }}>
                        {assessment.zScores.sensorimotorSMR == null ? 'Unavailable' : `Z = ${formatSigned(assessment.zScores.sensorimotorSMR)}`}
                      </div>
                    </div>
                    <div className="card-clinician" style={{ padding: '8px 10px' }}>
                      <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>Alpha Peak (IAF)</div>
                      <div className="font-mono" style={{ fontSize: '13px', fontWeight: 700, color: 'var(--chart-alpha)' }}>
                        {assessment.dominantAlphaPeakHz == null ? 'Unavailable' : `${assessment.dominantAlphaPeakHz} Hz`}
                      </div>
                    </div>
                  </div>

                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                    <strong>Technician notes:</strong> {typeof bm.technicianNotes === 'string' && bm.technicianNotes.trim() ? bm.technicianNotes : 'Unavailable'}
                  </div>
                </div>
              );})}
            </div>
          ) : brainMapLoadState === 'ready' ? (
            <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '13px' }}>
              No QEEG measurements have been entered for this patient.
            </div>
          ) : null}
        </div>
      )}

      {/* ARCHIVED SESSION LOGS */}
      <div className="card-clinician" style={{ padding: '18px 16px', backgroundColor: '#FFFFFF', display: activeTab === 'sessions' ? 'block' : 'none' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '12px' }}>
            <h3 style={{ fontSize: '15px', fontWeight: 600, margin: 0 }}>Session Logs</h3>
            <button onClick={() => { void handleDownloadPDF(); }} disabled={pdfExportDisabled} className="btn btn-dense" style={{ fontSize: '11px', padding: '5px 10px', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Download size={12} /> Export PDF
            </button>
          </div>

          {sessionContentState === 'loading' ? (
            <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '13px' }}>Loading session logs…</div>
          ) : sessionContentState === 'error' ? (
            <div role="alert" style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--status-alert)', fontSize: '13px' }}>Session logs could not be loaded.</div>
          ) : sessions.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {sessions.map((s) => (
                <React.Fragment key={s.id}>
                <div
                  style={{
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '10px 12px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '8px',
                    backgroundColor: 'var(--surface-patient-base)',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '13px' }}>
                      {s.date || 'Date unavailable'} • {s.experience ? s.experience.replace(/-/g, ' ').toUpperCase() : 'EXPERIENCE UNAVAILABLE'}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                      Duration: {typeof s.durationSeconds === 'number' && Number.isFinite(s.durationSeconds) ? `${Math.round(s.durationSeconds / 60)} min` : 'Unavailable'} | In-Zone: {finiteMetric(s.timeInZonePercent, '%')} | Coherence: {finiteMetric(s.averageCoherence, '%')}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Protocol: {s.protocol ? s.protocol.replace(/-/g, ' ') : 'Not recorded'} · Mood: {s.moodRating == null ? 'Not recorded' : `${s.moodRating}/5`} · Reflection: {s.patientNotes ? 'Recorded' : 'Not recorded'}</div>
                    {s.clinicianNotes && (
                      <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '2px', fontStyle: 'italic' }}>
                        Clinician: {s.clinicianNotes}
                      </div>
                    )}
                  </div>
                  <button type="button" onClick={() => { setOpenedSessions((current) => ({ ...current, [client.id]: [...new Set([...(current[client.id] || []), s.id])] })); setSelectedSession({ clientId: client.id, sessionId: s.id }); }} className="btn btn-secondary" style={{ fontSize: '11px', padding: '4px 8px' }}>Open {s.id}</button>
                  <button onClick={() => { void handleDownloadPDF(s); }} disabled={pdfExportDisabled} className="btn btn-ghost" style={{ fontSize: '11px', padding: '4px 8px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <FileText size={12} /> PDF
                  </button>
                </div>
                {openedSessions[client.id]?.includes(s.id) && <div style={{ display: openedSession?.id === s.id ? 'block' : 'none' }}><ClinicianSessionDetail key={`${client.id}-${s.id}`} session={s} onSaved={handleFeedbackSaved} /></div>}
                </React.Fragment>
              ))}
            </div>
          ) : (
            <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '13px' }}>
              No training sessions recorded yet for this patient.
            </div>
          )}
        </div>

      {/* Protocol Builder Modal */}
      {showProtocolBuilder && (
        <ProtocolBuilderModal
          assignedProtocol={assignedProtocol}
          initialProtocol={client.customProtocolConfig}
          onSave={handleSaveProtocol}
          onClose={() => setShowProtocolBuilder(false)}
        />
      )}

      {/* Brain Map Upload Modal */}
      {showBrainMapUpload && (
        <BrainMapUploadModal
          patientName={client.name}
          onSave={handleSaveBrainMap}
          onClose={() => setShowBrainMapUpload(false)}
        />
      )}
    </div>
  );
};
