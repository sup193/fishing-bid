import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { mobileApi } from '../../api';

const TOKEN_KEY = 'tide_token';
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;

    async function restoreSession() {
      setChecking(true);
      setError('');
      try {
        const savedToken = await SecureStore.getItemAsync(TOKEN_KEY);
        if (!active || !savedToken) return;
        const result = await mobileApi.me(savedToken);
        if (active) {
          mobileApi.setToken(savedToken);
          setToken(savedToken);
          setUser(result.user);
        }
      } catch (restoreError) {
        if (!active) return;
        if (restoreError.status === 401) {
          try {
            await SecureStore.deleteItemAsync(TOKEN_KEY);
            mobileApi.setToken(null);
          } catch (storageError) {
            setError(storageError.message);
          }
        } else {
          setError(restoreError.message);
        }
      } finally {
        if (active) setChecking(false);
      }
    }

    restoreSession();
    return () => { active = false; };
  }, [retry]);

  const signIn = useCallback(async credentials => {
    const result = await mobileApi.login(credentials);
    await SecureStore.setItemAsync(TOKEN_KEY, result.token);
    mobileApi.setToken(result.token);
    setToken(result.token);
    setUser(result.user);
    setError('');
    return result.user;
  }, []);

  const signOut = useCallback(async () => {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    mobileApi.setToken(null);
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo(() => ({
    user,
    token,
    checking,
    error,
    signIn,
    signOut,
    retrySession: () => setRetry(value => value + 1)
  }), [user, token, checking, error, signIn, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}

export function roleHome(role) {
  if (role === 'buyer' || role === 'fisherman' || role === 'admin') return `/${role}`;
  return '/login';
}
