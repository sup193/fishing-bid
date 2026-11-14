import { Redirect, Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Loading, colors } from './common';
import { roleHome, useAuth } from '../auth/AuthContext';

export default function RoleTabs({ role, routes }) {
  const { user, checking } = useAuth();

  if (checking) return <Loading label="Loading your workspace…" />;
  if (!user) return <Redirect href="/login" />;
  if (user.role !== role) return <Redirect href={roleHome(user.role)} />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.sea,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontSize: 10, fontWeight: '700' },
        tabBarStyle: { height: 62, paddingTop: 5, paddingBottom: 5, borderTopColor: colors.line, backgroundColor: colors.white }
      }}
    >
      {routes.map(route => (
        <Tabs.Screen
          key={route.name}
          name={route.name}
          options={{
            title: route.title,
            tabBarLabel: route.title,
            tabBarIcon: ({ color, size }) => <Ionicons name={route.icon} color={color} size={size} />
          }}
        />
      ))}
    </Tabs>
  );
}
