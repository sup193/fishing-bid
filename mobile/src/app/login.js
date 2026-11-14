import { useState } from 'react';
import { Redirect } from 'expo-router';
import { KeyboardAvoidingView, Platform, Text, View, StyleSheet } from 'react-native';
import { Button, Card, Field, Loading, Notice, Page, colors } from '../components/common';
import { roleHome, useAuth } from '../auth/AuthContext';

export default function LoginRoute() {
  const { user, checking, signIn, error: sessionError, retrySession } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (user) return <Redirect href={roleHome(user.role)} />;
  if (checking) return <Page title="Welcome back"><Loading label="Checking your secure sign-in…" /></Page>;

  async function submit() {
    setFormError('');
    if (!email.trim() || !password) {
      setFormError('Enter your email address and password.');
      return;
    }

    setSubmitting(true);
    try {
      await signIn({ email: email.trim(), password });
      setPassword('');
    } catch (loginError) {
      setFormError(loginError.message);
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
          <Field label="Email address" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" autoCapitalize="none" />
          <Field label="Password" value={password} onChangeText={setPassword} placeholder="Enter your password" secureTextEntry autoCapitalize="none" />
          {formError ? <Notice>{formError}</Notice> : null}
          <Button label="Log in" onPress={submit} loading={submitting} />
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
