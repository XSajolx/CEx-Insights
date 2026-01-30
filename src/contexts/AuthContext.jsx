import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../services/supabaseClient';

const AuthContext = createContext({});

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Get initial session
    const getInitialSession = async () => {
      try {
        const { data: { session: currentSession } } = await supabase.auth.getSession();
        setSession(currentSession);
        setUser(currentSession?.user ?? null);
      } catch (error) {
        console.error('Error getting session:', error);
      } finally {
        setLoading(false);
      }
    };

    getInitialSession();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, currentSession) => {
        setSession(currentSession);
        setUser(currentSession?.user ?? null);
        setLoading(false);
      }
    );

    return () => {
      subscription?.unsubscribe();
    };
  }, []);

  const signIn = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { data, error };
  };

  // Use production URL for email redirects
  const PRODUCTION_URL = 'https://ce-x-insights-main-1.vercel.app';
  
  const getRedirectUrl = () => {
    // Check if we're on localhost - use production URL for email verification
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      return PRODUCTION_URL;
    }
    return window.location.origin;
  };

  const signUp = async (email, password) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${getRedirectUrl()}/`,
      }
    });
    
    // Check if user already exists
    // Supabase returns a user with empty identities array if email already exists
    if (data?.user && data.user.identities && data.user.identities.length === 0) {
      return {
        data: null,
        error: { message: 'This email is already registered. Please sign in instead.' },
        needsConfirmation: false,
        alreadyExists: true
      };
    }
    
    // Check if user was created but needs email confirmation
    if (data?.user && !data?.session) {
      // User created but email confirmation required
      return { 
        data, 
        error: null, 
        needsConfirmation: true,
        alreadyExists: false
      };
    }
    
    return { data, error, needsConfirmation: false, alreadyExists: false };
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (!error) {
      setUser(null);
      setSession(null);
    }
    return { error };
  };

  const resetPassword = async (email) => {
    const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${getRedirectUrl()}/reset-password`,
    });
    return { data, error };
  };

  const value = {
    user,
    session,
    loading,
    signIn,
    signUp,
    signOut,
    resetPassword,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export default AuthContext;
