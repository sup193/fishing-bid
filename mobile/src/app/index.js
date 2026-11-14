import { Redirect, router } from 'expo-router';
import { Button, Loading, Notice, Page } from '../components/common';
import { roleHome, useAuth } from '../auth/AuthContext';

export default function IndexRoute() {
  const { user, checking, error, retrySession } = useAuth();

  if (checking) return <Page title="Welcome back"><Loading label="Checking your secure sign-in…" /></Page>;
  if (error) {
    return (
      <Page title="Session check failed" subtitle="We couldn't verify the saved sign-in on this device.">
        <Notice>{error}</Notice>
        <Button label="Try again" onPress={retrySession} />
        <Button label="Go to login" variant="secondary" onPress={() => router.replace('/login')} />
      </Page>
    );
  }
  return <Redirect href={user ? roleHome(user.role) : '/login'} />;
}
