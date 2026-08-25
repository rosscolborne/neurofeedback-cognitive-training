import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, UserRole } from '../../contexts/AuthContext';
import { BrandLogo } from '../../components/brand/BrandLogo';
import { Stethoscope } from 'lucide-react';

export const RoleSelection: React.FC = () => {
  const { user, selectRole } = useAuth();
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSelectRole = async (selectedRole: UserRole) => {
    setLoading(true);
    try {
      await selectRole(selectedRole);
      if (selectedRole === 'patient') {
        navigate('/hardware-setup');
      } else {
        navigate('/');
      }
    } catch (err) {
      console.error(err);
      navigate('/');
    } finally {
      setLoading(false);
    }
  };

  if (!user) return null;

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--surface-patient-base)',
      color: 'var(--text-primary)',
      padding: '60px 20px',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center'
    }}>
      <h1 style={{ fontSize: '28px', fontWeight: 'bold', marginBottom: '8px', textAlign: 'center' }}>How will you use Brainswell?</h1>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '40px', textAlign: 'center' }}>
        Select your account type to customize your experience.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', width: '100%', maxWidth: '340px' }}>
        <button 
          onClick={() => handleSelectRole('patient')}
          disabled={loading}
          style={{
            background: 'var(--surface-patient-card)',
            border: `2px solid var(--border-subtle)`,
            padding: '24px',
            borderRadius: 'var(--radius-lg)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: '12px',
            cursor: loading ? 'not-allowed' : 'pointer',
            textAlign: 'left'
          }}
        >
          <BrandLogo size={36} variant="terracotta" />
          <div>
            <h3 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '4px', color: 'var(--text-primary)' }}>Train my brain</h3>
            <p style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>I want to use the headband to improve my focus and relaxation.</p>
          </div>
        </button>

        <button 
          onClick={() => handleSelectRole('clinician')}
          disabled={loading}
          style={{
            background: 'var(--surface-patient-card)',
            border: `2px solid var(--border-subtle)`,
            padding: '24px',
            borderRadius: 'var(--radius-lg)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: '12px',
            cursor: loading ? 'not-allowed' : 'pointer',
            textAlign: 'left'
          }}
        >
          <Stethoscope size={32} color="var(--brand-primary)" />
          <div>
            <h3 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '4px', color: 'var(--text-primary)' }}>I am a practitioner</h3>
            <p style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>I want to monitor my patients and assign training protocols.</p>
          </div>
        </button>
      </div>
    </div>
  );
};
