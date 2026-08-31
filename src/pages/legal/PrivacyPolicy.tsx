import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

export const PrivacyPolicy: React.FC = () => {
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

      <h1 style={{ fontSize: '32px', fontWeight: 'bold', marginBottom: '24px' }}>Privacy Policy</h1>
      
      <div style={{ color: 'var(--text-secondary)', lineHeight: 1.6, display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <p><strong>Last Updated:</strong> August 2026</p>
        
        <h2>1. Information We Collect</h2>
        <p>We collect information you provide directly to us, such as when you create or modify your account, contact customer support, or otherwise communicate with us. This includes neurofeedback data generated during your sessions.</p>
        
        <h2>2. Use of Information</h2>
        <p>We use the information we collect to provide, maintain, and improve our services, such as facilitating your neurofeedback training and allowing your assigned clinician (if applicable) to monitor your progress.</p>
        
        <h2>3. Data Storage and Security</h2>
        <p>Your data is securely stored and encrypted in transit and at rest. If you connect with a clinician, your data is shared securely with them through our platform.</p>
        
        <h2>4. Your Rights</h2>
        <p>You have the right to access, correct, or delete your personal data. You can delete your account entirely from the Settings menu within the app.</p>
        
        <h2>5. Contact Us</h2>
        <p>If you have any questions about this Privacy Policy, please contact us at support@waveable.app.</p>
      </div>
    </div>
  );
};
