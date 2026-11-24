import { Redirect, Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Loading, colors } from './common';
import { roleHome, useAuth } from '../auth/AuthContext';

export default function RoleTabs({ role, routes }) {
  const { user, checking } = useAuth();
  const insets = useSafeAreaInsets();
  const bottomInset = Math.max(insets.bottom, 8);

  if (checking) return <Loading label="Loading your workspace…" />;
  if (!user) return <Redirect href="/login" />;
  if (user.role !== role) return <Redirect href={roleHome(user.role)} />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.teal,
        tabBarInactiveTintColor: colors.secondary,
        tabBarLabelStyle: styles.tabLabel,
        tabBarItemStyle: styles.tabItem,
        tabBarStyle: [
          styles.tabBar,
          { height: 62 + bottomInset, paddingBottom: bottomInset }
        ]
      }}
    >
      {routes.map(route => (
        <Tabs.Screen
          key={route.name}
          name={route.name}
          options={{
            title: route.title,
            tabBarLabel: route.title,
            tabBarIcon: ({ color, focused }) => (
              <View style={[styles.iconWell, focused && styles.activeIconWell]}>
                <Ionicons name={route.icon} color={color} size={20} />
              </View>
            )
          }}
        />
      ))}
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.white,
    elevation: 12,
    shadowColor: colors.navy,
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.06,
    shadowRadius: 12
  },
  tabItem: { minHeight: 54, paddingTop: 1 },
  tabLabel: { marginTop: 1, fontSize: 10, fontWeight: '700', letterSpacing: 0.1 },
  iconWell: {
    width: 48,
    height: 27,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14
  },
  activeIconWell: { backgroundColor: colors.light }
});
