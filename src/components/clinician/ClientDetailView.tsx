import React, { useState } from 'react';
import { ClientProfile, ClinicBrandConfig, ProtocolTemplate, ProtocolType, QEEGBrainMap } from '../../types';
import { storageEngine } from '../../services/storageEngine';
import { generatePatientClinicalPDF } from '../../services/pdfReportGenerator';
import { ProtocolBuilderModal } from './ProtocolBuilderModal';
import { BrainMapUploadModal } from './BrainMapUploadModal';
import { ArrowLeft, Send, Activity, Settings2, Download, Upload, Brain, FileText } from 'lucide-react';

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
  const sessions = storageEngine.getSessions().filter(s => s.patientId === client.id);

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Back breadcrumb & Quick Export */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
        <button
          onClick={onBack}
          className="btn btn-ghost"
          style={{ padding: '6px 10px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          <ArrowLeft size={16} /> Back to Roster
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
            <Download size={14} /> PDF Report
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
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
          <img
            src={client.avatarUrl}
            alt={client.name}
            style={{ width: '52px', height: '52px', borderRadius: '50%', objectFit: 'cover' }}
          />
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <h1 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                {client.name}
              </h1>
              <span className={`status-tag status-tag-${client.status}`} style={{ fontSize: '10px', padding: '2px 7px' }}>
                ● {client.status.toUpperCase()}
              </span>
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px', lineHeight: 1.4 }}>
              {client.condition} • Protocol: <strong>{client.assignedProtocol.replace(/-/g, ' ').toUpperCase()}</strong> • Last: {client.lastSessionDate}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', width: 'auto' }}>
          <button
            onClick={() => setShowProtocolBuilder(true)}
            className="btn btn-ghost"
            style={{ border: '1px solid var(--border-default)', fontSize: '12px', padding: '7px 12px', display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <Settings2 size={14} /> Protocol
          </button>
          <button
            onClick={onSendMessage}
            className="btn btn-secondary"
            style={{ padding: '7px 14px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <Send size={14} /> Message
          </button>
        </div>
      </div>

      {/* Horizontally Scrollable Navigation Tabs (Works on iPhone, iPad & Mac) */}
      <div className="clinician-tabs-scroll">
        {[
          { id: 'eeg', label: 'EEG Overview & PSD' },
          { id: 'protocol', label: 'Protocol Settings' },
          { id: 'brainmaps', label: `In-Clinic Brain Maps (${client.brainMaps?.length || 0})` },
          { id: 'telemetry', label: 'Live Telemetry' },
          { id: 'sessions', label: `Session Logs (${sessions.length})` },
        ].map(tab => (
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
          <div className="card-clinician" style={{ padding: '20px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
              <div>
                <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                  Spectral Band Power Distribution (µV²)
                </h3>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                  Color-blind accessible palette with secondary pattern fills
                </p>
              </div>

              {/* Chart Legend */}
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', fontSize: '11px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <div style={{ width: '10px', height: '10px', borderRadius: '2px', background: 'var(--chart-delta)' }} />
                  <span>Delta (0.5-4Hz)</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <div className="pattern-theta" style={{ width: '10px', height: '10px', borderRadius: '2px' }} />
                  <span>Theta (4-8Hz)</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <div className="pattern-alpha" style={{ width: '10px', height: '10px', borderRadius: '2px' }} />
                  <span>Alpha (8-12Hz)</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <div className="pattern-beta" style={{ width: '10px', height: '10px', borderRadius: '2px' }} />
                  <span>Beta (15-30Hz)</span>
                </div>
              </div>
            </div>

            {/* Grouped Bar Chart */}
            <div style={{ width: '100%', height: '220px', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
              <svg viewBox="0 0 700 240" style={{ width: '100%', minWidth: '460px', height: '100%' }}>
                {[0, 20, 40, 60, 80].map(val => {
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

                {[
                  { label: 'Session 1 (Baseline)', delta: 68, theta: 45, alpha: 30, beta: 32 },
                  { label: 'Session 4', delta: 28, theta: 60, alpha: 38, beta: 40 },
                  { label: 'Session 8', delta: 34, theta: 58, alpha: 66, beta: 46 },
                  { label: 'Session 14 (Current)', delta: 35, theta: 56, alpha: 44, beta: 49 },
                ].map((group, gIdx) => {
                  const groupX = 65 + gIdx * 155;
                  const barWidth = 24;
                  return (
                    <g key={group.label}>
                      <rect x={groupX} y={200 - group.delta * 2.2} width={barWidth} height={group.delta * 2.2} fill="var(--chart-delta)" rx="2" />
                      <rect x={groupX + 28} y={200 - group.theta * 2.2} width={barWidth} height={group.theta * 2.2} fill="var(--chart-theta)" rx="2" />
                      <rect x={groupX + 56} y={200 - group.alpha * 2.2} width={barWidth} height={group.alpha * 2.2} fill="var(--chart-alpha)" rx="2" />
                      <rect x={groupX + 84} y={200 - group.beta * 2.2} width={barWidth} height={group.beta * 2.2} fill="var(--chart-beta)" rx="2" />
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
        <div className="card-clinician" style={{ padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                Active Protocol: {client.customProtocolConfig?.name || client.assignedProtocol.replace(/-/g, ' ').toUpperCase()}
              </h3>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                Site: {client.customProtocolConfig?.montageSite || 'Fz / Cz'} • Duration: {client.customProtocolConfig?.sessionDurationMinutes || 25} min
              </p>
            </div>
            <button onClick={() => setShowProtocolBuilder(true)} className="btn btn-dense" style={{ fontSize: '12px', padding: '6px 12px' }}>
              Edit Protocol
            </button>
          </div>

          <div className="card-patient-recessed" style={{ fontSize: '13px', lineHeight: 1.5, padding: '12px 14px' }}>
            <strong>Clinical Rationale:</strong> {client.customProtocolConfig?.clinicalNotes || 'Frontal midline electrode feedback to suppress slow theta bursts and sustain high-frequency beta focus.'}
          </div>
        </div>
      )}

      {/* TAB 3: IN-CLINIC BRAIN MAPS */}
      {activeTab === 'brainmaps' && (
        <div className="card-clinician" style={{ padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
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
              {client.brainMaps.map(bm => (
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

      {/* TAB 4: LIVE TELEMETRY STREAM */}
      {activeTab === 'telemetry' && (
        <div className="card-clinician" style={{ padding: '20px 16px', textAlign: 'center' }}>
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', color: 'var(--status-active)', marginBottom: '8px' }}>
            <Activity size={16} />
            <span style={{ fontWeight: 600, fontSize: '14px' }}>Remote EEG Stream Live Feed</span>
          </div>
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
                d="M 0 60 Q 40 20, 80 60 T 160 60 T 240 30 T 320 90 T 400 60 T 500 60"
                fill="none"
                stroke="#E8967A"
                strokeWidth="2.5"
              />
            </svg>
            <div style={{ position: 'absolute', top: 8, right: 10, color: '#FFFFFF', fontSize: '10px', fontFamily: 'var(--font-mono)' }}>
              100 Hz • 4 Channels Verified
            </div>
          </div>
        </div>
      )}

      {/* TAB 5: ARCHIVED SESSION LOGS */}
      {activeTab === 'sessions' && (
        <div className="card-clinician" style={{ padding: '18px 16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '12px' }}>
            <h3 style={{ fontSize: '15px', fontWeight: 600, margin: 0 }}>Archived Session Time-Series Data</h3>
            <button onClick={handleDownloadPDF} className="btn btn-dense" style={{ fontSize: '11px', padding: '5px 10px', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Download size={12} /> Export PDF
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {sessions.map(s => (
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
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: '13px' }}>{s.date} • {s.experience.replace(/-/g, ' ').toUpperCase()}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                    {Math.round(s.durationSeconds / 60)} min | In-Zone: {s.timeInZonePercent}% | Peak Focus: {s.peakFocusScore}
                  </div>
                </div>
                <button onClick={handleDownloadPDF} className="btn btn-ghost" style={{ fontSize: '11px', padding: '4px 8px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <FileText size={12} /> PDF
                </button>
              </div>
            ))}
          </div>
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
