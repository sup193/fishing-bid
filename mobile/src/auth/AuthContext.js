import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { mobileApi } from '../../api';

const TOKEN_KEY = 'tide_token';
const AuthContext = createContext(null);

function getStoredToken() {
  return Platform.OS === 'web'
    ? Promise.resolve(globalThis.localStorage.getItem(TOKEN_KEY))
    : SecureStore.getItemAsync(TOKEN_KEY);
}

function storeToken(token) {
  if (Platform.OS === 'web') {
    globalThis.localStorage.setItem(TOKEN_KEY, token);
    return Promise.resolve();
  }
  return SecureStore.setItemAsync(TOKEN_KEY, token);
}

function deleteStoredToken() {
  if (Platform.OS === 'web') {
    globalThis.localStorage.removeItem(TOKEN_KEY);
    return Promise.resolve();
  }
  return SecureStore.deleteItemAsync(TOKEN_KEY);
}

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
        const savedToken = await getStoredToken();
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
            await deleteStoredToken();
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
    await storeToken(result.token);
    mobileApi.setToken(result.token);
    setToken(result.token);
    setUser(result.user);
    setError('');
    return result.user;
  }, []);

  const signOut = useCallback(async () => {
    await deleteStoredToken();
    mobileApi.setToken(null);
    setToken(null);
    setUser(null);
  }, []);
  const completeSignIn = useCallback(async result => {
    await storeToken(result.token);
    mobileApi.setToken(result.token);
    setToken(result.token);
    setUser(result.user);
    setError('');
  }, []);
  const updateUser = useCallback(nextUser => {
    setUser(current => current ? { ...current, ...nextUser } : nextUser);
  }, []);

  const value = useMemo(() => ({
    user,
    token,
    checking,
    error,
    signIn,
    completeSignIn,
    signOut,
    updateUser,
    retrySession: () => setRetry(value => value + 1)
  }), [user, token, checking, error, signIn, completeSignIn, signOut, updateUser]);

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
