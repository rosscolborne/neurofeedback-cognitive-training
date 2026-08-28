import React, { useEffect, useState } from 'react';
import { eegEngine } from '../../services/eegEngine';
import { EEGDataPoint, MuseChannelQuality, ServerFitState } from '../../types';
import { Wifi, ArrowRight, X, Activity, AlertTriangle } from 'lucide-react';

interface HeadsetFitModalProps {
  onConfirmReady: () => void;
  onClose: () => void;
}

export const HeadsetFitModal: React.FC<HeadsetFitModalProps> = ({ onConfirmReady, onClose }) => {
  const [quality, setQuality] = useState<MuseChannelQuality>(eegEngine.channelQuality);
  const [fitState, setFitState] = useState<ServerFitState | null>(eegEngine.serverFitState);
  const [isPairing, setIsPairing] = useState(false);
  const [pairError, setPairError] = useState<string | null>(null);

  useEffect(() => {
    // Start the engine tick loop so dispatchServerAnalysis fires
    // and brainflow_service can assess channel quality
    eegEngine.start(100);

    const unsubscribe = eegEngine.subscribe((_data: EEGDataPoint) => {
      setQuality({ ...eegEngine.channelQuality });
      setFitState(eegEngine.serverFitState ? { ...eegEngine.serverFitState } : null);
    });

    return () => {
      unsubscribe();
      eegEngine.stop();
    };
  }, []);

  const handlePair = async () => {
    setIsPairing(true);
    setPairError(null);
    const res = await eegEngine.connectMuseBluetooth();
    setIsPairing(false);
    if (!res.success) {
      setPairError(res.error || 'Bluetooth pairing failed');
    }
  };

  const getStatusColor = (status: 'good' | 'fair' | 'poor') => {
    switch (status) {
      case 'good':
        return '#10B981'; // Emerald
      case 'fair':
        return '#F59E0B'; // Amber
      case 'poor':
      default:
        return '#EF4444'; // Red
    }
  };

  const getStatusLabel = (status: 'good' | 'fair' | 'poor') => {
    switch (status) {
      case 'good':
        return 'Good Contact';
      case 'fair':
        return 'Fair (Adjust Fit)';
      case 'poor':
      default:
        return 'Poor / No Contact';
    }
  };

  // Server-driven readiness: use the fit session's `ready` flag
  const isReady = fitState?.ready === true || eegEngine.isDemoMode;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 999,
        backgroundColor: 'rgba(26, 26, 26, 0.65)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
      }}
    >
      <div
        className="card-patient"
        style={{
          width: '100%',
          maxWidth: '480px',
          backgroundColor: '#FFFFFF',
          borderRadius: 'var(--radius-xl)',
          padding: '28px 24px',
          boxShadow: '0 20px 40px rgba(0,0,0,0.15)',
          display: 'flex',
          flexDirection: 'column',
          gap: '20px',
          maxHeight: '92vh',
          overflowY: 'auto',
        }}
      >
        {/* Modal Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 className="font-display" style={{ fontSize: '22px', fontWeight: 600, color: 'var(--text-primary)' }}>
              Headset Fit & Signal Quality
            </h2>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '2px' }}>
              {fitState
                ? 'brainflow_service is assessing sensor contact quality.'
                : 'Waiting for brainflow_service signal assessment...'}
            </p>
          </div>
          <button onClick={onClose} className="btn btn-ghost" style={{ padding: '6px' }}>
            <X size={20} color="var(--text-tertiary)" />
          </button>
        </div>

        {/* Pair Button if not connected */}
        {!eegEngine.isHardwareConnected && !eegEngine.isDemoMode && (
          <div
            style={{
              padding: '14px',
              backgroundColor: 'var(--surface-patient-recessed)',
              borderRadius: 'var(--radius-md)',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
            }}
          >
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
              No Muse Headband connected yet.
            </div>
            <button
              onClick={handlePair}
              disabled={isPairing}
              className="btn btn-primary"
              style={{ width: '100%', padding: '12px' }}
            >
              <Wifi size={16} />
              {isPairing ? 'Pairing via Bluetooth...' : 'Connect Muse Headband (BLE)'}
            </button>
            {pairError && (
              <div style={{ color: '#EF4444', fontSize: '12px' }}>
                {pairError}
              </div>
            )}
          </div>
        )}

        {/* Server Fit State Banner */}
        {fitState && (
          <div
            style={{
              padding: '10px 14px',
              borderRadius: 'var(--radius-md)',
              backgroundColor: fitState.ready ? '#D1FAE5' : fitState.worn ? '#FEF3C7' : '#FEE2E2',
              border: `1px solid ${fitState.ready ? '#10B981' : fitState.worn ? '#F59E0B' : '#EF4444'}`,
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              fontSize: '13px',
            }}
          >
            {fitState.ready ? (
              <>
                <Activity size={16} color="#10B981" />
                <div>
                  <strong style={{ color: '#065F46' }}>Signal Verified</strong>
                  <span style={{ color: '#047857', marginLeft: '6px' }}>— sustained good contact across all sensors.</span>
                </div>
              </>
            ) : fitState.worn ? (
              <>
                <AlertTriangle size={16} color="#F59E0B" />
                <div>
                  <strong style={{ color: '#92400E' }}>Headband Detected</strong>
                  <span style={{ color: '#B45309', marginLeft: '6px' }}>— adjusting for stable contact...</span>
                </div>
              </>
            ) : (
              <>
                <AlertTriangle size={16} color="#EF4444" />
                <div>
                  <strong style={{ color: '#991B1B' }}>Poor Contact</strong>
                  <span style={{ color: '#B91C1C', marginLeft: '6px' }}>— check sensor placement.</span>
                </div>
              </>
            )}
          </div>
        )}

        {/* Blockers from server */}
        {fitState && fitState.blockers.length > 0 && (
          <div
            style={{
              padding: '8px 12px',
              backgroundColor: '#FEF3C7',
              border: '1px solid #FCD34D',
              borderRadius: 'var(--radius-md)',
              fontSize: '12px',
              color: '#92400E',
              lineHeight: 1.4,
            }}
          >
            <strong>Issues detected:</strong>
            <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
              {fitState.blockers.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Visual Head & Electrode Map */}
        <div
          style={{
            position: 'relative',
            width: '100%',
            height: '210px',
            backgroundColor: '#F8F9FA',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
          }}
        >
          {/* Stylized Head Contour SVG */}
          <svg width="180" height="190" viewBox="0 0 180 190" fill="none">
            {/* Head Outline */}
            <path
              d="M 90 20 C 45 20, 25 55, 25 105 C 25 145, 50 175, 90 175 C 130 175, 155 145, 155 105 C 155 55, 135 20, 90 20 Z"
              fill="#FFFFFF"
              stroke="#E5E7EB"
              strokeWidth="2.5"
            />
            {/* Nose Indicator */}
            <path d="M 90 18 L 84 8 L 96 8 Z" fill="#D1D5DB" />
            {/* Left Ear */}
            <path d="M 23 85 C 15 92, 15 112, 23 120" stroke="#D1D5DB" strokeWidth="2.5" strokeLinecap="round" />
            {/* Right Ear */}
            <path d="M 157 85 C 165 92, 165 112, 157 120" stroke="#D1D5DB" strokeWidth="2.5" strokeLinecap="round" />
            {/* Eyebrow Line */}
            <path d="M 48 55 Q 62 48, 76 55" stroke="#E5E7EB" strokeWidth="2" strokeLinecap="round" />
            <path d="M 104 55 Q 118 48, 132 55" stroke="#E5E7EB" strokeWidth="2" strokeLinecap="round" />
          </svg>

          {/* AF7 (Left Forehead) Sensor */}
          <div
            style={{
              position: 'absolute',
              top: '42px',
              left: '34%',
              transform: 'translateX(-50%)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
            }}
          >
            <div
              style={{
                width: '18px',
                height: '18px',
                borderRadius: '50%',
                backgroundColor: getStatusColor(quality.af7),
                boxShadow: `0 0 8px ${getStatusColor(quality.af7)}`,
                border: '2px solid #FFFFFF',
              }}
            />
            <span style={{ fontSize: '10px', fontWeight: 700, marginTop: '2px', color: 'var(--text-secondary)' }}>AF7</span>
          </div>

          {/* AF8 (Right Forehead) Sensor */}
          <div
            style={{
              position: 'absolute',
              top: '42px',
              right: '34%',
              transform: 'translateX(50%)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
            }}
          >
            <div
              style={{
                width: '18px',
                height: '18px',
                borderRadius: '50%',
                backgroundColor: getStatusColor(quality.af8),
                boxShadow: `0 0 8px ${getStatusColor(quality.af8)}`,
                border: '2px solid #FFFFFF',
              }}
            />
            <span style={{ fontSize: '10px', fontWeight: 700, marginTop: '2px', color: 'var(--text-secondary)' }}>AF8</span>
          </div>

          {/* TP9 (Left Ear / Temporal) Sensor */}
          <div
            style={{
              position: 'absolute',
              top: '90px',
              left: '7%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
            }}
          >
            <div
              style={{
                width: '18px',
                height: '18px',
                borderRadius: '50%',
                backgroundColor: getStatusColor(quality.tp9),
                boxShadow: `0 0 8px ${getStatusColor(quality.tp9)}`,
                border: '2px solid #FFFFFF',
              }}
            />
            <span style={{ fontSize: '10px', fontWeight: 700, marginTop: '2px', color: 'var(--text-secondary)' }}>TP9</span>
          </div>

          {/* TP10 (Right Ear / Temporal) Sensor */}
          <div
            style={{
              position: 'absolute',
              top: '90px',
              right: '7%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
            }}
          >
            <div
              style={{
                width: '18px',
                height: '18px',
                borderRadius: '50%',
                backgroundColor: getStatusColor(quality.tp10),
                boxShadow: `0 0 8px ${getStatusColor(quality.tp10)}`,
                border: '2px solid #FFFFFF',
              }}
            />
            <span style={{ fontSize: '10px', fontWeight: 700, marginTop: '2px', color: 'var(--text-secondary)' }}>TP10</span>
          </div>
        </div>

        {/* 4-Channel Breakdown Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
          {/* TP9 */}
          <div
            style={{
              padding: '10px 12px',
              borderRadius: 'var(--radius-md)',
              border: `1px solid ${getStatusColor(quality.tp9)}40`,
              backgroundColor: `${getStatusColor(quality.tp9)}10`,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong style={{ fontSize: '12px' }}>TP9 (Left Ear)</strong>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: getStatusColor(quality.tp9) }} />
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '3px' }}>
              {getStatusLabel(quality.tp9)}
            </div>
            {quality.tp9 !== 'good' && (
              <div style={{ fontSize: '10px', color: '#B45309', marginTop: '4px', lineHeight: 1.2 }}>
                Tip: Tuck hair away from skin behind left ear.
              </div>
            )}
          </div>

          {/* TP10 */}
          <div
            style={{
              padding: '10px 12px',
              borderRadius: 'var(--radius-md)',
              border: `1px solid ${getStatusColor(quality.tp10)}40`,
              backgroundColor: `${getStatusColor(quality.tp10)}10`,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong style={{ fontSize: '12px' }}>TP10 (Right Ear)</strong>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: getStatusColor(quality.tp10) }} />
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '3px' }}>
              {getStatusLabel(quality.tp10)}
            </div>
            {quality.tp10 !== 'good' && (
              <div style={{ fontSize: '10px', color: '#B45309', marginTop: '4px', lineHeight: 1.2 }}>
                Tip: Tuck hair away from skin behind right ear.
              </div>
            )}
          </div>

          {/* AF7 */}
          <div
            style={{
              padding: '10px 12px',
              borderRadius: 'var(--radius-md)',
              border: `1px solid ${getStatusColor(quality.af7)}40`,
              backgroundColor: `${getStatusColor(quality.af7)}10`,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong style={{ fontSize: '12px' }}>AF7 (Left Forehead)</strong>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: getStatusColor(quality.af7) }} />
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '3px' }}>
              {getStatusLabel(quality.af7)}
            </div>
          </div>

          {/* AF8 */}
          <div
            style={{
              padding: '10px 12px',
              borderRadius: 'var(--radius-md)',
              border: `1px solid ${getStatusColor(quality.af8)}40`,
              backgroundColor: `${getStatusColor(quality.af8)}10`,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong style={{ fontSize: '12px' }}>AF8 (Right Forehead)</strong>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: getStatusColor(quality.af8) }} />
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '3px' }}>
              {getStatusLabel(quality.af8)}
            </div>
          </div>
        </div>

        {/* Hair Interference Notice */}
        <div
          style={{
            padding: '10px 12px',
            backgroundColor: '#FEF3C7',
            border: '1px solid #FCD34D',
            borderRadius: 'var(--radius-md)',
            fontSize: '11px',
            color: '#92400E',
            lineHeight: 1.4,
          }}
        >
          <strong>Clinical Tip:</strong> Hair trapped under the rubber ear sensors (TP9/TP10) acts as an electrical insulator and causes railed noise. Pull all hair back and ensure direct skin contact.
        </div>

        {/* Footer Actions */}
        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            onClick={onConfirmReady}
            disabled={!eegEngine.isHardwareConnected && !eegEngine.isDemoMode}
            className="btn btn-primary"
            style={{ flex: 2, padding: '14px', fontSize: '14px' }}
          >
            {isReady ? 'Signal Verified — Begin Training' : 'Proceed with Current Fit'}
            <ArrowRight size={16} />
          </button>
          <button
            onClick={onClose}
            className="btn btn-secondary"
            style={{ flex: 1, padding: '14px', fontSize: '14px' }}
          >
            Back
          </button>
        </div>
      </div>
    </div>
  );
};
