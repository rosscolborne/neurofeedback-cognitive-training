import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

export const TermsOfService: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--surface-patient-base)',
      color: 'var(--text-primary)',
      padding: '40px 20px',
      maxWidth: '800px',
      margin: '0 auto'
    }}>
      <button 
        onClick={() => navigate(-1)}
        style={{
          background: 'none', border: 'none', color: 'var(--text-primary)',
          display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer',
          padding: 0, marginBottom: '40px'
        }}
      >
        <ArrowLeft size={24} /> Back
      </button>

      <h1 style={{ fontSize: '32px', fontWeight: 'bold', marginBottom: '24px' }}>Terms of Service</h1>
      
      <div style={{ color: 'var(--text-secondary)', lineHeight: 1.6, display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <p><strong>Last Updated:</strong> August 2026</p>
        
        <h2>1. Acceptance of Terms</h2>
        <p>By accessing or using the Brainwell application, you agree to be bound by these Terms. If you disagree with any part of the terms, you may not access the service.</p>
        
        <h2>2. Medical Disclaimer</h2>
        <p>Brainwell is designed for wellness and focus enhancement. It is not intended to diagnose, treat, cure, or prevent any medical condition. Always seek the advice of your physician or other qualified health provider with any questions you may have regarding a medical condition.</p>
        
        <h2>3. Hardware Usage</h2>
        <p>You must use compatible hardware (e.g., a Muse headband) to use the core features of this app. We are not responsible for hardware malfunctions.</p>
        
        <h2>4. Subscriptions</h2>
        <p>Some features, such as clinical oversight, may require a paid subscription. Subscriptions automatically renew unless canceled at least 24 hours before the end of the current period.</p>
        
        <h2>5. Termination</h2>
        <p>We may terminate or suspend access to our service immediately, without prior notice or liability, for any reason whatsoever, including without limitation if you breach the Terms.</p>
      </div>
    </div>
  );
};
