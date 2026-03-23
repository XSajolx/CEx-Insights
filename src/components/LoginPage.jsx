import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

const LoginPage = () => {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const { signInWithGoogle } = useAuth();

  const handleGoogleSignIn = async () => {
    setError('');
    setLoading(true);

    try {
      const { error } = await signInWithGoogle();
      if (error) throw error;
    } catch (err) {
      setError(err.message || 'An error occurred during sign in');
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      {/* Animated Background */}
      <div style={styles.backgroundGrid}></div>
      <div style={styles.gradientOrb1}></div>
      <div style={styles.gradientOrb2}></div>

      {/* Login Card */}
      <div style={styles.card}>
        {/* Logo & Branding */}
        <div style={styles.logoSection}>
          <div style={styles.logoIcon}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="url(#logoGradient)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <defs>
                <linearGradient id="logoGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#58A6FF" />
                  <stop offset="100%" stopColor="#A371F7" />
                </linearGradient>
              </defs>
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
              <circle cx="12" cy="12" r="3" stroke="#58A6FF" strokeWidth="1.5" fill="none"/>
            </svg>
          </div>
          <h1 style={styles.title}>CEx Insights</h1>
          <p style={styles.subtitle}>Customer Experience Analytics Platform</p>
        </div>

        {/* Sign In Section */}
        <div style={styles.form}>
          <h2 style={styles.formTitle}>Welcome</h2>
          <p style={styles.formSubtitle}>Sign in with your company Google account</p>

          {error && <div style={styles.errorAlert}>{error}</div>}

          <button
            onClick={handleGoogleSignIn}
            style={styles.googleButton}
            disabled={loading}
            className="google-button"
          >
            {loading ? (
              <span style={styles.loadingSpinner}></span>
            ) : (
              <>
                <svg width="20" height="20" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                <span>Continue with Google</span>
              </>
            )}
          </button>

          <p style={styles.domainNote}>
            Only @nextventures.io accounts are allowed
          </p>
        </div>

        {/* Footer */}
        <div style={styles.footer}>
          <p style={styles.footerText}>
            Powered by <span style={styles.footerBrand}>Supabase</span>
          </p>
        </div>
      </div>

      {/* Styles for animations */}
      <style>{`
        @keyframes float {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          50% { transform: translateY(-20px) rotate(5deg); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 0.4; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(1.05); }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .google-button:hover:not(:disabled) {
          background: rgba(48, 54, 61, 0.8) !important;
          border-color: rgba(88, 166, 255, 0.5) !important;
          transform: translateY(-1px);
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3) !important;
        }
        .google-button:active:not(:disabled) {
          transform: translateY(0);
        }
      `}</style>
    </div>
  );
};

const styles = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#0D1117',
    position: 'relative',
    overflow: 'hidden',
    padding: '2rem',
  },
  backgroundGrid: {
    position: 'absolute',
    inset: 0,
    backgroundImage: `
      linear-gradient(rgba(88, 166, 255, 0.03) 1px, transparent 1px),
      linear-gradient(90deg, rgba(88, 166, 255, 0.03) 1px, transparent 1px)
    `,
    backgroundSize: '50px 50px',
    pointerEvents: 'none',
  },
  gradientOrb1: {
    position: 'absolute',
    top: '-20%',
    left: '-10%',
    width: '500px',
    height: '500px',
    background: 'radial-gradient(circle, rgba(88, 166, 255, 0.15) 0%, transparent 70%)',
    borderRadius: '50%',
    animation: 'pulse 8s ease-in-out infinite',
    pointerEvents: 'none',
  },
  gradientOrb2: {
    position: 'absolute',
    bottom: '-20%',
    right: '-10%',
    width: '600px',
    height: '600px',
    background: 'radial-gradient(circle, rgba(163, 113, 247, 0.12) 0%, transparent 70%)',
    borderRadius: '50%',
    animation: 'pulse 10s ease-in-out infinite reverse',
    pointerEvents: 'none',
  },
  card: {
    position: 'relative',
    width: '100%',
    maxWidth: '420px',
    background: 'rgba(22, 27, 34, 0.85)',
    backdropFilter: 'blur(20px)',
    borderRadius: '20px',
    border: '1px solid rgba(48, 54, 61, 0.8)',
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05) inset',
    overflow: 'hidden',
  },
  logoSection: {
    textAlign: 'center',
    padding: '2.5rem 2rem 1.5rem',
    borderBottom: '1px solid rgba(48, 54, 61, 0.5)',
    background: 'linear-gradient(180deg, rgba(88, 166, 255, 0.03) 0%, transparent 100%)',
  },
  logoIcon: {
    width: '72px',
    height: '72px',
    margin: '0 auto 1rem',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(88, 166, 255, 0.08)',
    borderRadius: '18px',
    border: '1px solid rgba(88, 166, 255, 0.2)',
    animation: 'float 6s ease-in-out infinite',
  },
  title: {
    fontSize: '1.75rem',
    fontWeight: '700',
    background: 'linear-gradient(135deg, #F0F6FC 0%, #8B949E 100%)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    backgroundClip: 'text',
    margin: '0 0 0.5rem',
    letterSpacing: '-0.02em',
  },
  subtitle: {
    fontSize: '0.875rem',
    color: '#8B949E',
    margin: 0,
    fontWeight: '400',
  },
  form: {
    padding: '2rem',
  },
  formTitle: {
    fontSize: '1.25rem',
    fontWeight: '600',
    color: '#F0F6FC',
    margin: '0 0 0.25rem',
    textAlign: 'center',
  },
  formSubtitle: {
    fontSize: '0.875rem',
    color: '#8B949E',
    margin: '0 0 1.5rem',
    textAlign: 'center',
  },
  googleButton: {
    width: '100%',
    padding: '0.875rem 1.25rem',
    fontSize: '0.9375rem',
    fontWeight: '500',
    color: '#F0F6FC',
    background: 'rgba(33, 38, 45, 0.8)',
    border: '1px solid rgba(48, 54, 61, 0.8)',
    borderRadius: '10px',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.75rem',
  },
  domainNote: {
    fontSize: '0.75rem',
    color: '#6E7681',
    textAlign: 'center',
    marginTop: '1rem',
    marginBottom: 0,
  },
  loadingSpinner: {
    width: '20px',
    height: '20px',
    border: '2px solid rgba(255, 255, 255, 0.3)',
    borderTopColor: '#FFFFFF',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
    display: 'inline-block',
  },
  errorAlert: {
    padding: '0.875rem 1rem',
    marginBottom: '1.25rem',
    background: 'rgba(255, 123, 114, 0.1)',
    border: '1px solid rgba(255, 123, 114, 0.3)',
    borderRadius: '10px',
    color: '#FF7B72',
    fontSize: '0.875rem',
    textAlign: 'center',
  },
  footer: {
    padding: '1.25rem 2rem',
    borderTop: '1px solid rgba(48, 54, 61, 0.5)',
    textAlign: 'center',
  },
  footerText: {
    fontSize: '0.75rem',
    color: '#6E7681',
    margin: 0,
  },
  footerBrand: {
    color: '#58A6FF',
    fontWeight: '500',
  },
};

export default LoginPage;
