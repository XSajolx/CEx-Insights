import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

const LoginPage = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [showForgotPassword, setShowForgotPassword] = useState(false);

  const { signIn, signUp, resetPassword } = useAuth();

  // Only allow @nextventures.io emails to sign up
  const ALLOWED_DOMAIN = '@nextventures.io';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);

    try {
      if (isSignUp) {
        // Validate email domain before allowing sign up
        if (!email.toLowerCase().trim().endsWith(ALLOWED_DOMAIN)) {
          throw new Error('Sign up is restricted to @nextventures.io email addresses only.');
        }

        const { data, error, needsConfirmation } = await signUp(email, password);
        if (error) {
          if (error.message.includes('User already registered')) {
            throw new Error('This email is already registered. Try signing in instead.');
          }
          throw error;
        }
        
        if (needsConfirmation) {
          setMessage('✅ Account created! Check your email for the confirmation link to activate your account.');
        } else if (data?.session) {
          setMessage('Account created successfully! Redirecting...');
        }
      } else {
        const { error } = await signIn(email, password);
        if (error) {
          if (error.message.includes('Invalid login credentials')) {
            throw new Error('Invalid email or password. Please try again.');
          }
          if (error.message.includes('Email not confirmed')) {
            throw new Error('Please confirm your email before signing in. Check your inbox for the confirmation link.');
          }
          throw error;
        }
      }
    } catch (err) {
      setError(err.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);

    try {
      const { error } = await resetPassword(email);
      if (error) throw error;
      setMessage('Password reset email sent! Check your inbox.');
    } catch (err) {
      setError(err.message || 'An error occurred');
    } finally {
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

        {/* Form Section */}
        {showForgotPassword ? (
          <form onSubmit={handleForgotPassword} style={styles.form}>
            <h2 style={styles.formTitle}>Reset Password</h2>
            <p style={styles.formSubtitle}>Enter your email to receive a reset link</p>

            {error && <div style={styles.errorAlert}>{error}</div>}
            {message && <div style={styles.successAlert}>{message}</div>}

            <div style={styles.inputGroup}>
              <label style={styles.label}>Email Address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                style={styles.input}
                required
              />
            </div>

            <button type="submit" style={styles.submitButton} disabled={loading}>
              {loading ? (
                <span style={styles.loadingSpinner}></span>
              ) : (
                'Send Reset Link'
              )}
            </button>

            <button
              type="button"
              onClick={() => setShowForgotPassword(false)}
              style={styles.backButton}
            >
              ← Back to Login
            </button>
          </form>
        ) : (
          <form onSubmit={handleSubmit} style={styles.form}>
            <h2 style={styles.formTitle}>{isSignUp ? 'Create Account' : 'Welcome Back'}</h2>
            <p style={styles.formSubtitle}>
              {isSignUp ? 'Sign up to get started' : 'Sign in to your account'}
            </p>

            {error && <div style={styles.errorAlert}>{error}</div>}
            {message && <div style={styles.successAlert}>{message}</div>}

            <div style={styles.inputGroup}>
              <label style={styles.label}>Email Address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                style={styles.input}
                required
              />
            </div>

            <div style={styles.inputGroup}>
              <label style={styles.label}>Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                style={styles.input}
                required
                minLength={6}
              />
            </div>

            {!isSignUp && (
              <button
                type="button"
                onClick={() => setShowForgotPassword(true)}
                style={styles.forgotLink}
              >
                Forgot password?
              </button>
            )}

            <button type="submit" style={styles.submitButton} disabled={loading}>
              {loading ? (
                <span style={styles.loadingSpinner}></span>
              ) : isSignUp ? (
                'Create Account'
              ) : (
                'Sign In'
              )}
            </button>

            <div style={styles.divider}>
              <span style={styles.dividerLine}></span>
              <span style={styles.dividerText}>or</span>
              <span style={styles.dividerLine}></span>
            </div>

            <button
              type="button"
              onClick={() => {
                setIsSignUp(!isSignUp);
                setError('');
                setMessage('');
              }}
              style={styles.switchButton}
            >
              {isSignUp ? 'Already have an account? Sign In' : "Don't have an account? Sign Up"}
            </button>
          </form>
        )}

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
        .login-input:focus {
          border-color: #58A6FF !important;
          box-shadow: 0 0 0 3px rgba(88, 166, 255, 0.15) !important;
          outline: none;
        }
        .login-button:hover:not(:disabled) {
          background: linear-gradient(135deg, #79C0FF 0%, #B794F6 100%) !important;
          transform: translateY(-1px);
          box-shadow: 0 8px 24px rgba(88, 166, 255, 0.3) !important;
        }
        .login-button:active:not(:disabled) {
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
  inputGroup: {
    marginBottom: '1.25rem',
  },
  label: {
    display: 'block',
    fontSize: '0.8125rem',
    fontWeight: '500',
    color: '#8B949E',
    marginBottom: '0.5rem',
    letterSpacing: '0.02em',
  },
  input: {
    width: '100%',
    padding: '0.875rem 1rem',
    fontSize: '0.9375rem',
    color: '#F0F6FC',
    background: 'rgba(33, 38, 45, 0.8)',
    border: '1px solid rgba(48, 54, 61, 0.8)',
    borderRadius: '10px',
    outline: 'none',
    transition: 'all 0.2s ease',
    boxSizing: 'border-box',
  },
  forgotLink: {
    background: 'none',
    border: 'none',
    color: '#58A6FF',
    fontSize: '0.8125rem',
    cursor: 'pointer',
    padding: 0,
    marginBottom: '1.25rem',
    display: 'block',
    textAlign: 'right',
    width: '100%',
    transition: 'color 0.2s ease',
  },
  submitButton: {
    width: '100%',
    padding: '0.875rem',
    fontSize: '0.9375rem',
    fontWeight: '600',
    color: '#FFFFFF',
    background: 'linear-gradient(135deg, #58A6FF 0%, #A371F7 100%)',
    border: 'none',
    borderRadius: '10px',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.5rem',
    boxShadow: '0 4px 12px rgba(88, 166, 255, 0.2)',
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
  divider: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
    margin: '1.5rem 0',
  },
  dividerLine: {
    flex: 1,
    height: '1px',
    background: 'rgba(48, 54, 61, 0.8)',
  },
  dividerText: {
    fontSize: '0.75rem',
    color: '#6E7681',
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
  },
  switchButton: {
    width: '100%',
    padding: '0.75rem',
    fontSize: '0.875rem',
    fontWeight: '500',
    color: '#8B949E',
    background: 'rgba(48, 54, 61, 0.3)',
    border: '1px solid rgba(48, 54, 61, 0.5)',
    borderRadius: '10px',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
  backButton: {
    width: '100%',
    padding: '0.75rem',
    fontSize: '0.875rem',
    fontWeight: '500',
    color: '#58A6FF',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    marginTop: '1rem',
    transition: 'color 0.2s ease',
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
  successAlert: {
    padding: '0.875rem 1rem',
    marginBottom: '1.25rem',
    background: 'rgba(63, 185, 80, 0.1)',
    border: '1px solid rgba(63, 185, 80, 0.3)',
    borderRadius: '10px',
    color: '#3FB950',
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
