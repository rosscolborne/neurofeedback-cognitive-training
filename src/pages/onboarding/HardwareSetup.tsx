import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bluetooth, CheckCircle2 } from 'lucide-react';
import { eegEngine } from '../../services/eegEngine';

export const HardwareSetup: React.FC = () => {
  const navigate = useNavigate();
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');

  const handleConnect = async () => {
    setConnecting(true);
    setError('');
    try {
      const res = await eegEngine.connectMuseAthenaBrainflow();
      if (res.success) {
        setConnected(true);
        setTimeout(() => {
          navigate('/');
        }, 1500);
      } else {
        setError('Connection failed. Make sure your headband is powered on.');
      }
    } catch (err: any) {
      setError(err.message || 'Connection failed.');
    } finally {
      setConnecting(false);
    }
  };

  // Auto-trigger BLE pairing on mount so users don't have to tap manually
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!connected && !connecting) {
        handleConnect();
      }
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--surface-patient-base)',
      color: 'var(--text-primary)',
      padding: 'calc(60px + env(safe-area-inset-top, 0px)) 20px calc(20px + env(safe-area-inset-bottom, 0px))',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center'
    }}>
      <div style={{
        background: 'var(--surface-patient-card)',
        padding: '24px',
        borderRadius: '50%',
        marginBottom: '24px',
        border: `1px solid var(--border-subtle)`,
      }}>
        {connected ? <CheckCircle2 size={48} color="#10B981" /> : <Bluetooth size={48} color="var(--brand-primary)" />}
      </div>

      <h1 style={{ fontSize: '28px', fontWeight: 'bold', marginBottom: '16px', textAlign: 'center' }}>
        {connected ? 'Headband Connected!' : 'Pair your Headband'}
      </h1>
      
      <p style={{ color: 'var(--text-secondary)', marginBottom: '40px', textAlign: 'center', maxWidth: '300px' }}>
        {connected 
          ? 'You are all set to start your first session.'
          : 'Turn on your Muse Athena headset. BrainFlow will connect to it from the local acquisition service.'}
      </p>

      {error && (
        <div style={{ background: '#FF4C4C20', color: '#FF4C4C', padding: '12px', borderRadius: '8px', marginBottom: '24px', maxWidth: '300px', textAlign: 'center' }}>
          {error}
        </div>
      )}

      {!connected && (
        <div style={{ width: '100%', maxWidth: '320px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <button 
            onClick={handleConnect}
            disabled={connecting}
            style={{
              background: 'var(--brand-primary)',
              color: 'var(--brand-on-primary)',
              border: 'none',
              padding: '16px',
              borderRadius: 'var(--radius-md)',
              fontSize: '18px',
              fontWeight: '600',
              cursor: connecting ? 'not-allowed' : 'pointer',
              opacity: connecting ? 0.7 : 1
            }}
          >
            {connecting ? 'Searching...' : 'Connect Now'}
          </button>
          <button 
            onClick={() => navigate('/')}
            style={{
              background: 'transparent',
              color: 'var(--text-secondary)',
              border: 'none',
              padding: '16px',
              fontSize: '16px',
              cursor: 'pointer',
            }}
          >
            Skip for now
          </button>
        </div>
      )}
    </div>
  );
};
