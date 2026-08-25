import React, { useState } from 'react';
import { ClientProfile, ClinicBrandConfig, ProtocolTemplate, ProtocolType, QEEGBrainMap, SessionRecord } from '../../types';
import { storageEngine } from '../../services/storageEngine';
import { generatePatientClinicalPDF } from '../../services/pdfReportGenerator';
import { ProtocolBuilderModal } from './ProtocolBuilderModal';
import { BrainMapUploadModal } from './BrainMapUploadModal';
import {
  ArrowLeft,
  Send,
  Activity,
  Settings2,
  Download,
  Upload,
  Brain,
  FileText,
  Cpu,
  CheckCircle2,
  AlertCircle,
  Play,
  Pause,
} from 'lucide-react';

interface ClientDetailViewProps {
  client: ClientProfile;
  brand: ClinicBrandConfig;
  onBack: () => void;
  onUpdateClient: (updated: ClientProfile) => void;
  onSendMessage: () => void;
}

export const ClientDetailView: React.FC<ClientDetailViewProps> = ({
  client,
  brand,
  onBack,
  onUpdateClient,
  onSendMessage,
}) => {
  const [activeTab, setActiveTab] = useState<'eeg' | 'protocol' | 'brainmaps' | 'telemetry' | 'sessions'>('eeg');
  const [showProtocolBuilder, setShowProtocolBuilder] = useState(false);
  const [showBrainMapUpload, setShowBrainMapUpload] = useState(false);

  // Live telemetry interactive simulator state
  const [isStreaming, setIsStreaming] = useState(true);
  const [simulatedBand, setSimulatedBand] = useState<'alpha' | 'theta' | 'beta' | 'smr'>('alpha');

  const sessions = storageEngine.getSessions().filter((s) => s.patientId === client.id);

  const handleDownloadPDF = () => {
    generatePatientClinicalPDF(client, sessions, brand);
  };

  const handleSaveProtocol = (newTemplate: ProtocolTemplate) => {
    let assigned: ProtocolType = 'theta-beta-ratio';
    if (newTemplate.id.includes('smr')) assigned = 'smr-enhancement';
    else if (newTemplate.id.includes('alpha-theta')) assigned = 'alpha-theta-crossover';
    else if (newTemplate.id.includes('alpha')) assigned = 'alpha-enhancement';
    else if (newTemplate.id.includes('beta')) assigned = 'beta-downtraining';

    const updated: ClientProfile = {
      ...client,
      assignedProtocol: assigned,
      customProtocolConfig: newTemplate,
      allowedExperiences: newTemplate.recommendedExperiences,
    };
    onUpdateClient(updated);
  };

  const handleSaveBrainMap = (map: QEEGBrainMap) => {
    const updated: ClientProfile = {
      ...client,
      brainMaps: [map, ...(client.brainMaps || [])],
    };
    onUpdateClient(updated);
  };

  // Generate dynamic PSD data from sessions or fallback
  const psdGroups = sessions.length > 0
    ? sessions.slice(0, 4).reverse().map((s, idx) => ({
        label: `Session ${idx + 1} (${s.date.split(',')[0]})`,
        delta: s.averageBands?.delta || 12,
        theta: s.averageBands?.theta || 8,
        alpha: s.averageBands?.alpha || 11,
        beta: s.averageBands?.beta || 9,
      }))
    : [
        {
          label: 'Baseline QEEG',
          delta: client.brainMaps?.[0]?.zScores ? 20 + client.brainMaps[0].zScores.temporalDelta * 10 : 25,
          theta: client.brainMaps?.[0]?.zScores ? 35 + client.brainMaps[0].zScores.frontalTheta * 15 : 45,
          alpha: client.brainMaps?.[0]?.zScores ? 30 + client.brainMaps[0].zScores.occipitalAlpha * 10 : 30,
          beta: client.brainMaps?.[0]?.zScores ? 25 + client.brainMaps[0].zScores.centralBeta * 10 : 28,
        },
      ];

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
            className="btn btn-ghost"
            style={{ border: '1px solid var(--border-default)', fontSize: '12px', padding: '6px 12px', display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <Upload size={14} /> Import QEEG
          </button>
          <button
            onClick={handleDownloadPDF}
            className="btn btn-dense"
            style={{ fontSize: '12px', padding: '6px 14px', display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <Download size={14} /> Export Clinical PDF
          </button>
        </div>
      </div>

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
          <img
            src={client.avatarUrl}
            alt={client.name}
            style={{ width: '52px', height: '52px', borderRadius: '50%', objectFit: 'cover' }}
          />
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <h1 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                {client.name}
              </h1>
              {client.isDemo && (
                <span style={{ fontSize: '10px', background: 'var(--surface-clinician-sidebar)', color: 'var(--text-tertiary)', padding: '2px 7px', borderRadius: '4px', fontWeight: 600 }}>
                  Sample Record
                </span>
              )}
              <span className={`status-tag status-tag-${client.status}`} style={{ fontSize: '10px', padding: '2px 7px' }}>
                ● {client.status.toUpperCase()}
              </span>
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px', lineHeight: 1.4 }}>
              {client.condition} • Protocol: <strong>{client.assignedProtocol.replace(/-/g, ' ').toUpperCase()}</strong> • Hardware: <strong>Muse S (Athena) 4-Ch</strong>
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
        </div>
      </div>

      {/* Horizontally Scrollable Navigation Tabs */}
      <div className="clinician-tabs-scroll">
        {[
          { id: 'eeg', label: 'EEG Overview & Spectral PSD' },
          { id: 'protocol', label: 'Protocol Settings' },
          { id: 'brainmaps', label: `In-Clinic Brain Maps (${client.brainMaps?.length || 0})` },
          { id: 'telemetry', label: 'Live Telemetry & Athena Fit' },
          { id: 'sessions', label: `Session Logs (${sessions.length})` },
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
                  Extracted from Muse S Athena biosensors (AF7/AF8 Frontal, TP9/TP10 Posterior)
                </p>
              </div>

              {/* Chart Legend */}
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', fontSize: '11px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <div style={{ width: '10px', height: '10px', borderRadius: '2px', background: 'var(--chart-delta)' }} />
                  <span>Delta (1-4Hz)</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <div style={{ width: '10px', height: '10px', borderRadius: '2px', background: 'var(--chart-theta)' }} />
                  <span>Theta (4-8Hz)</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <div style={{ width: '10px', height: '10px', borderRadius: '2px', background: 'var(--chart-alpha)' }} />
                  <span>Alpha (8-12Hz)</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <div style={{ width: '10px', height: '10px', borderRadius: '2px', background: 'var(--chart-beta)' }} />
                  <span>Beta (15-30Hz)</span>
                </div>
              </div>
            </div>

            {/* Dynamic Grouped Bar Chart */}
            <div style={{ width: '100%', height: '220px', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
              <svg viewBox="0 0 700 240" style={{ width: '100%', minWidth: '460px', height: '100%' }}>
                {[0, 20, 40, 60, 80].map((val) => {
                  const y = 200 - val * 2.2;
                  return (
                    <g key={val}>
                      <text x="25" y={y + 4} fill="var(--text-tertiary)" fontSize="10" textAnchor="end" fontFamily="var(--font-mono)">
                        {val}
                      </text>
                      <line x1="35" y1={y} x2="680" y2={y} stroke="var(--border-subtle)" strokeWidth="1" />
                    </g>
                  );
                })}

                {psdGroups.map((group, gIdx) => {
                  const groupX = 65 + gIdx * 155;
                  const barWidth = 24;
                  return (
                    <g key={group.label}>
                      <rect x={groupX} y={200 - Math.min(80, group.delta) * 2.2} width={barWidth} height={Math.min(80, group.delta) * 2.2} fill="var(--chart-delta)" rx="2" />
                      <rect x={groupX + 28} y={200 - Math.min(80, group.theta) * 2.2} width={barWidth} height={Math.min(80, group.theta) * 2.2} fill="var(--chart-theta)" rx="2" />
                      <rect x={groupX + 56} y={200 - Math.min(80, group.alpha) * 2.2} width={barWidth} height={Math.min(80, group.alpha) * 2.2} fill="var(--chart-alpha)" rx="2" />
                      <rect x={groupX + 84} y={200 - Math.min(80, group.beta) * 2.2} width={barWidth} height={Math.min(80, group.beta) * 2.2} fill="var(--chart-beta)" rx="2" />
                      <text x={groupX + 54} y="222" fill="var(--text-secondary)" fontSize="11" textAnchor="middle" fontWeight="500">
                        {group.label}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: PROTOCOL SETTINGS */}
      {activeTab === 'protocol' && (
        <div className="card-clinician" style={{ padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: '14px', backgroundColor: '#FFFFFF' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                Active Protocol: {client.customProtocolConfig?.name || client.assignedProtocol.replace(/-/g, ' ').toUpperCase()}
              </h3>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                10-20 Site: <strong>{client.customProtocolConfig?.montageSite || 'Fz / Cz'}</strong> • Muse S Athena Mapping: <strong>{client.customProtocolConfig?.museChannelMapping || 'AF7 / AF8 Frontal (Derived Fz)'}</strong>
              </p>
            </div>
            <button onClick={() => setShowProtocolBuilder(true)} className="btn btn-dense" style={{ fontSize: '12px', padding: '6px 12px' }}>
              Edit Protocol
            </button>
          </div>

          <div className="card-patient-recessed" style={{ fontSize: '13px', lineHeight: 1.5, padding: '12px 14px' }}>
            <strong>Clinical Rationale:</strong> {client.customProtocolConfig?.clinicalNotes || 'Frontal midline electrode feedback to suppress slow theta bursts and sustain high-frequency beta focus for ADHD inattentive condition.'}
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
                19-channel quantitative EEG baseline data imported from clinical visitations.
              </p>
            </div>
            <button onClick={() => setShowBrainMapUpload(true)} className="btn btn-dense" style={{ fontSize: '12px', padding: '6px 12px', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Upload size={13} /> Upload Map
            </button>
          </div>

          {client.brainMaps && client.brainMaps.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {client.brainMaps.map((bm) => (
                <div
                  key={bm.id}
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
                      <span style={{ fontWeight: 600, fontSize: '13px' }}>{bm.deviceSource}</span>
                    </div>
                    <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>Imported {bm.uploadDate}</span>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '8px', margin: '12px 0' }}>
                    <div className="card-clinician" style={{ padding: '8px 10px' }}>
                      <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>Frontal Theta (Z)</div>
                      <div className="font-mono" style={{ fontSize: '13px', fontWeight: 700, color: bm.zScores.frontalTheta > 2 ? 'var(--status-alert)' : 'var(--status-active)' }}>
                        Z = +{bm.zScores.frontalTheta}
                      </div>
                    </div>
                    <div className="card-clinician" style={{ padding: '8px 10px' }}>
                      <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>Central Beta (Z)</div>
                      <div className="font-mono" style={{ fontSize: '13px', fontWeight: 700 }}>
                        Z = {bm.zScores.centralBeta >= 0 ? `+${bm.zScores.centralBeta}` : bm.zScores.centralBeta}
                      </div>
                    </div>
                    <div className="card-clinician" style={{ padding: '8px 10px' }}>
                      <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>Occipital Alpha (Z)</div>
                      <div className="font-mono" style={{ fontSize: '13px', fontWeight: 700 }}>
                        Z = {bm.zScores.occipitalAlpha >= 0 ? `+${bm.zScores.occipitalAlpha}` : bm.zScores.occipitalAlpha}
                      </div>
                    </div>
                    <div className="card-clinician" style={{ padding: '8px 10px' }}>
                      <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>Alpha Peak (IAF)</div>
                      <div className="font-mono" style={{ fontSize: '13px', fontWeight: 700, color: 'var(--chart-alpha)' }}>
                        {bm.dominantAlphaPeakHz} Hz
                      </div>
                    </div>
                  </div>

                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                    <strong>Technician Notes:</strong> {bm.technicianNotes}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '13px' }}>
              No in-clinic brain maps uploaded yet. Click "Upload Map" to import an EDF or QEEG report.
            </div>
          )}
        </div>
      )}

      {/* TAB 4: LIVE TELEMETRY & ATHENA FIT */}
      {activeTab === 'telemetry' && (
        <div className="card-clinician" style={{ padding: '20px 16px', backgroundColor: '#FFFFFF', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
            <div>
              <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                Muse S (Athena) 4-Channel Live EEG Telemetry
              </h3>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                Real-time biosensing telemetry with 256 Hz delta ADC sampling
              </p>
            </div>

            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button
                onClick={() => setIsStreaming(!isStreaming)}
                className="btn btn-dense"
                style={{ fontSize: '12px', padding: '6px 12px', display: 'flex', alignItems: 'center', gap: '4px' }}
              >
                {isStreaming ? <Pause size={13} /> : <Play size={13} />}
                {isStreaming ? 'Pause Stream' : 'Resume Stream'}
              </button>
            </div>
          </div>

          {/* 4-Channel Sensor Quality Status */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '8px' }}>
            {[
              { id: 'TP9', name: 'TP9 (Left Ear)', state: 'Good Contact (12 kΩ)', color: 'var(--status-active)' },
              { id: 'AF7', name: 'AF7 (Left Forehead)', state: 'Good Contact (8 kΩ)', color: 'var(--status-active)' },
              { id: 'AF8', name: 'AF8 (Right Forehead)', state: 'Good Contact (9 kΩ)', color: 'var(--status-active)' },
              { id: 'TP10', name: 'TP10 (Right Ear)', state: 'Good Contact (14 kΩ)', color: 'var(--status-active)' },
            ].map((ch) => (
              <div key={ch.id} className="card-patient-recessed" style={{ padding: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '12px', fontWeight: 700 }}>{ch.id}</span>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: ch.color }} />
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>{ch.name}</div>
                <div style={{ fontSize: '10px', color: ch.color, fontWeight: 600, marginTop: '2px' }}>{ch.state}</div>
              </div>
            ))}
          </div>

          {/* Live Waveform Canvas / SVG */}
          <div
            style={{
              width: '100%',
              height: '160px',
              backgroundColor: '#1A1A1A',
              borderRadius: 'var(--radius-md)',
              position: 'relative',
              overflow: 'hidden',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg viewBox="0 0 500 120" style={{ width: '100%', height: '100%' }}>
              <path
                d={isStreaming ? 'M 0 60 Q 30 20, 60 60 T 120 60 T 180 30 T 240 90 T 300 50 T 360 70 T 420 40 T 500 60' : 'M 0 60 L 500 60'}
                fill="none"
                stroke={brand.primaryAccent || '#E8967A'}
                strokeWidth="2.5"
              />
            </svg>
            <div style={{ position: 'absolute', top: 8, right: 10, color: '#FFFFFF', fontSize: '10px', fontFamily: 'var(--font-mono)' }}>
              256 Hz • BLE GATT Connected • Zero Packet Loss
            </div>
          </div>
        </div>
      )}

      {/* TAB 5: ARCHIVED SESSION LOGS */}
      {activeTab === 'sessions' && (
        <div className="card-clinician" style={{ padding: '18px 16px', backgroundColor: '#FFFFFF' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '12px' }}>
            <h3 style={{ fontSize: '15px', fontWeight: 600, margin: 0 }}>Archived Session Time-Series Data</h3>
            <button onClick={handleDownloadPDF} className="btn btn-dense" style={{ fontSize: '11px', padding: '5px 10px', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Download size={12} /> Export PDF
            </button>
          </div>

          {sessions.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {sessions.map((s) => (
                <div
                  key={s.id}
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
                      {s.date} • {s.experience.replace(/-/g, ' ').toUpperCase()}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                      {Math.round(s.durationSeconds / 60)} min | In-Zone: {s.timeInZonePercent}% | Peak Focus: {s.peakFocusScore} | Coherence: {s.averageCoherence}%
                    </div>
                    {s.clinicianNotes && (
                      <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '2px', fontStyle: 'italic' }}>
                        Clinician: {s.clinicianNotes}
                      </div>
                    )}
                  </div>
                  <button onClick={handleDownloadPDF} className="btn btn-ghost" style={{ fontSize: '11px', padding: '4px 8px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <FileText size={12} /> PDF
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '13px' }}>
              No training sessions recorded yet for this patient.
            </div>
          )}
        </div>
      )}

      {/* Protocol Builder Modal */}
      {showProtocolBuilder && (
        <ProtocolBuilderModal
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
