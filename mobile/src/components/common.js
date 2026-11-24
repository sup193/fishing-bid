import { useState } from 'react';
import {
  Alert,
  ActivityIndicator,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../auth/AuthContext';
import { resolveImageUrl } from '../../api';

export const colors = {
  navy: '#102B3F',
  teal: '#087F8C',
  light: '#F3F7F8',
  white: '#FFFFFF',
  amber: '#E8A33A',
  success: '#16865B',
  error: '#D64545',
  text: '#172B3A',
  secondary: '#71808C',
  border: '#DCE5E8',
  ink: '#172B3A',
  sea: '#087F8C',
  coral: '#E8A33A',
  foam: '#F3F7F8',
  muted: '#71808C',
  line: '#DCE5E8',
  danger: '#D64545',
  pale: '#F3F7F8'
};

export function Page({ title, subtitle, children, onRefresh, refreshing = false }) {
  const { user, signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);

  async function logout() {
    setSigningOut(true);
    try {
      await signOut();
    } catch (error) {
      Alert.alert('Could not log out', error.message);
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <StatusBar style="dark" />
      <View style={styles.topBar}>
        <View style={styles.brandMark}><Text style={styles.brandMarkText}>TM</Text></View>
        <View style={styles.brandCopy}>
          <Text style={styles.brandName}>TideMarket</Text>
          <Text style={styles.accountName} numberOfLines={1}>{user?.name || 'Marketplace'}</Text>
        </View>
        <Pressable accessibilityRole="button" disabled={signingOut} onPress={logout} style={({ pressed }) => [styles.logoutButton, pressed && !signingOut && styles.pressed]}>
          {signingOut ? <ActivityIndicator size="small" color={colors.ink} /> : <Text style={styles.logoutText}>Log out</Text>}
        </Pressable>
      </View>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.sea} /> : undefined}
      >
        <View style={styles.pageHeading}>
          <Text style={styles.pageTitle}>{title}</Text>
          {subtitle ? <Text style={styles.pageSubtitle}>{subtitle}</Text> : null}
        </View>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function Card({ children, style }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Button({ label, onPress, variant = 'primary', disabled = false, loading = false, compact = false }) {
  const buttonStyle = variant === 'danger' ? styles.dangerButton : variant === 'secondary' ? styles.secondaryButton : styles.primaryButton;
  const textStyle = variant === 'danger' ? styles.dangerButtonText : variant === 'secondary' ? styles.secondaryButtonText : styles.primaryButtonText;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [styles.button, compact && styles.compactButton, buttonStyle, pressed && !(disabled || loading) && styles.pressed, (disabled || loading) && styles.disabled]}
    >
      {loading ? <ActivityIndicator color={variant === 'secondary' ? colors.ink : colors.white} size="small" /> : <Text style={textStyle}>{label}</Text>}
    </Pressable>
  );
}

export function Field({ label, value, onChangeText, placeholder, keyboardType = 'default', secureTextEntry = false, multiline = false, autoCapitalize = 'sentences', editable = true }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        autoCapitalize={autoCapitalize}
        editable={editable}
        keyboardType={keyboardType}
        multiline={multiline}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        secureTextEntry={secureTextEntry}
        style={[styles.input, multiline && styles.multilineInput, !editable && styles.disabledInput]}
        value={value}
      />
    </View>
  );
}

export function Chip({ label, selected, onPress }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: Boolean(selected) }}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, selected && styles.selectedChip, pressed && styles.pressed]}
    >
      <Text style={[styles.chipText, selected && styles.selectedChipText]}>{label}</Text>
    </Pressable>
  );
}

export function Notice({ children, type = 'error' }) {
  return <Text accessibilityRole={type === 'error' ? 'alert' : 'text'} style={[styles.notice, type === 'success' ? styles.successNotice : styles.errorNotice]}>{children}</Text>;
}

export function Empty({ children }) {
  return <Card><Text style={styles.emptyText}>{children}</Text></Card>;
}

export function Loading({ label = 'Loading…' }) {
  return <Card style={styles.loadingCard}><ActivityIndicator color={colors.sea} /><Text style={styles.emptyText}>{label}</Text></Card>;
}

export function SectionTitle({ title, detail }) {
  return (
    <View style={styles.sectionTitle}>
      <Text style={styles.sectionText}>{title}</Text>
      {detail ? <Text style={styles.sectionDetail}>{detail}</Text> : null}
    </View>
  );
}

export function Stat({ label, value, note }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
      {note ? <Text style={styles.statNote}>{note}</Text> : null}
    </View>
  );
}

export function ListingCard({ item, actions, detail }) {
  const price = item.saleMode === 'bid'
    ? item.auction?.currentPrice || item.auction?.startPrice || item.expectedPrice
    : item.salePrice || item.expectedPrice;
  return (
    <Card>
      <ListingPhoto item={item} />
      <View style={styles.listingHeading}>
        <Text style={styles.listingName}>{item.fishType || 'Fish catch'}</Text>
        <Text style={styles.badge}>{item.saleMode === 'bid' ? 'AUCTION' : 'FIXED PRICE'}</Text>
      </View>
      <Text style={styles.listingMeta}>{item.quantity || 0} kg · {item.location || 'Port unavailable'} · {item.quality || 'Grade not set'}</Text>
      {item.fisherman?.name ? <Text style={styles.listingMeta}>By {item.fisherman.name}</Text> : null}
      {item.fisherman?.reputation ? <View style={styles.listingTrust}>
        <Text style={styles.listingTrustLevel}>{item.fisherman.reputation.verified ? '✓ ' : ''}{item.fisherman.reputation.level}</Text>
        <Text style={styles.listingMeta}>{item.fisherman.reputation.status === 'rated'
          ? `${item.fisherman.reputation.score}/100 trust · ${item.fisherman.reputation.averageRating?.toFixed(1) || '—'}★ · ${item.fisherman.reputation.completedOrderCount} completed`
          : 'No verified order history yet'}</Text>
      </View> : null}
      <Text style={styles.listingPrice}>₹{Number(price || 0).toLocaleString()}<Text style={styles.listingUnit}> / kg</Text></Text>
      {Number(item.predictedLow) > 0 && Number(item.predictedHigh) >= Number(item.predictedLow)
        ? <Text style={styles.listingMeta}>Indicative price estimate ₹{Number(item.predictedLow).toLocaleString()}–₹{Number(item.predictedHigh).toLocaleString()}/kg · not guaranteed</Text>
        : null}
      {item.saleMode === 'bid' && item.auction ? (
        <Text style={styles.listingMeta}>{item.auction.bidCount || 0} bids · {item.auction.status || 'scheduled'}{item.auction.endTime ? ` · Ends ${new Date(item.auction.endTime).toLocaleString()}` : ''}</Text>
      ) : null}
      {detail ? <Text style={styles.listingDetail}>{detail}</Text> : null}
      {actions ? <View style={styles.actions}>{actions}</View> : null}
    </Card>
  );
}

function ListingPhoto({ item }) {
  const uri = resolveImageUrl(item?.imageUrl);
  const [failedUri, setFailedUri] = useState('');
  const imageError = Boolean(uri && failedUri === uri);

  return uri && !imageError
    ? <Image
      accessibilityLabel={`${item.fishType || 'Catch'} photo`}
      onError={() => setFailedUri(uri)}
      resizeMode="cover"
      source={{ uri }}
      style={styles.listingPhoto}
    />
    : <View accessibilityLabel={item?.imageUrl ? 'Catch photo unavailable' : 'No catch photo provided'} style={styles.listingPhotoPlaceholder}>
      <Text style={styles.photoPlaceholderText}>{item?.imageUrl ? 'Photo unavailable' : 'No catch photo provided'}</Text>
    </View>;
}

export function money(value) {
  return `₹${Number(value || 0).toLocaleString()}`;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.foam },
  topBar: { minHeight: 72, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, borderBottomWidth: 1, borderBottomColor: colors.line, backgroundColor: colors.white },
  brandMark: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: colors.navy },
  brandMarkText: { color: colors.white, fontSize: 11, fontWeight: '800', letterSpacing: 0.7 },
  brandCopy: { flex: 1, marginLeft: 12 },
  brandName: { color: colors.navy, fontSize: 16, fontWeight: '800', letterSpacing: -0.2 },
  accountName: { maxWidth: 190, marginTop: 3, color: colors.muted, fontSize: 11, fontWeight: '500' },
  logoutButton: { minHeight: 44, minWidth: 70, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, borderRadius: 12 },
  logoutText: { color: colors.sea, fontSize: 12, fontWeight: '800' },
  content: { width: '100%', maxWidth: 720, alignSelf: 'center', padding: 20, paddingBottom: 36, gap: 16 },
  pageHeading: { gap: 6, marginTop: 3, marginBottom: 2 },
  pageTitle: { color: colors.navy, fontSize: 29, fontWeight: '800', letterSpacing: -0.7 },
  pageSubtitle: { color: colors.muted, fontSize: 14, lineHeight: 21 },
  card: { padding: 18, borderWidth: 1, borderColor: colors.line, borderRadius: 18, backgroundColor: colors.white, gap: 11 },
  button: { minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 17, borderRadius: 12 },
  compactButton: { minHeight: 42, paddingHorizontal: 14 },
  primaryButton: { backgroundColor: colors.sea },
  secondaryButton: { borderWidth: 1, borderColor: colors.line, backgroundColor: colors.foam },
  dangerButton: { backgroundColor: colors.foam },
  primaryButtonText: { color: colors.white, fontSize: 13, fontWeight: '800', letterSpacing: 0.1 },
  secondaryButtonText: { color: colors.ink, fontSize: 12, fontWeight: '800' },
  dangerButtonText: { color: colors.danger, fontSize: 12, fontWeight: '800' },
  pressed: { opacity: 0.76 },
  disabled: { opacity: 0.55 },
  field: { gap: 7 },
  label: { color: colors.ink, fontSize: 12, fontWeight: '700', letterSpacing: 0.1 },
  input: { minHeight: 50, paddingHorizontal: 14, borderWidth: 1, borderColor: colors.line, borderRadius: 12, backgroundColor: colors.white, color: colors.ink, fontSize: 14 },
  multilineInput: { minHeight: 88, paddingVertical: 12, textAlignVertical: 'top' },
  disabledInput: { opacity: 0.65 },
  chip: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 15, borderWidth: 1, borderColor: colors.line, borderRadius: 22, backgroundColor: colors.white },
  selectedChip: { borderColor: colors.sea, backgroundColor: colors.pale },
  chipText: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  selectedChipText: { color: colors.sea },
  notice: { padding: 13, borderRadius: 12, fontSize: 13, lineHeight: 19 },
  errorNotice: { color: colors.danger, backgroundColor: colors.foam },
  successNotice: { color: colors.success, backgroundColor: colors.foam },
  emptyText: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  loadingCard: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  sectionTitle: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 3 },
  sectionText: { color: colors.navy, fontSize: 17, fontWeight: '800', letterSpacing: -0.2 },
  sectionDetail: { color: colors.muted, fontSize: 11, fontWeight: '600' },
  stat: { flex: 1, minWidth: '43%', padding: 16, borderWidth: 1, borderColor: colors.line, borderRadius: 16, backgroundColor: colors.white, gap: 5 },
  statLabel: { color: colors.muted, fontSize: 11, fontWeight: '600' },
  statValue: { color: colors.ink, fontSize: 22, fontWeight: '800' },
  statNote: { color: colors.muted, fontSize: 10 },
  listingHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  listingName: { flex: 1, color: colors.navy, fontSize: 18, fontWeight: '800', letterSpacing: -0.2 },
  badge: { overflow: 'hidden', paddingHorizontal: 9, paddingVertical: 6, borderRadius: 8, backgroundColor: colors.foam, color: colors.sea, fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  listingMeta: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  listingTrust: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 7 },
  listingTrustLevel: { color: colors.sea, fontSize: 10, fontWeight: '800' },
  listingPrice: { color: colors.navy, fontSize: 21, fontWeight: '800', letterSpacing: -0.3 },
  listingUnit: { color: colors.muted, fontSize: 11, fontWeight: '600' },
  listingPhoto: { width: '100%', height: 184, borderRadius: 13, backgroundColor: colors.foam },
  listingPhotoPlaceholder: { minHeight: 100, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: colors.foam },
  photoPlaceholderText: { color: colors.muted, fontSize: 12, fontWeight: '600' },
  listingDetail: { color: colors.ink, fontSize: 12, lineHeight: 18 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 3 }
});
