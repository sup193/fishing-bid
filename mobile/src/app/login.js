import { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import { KeyboardAvoidingView, Platform, Text, View, StyleSheet } from 'react-native';
import { Button, Card, Field, Loading, Notice, Page, colors } from '../components/common';
import { roleHome, useAuth } from '../auth/AuthContext';
import { mobileApi } from '../../api';

export default function LoginRoute() {
  const { user, checking, signIn, completeSignIn, error: sessionError, retrySession } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState('buyer');
  const [mode, setMode] = useState('login');
  const [pending, setPending] = useState(null);
  const [otp, setOtp] = useState('');
  const [seconds, setSeconds] = useState(0);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!seconds) return undefined;
    const timer = setInterval(() => setSeconds(value => Math.max(0, value - 1)), 1000);
    return () => clearInterval(timer);
  }, [seconds]);

  if (user) return <Redirect href={roleHome(user.role)} />;
  if (checking) return <Page title="Welcome back"><Loading label="Checking your secure sign-in…" /></Page>;

  async function submit() {
    setFormError('');
    if (!email.trim() || !password || (mode === 'register' && !name.trim())) {
      setFormError('Enter your email address and password.');
      return;
    }

    setSubmitting(true);
    try {
      if (mode === 'login') {
        await signIn({ email: email.trim(), password });
        setPassword('');
      } else {
        const result = await mobileApi.register({ name: name.trim(), email: email.trim(), password, phone, role });
        if (result.status === 'pending') {
          setPending(result);
          setSeconds(60);
        } else {
          await completeSignIn(result);
        }
      }
    } catch (loginError) {
      setFormError(loginError.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function verifyOtp() {
    if (!/^\d{6}$/.test(otp)) {
      setFormError('Enter the 6-digit verification code.');
      return;
    }
    setSubmitting(true);
    setFormError('');
    try {
      const result = await mobileApi.verifyOtp({ email: pending.email, otp });
      if (result.status === 'pending') {
        setPending(null);
        setOtp('');
        setMode('login');
        setFormError(result.message);
      } else {
        await completeSignIn(result);
      }
    } catch (verifyError) {
      setFormError(verifyError.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function resendOtp() {
    setSubmitting(true);
    setFormError('');
    try {
      await mobileApi.resendOtp({ email: pending.email });
      setSeconds(60);
      setOtp('');
    } catch (resendError) {
      setFormError(resendError.message);
    } finally {
      setSubmitting(false);
    }
  }


  return (
    <Page title="Welcome to the water." subtitle="Sign in to explore fresh catches and manage your TideMarket account.">
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Card>
          <Text style={styles.eyebrow}>YOUR COASTAL MARKETPLACE</Text>
          {sessionError ? (
            <View style={styles.sessionNotice}>
              <Notice>{sessionError}</Notice>
              <Button label="Retry session check" variant="secondary" onPress={retrySession} compact />
            </View>
          ) : null}
          {pending ? <>
            <Text style={styles.eyebrow}>EMAIL VERIFICATION</Text>
            <Text>Code sent to {pending.email}</Text>
            <Field label="6-digit OTP" value={otp} onChangeText={value => setOtp(value.replace(/\D/g, '').slice(0, 6))} placeholder="123456" keyboardType="number-pad" />
            {seconds <= 0
              ? <Button label="Resend OTP" variant="secondary" onPress={resendOtp} loading={submitting} />
              : <Text>Resend available in {seconds}s</Text>}
            {formError ? <Notice>{formError}</Notice> : null}
            <Button label="Verify email" onPress={verifyOtp} loading={submitting} />
          </> : <>
            {mode === 'register' ? <>
              <Field label="Full name" value={name} onChangeText={setName} placeholder="Full name" />
              <Field label="Mobile number" value={phone} onChangeText={setPhone} placeholder="Mobile number" keyboardType="phone-pad" />
            </> : null}
            <Field label="Email address" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" autoCapitalize="none" />
            <Field label="Password" value={password} onChangeText={setPassword} placeholder="Enter your password" secureTextEntry autoCapitalize="none" />
            {mode === 'register' ? <Field label="Role (buyer or fisherman)" value={role} onChangeText={value => setRole(['buyer', 'fisherman'].includes(value.trim().toLowerCase()) ? value.trim().toLowerCase() : value)} placeholder="buyer" /> : null}
            {formError ? <Notice>{formError}</Notice> : null}
            <Button label={mode === 'login' ? 'Log in' : 'Create account'} onPress={submit} loading={submitting} />
            <Button label={mode === 'login' ? 'Sign up' : 'Back to login'} variant="secondary" onPress={() => { setPending(null); setOtp(''); setSeconds(0); setMode(mode === 'login' ? 'register' : 'login'); setFormError(''); }} />
          </>}
        </Card>
      </KeyboardAvoidingView>
      <Text style={styles.footer}>Fresh from the coast. Fair for everyone.</Text>
    </Page>
  );
}

const styles = StyleSheet.create({
  eyebrow: { color: colors.sea, fontSize: 10, fontWeight: '800', letterSpacing: 1.4 },
  sessionNotice: { gap: 8 },
  footer: { alignSelf: 'center', color: colors.muted, fontSize: 11, marginTop: 6 }
});
