import { useEffect, useState } from 'react';
import {
  Alert,
  ActivityIndicator,
  Image,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useAuth } from '../auth/AuthContext';
import { resolveImageUrl } from '../../api';

export const colors = {
  ink: '#173a43',
  sea: '#177e78',
  coral: '#c94e39',
  foam: '#f3f8f7',
  muted: '#63777d',
  line: '#dce7e5',
  white: '#fff',
  danger: '#b33f36',
  pale: '#e5f2ef'
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
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <View style={styles.topBar}>
        <View style={styles.brandMark}><Text style={styles.brandMarkText}>TM</Text></View>
        <View style={styles.brandCopy}>
          <Text style={styles.brandName}>TideMarket</Text>
          <Text style={styles.accountName} numberOfLines={1}>{user?.name || 'Marketplace'}</Text>
        </View>
        <Pressable accessibilityRole="button" disabled={signingOut} onPress={logout} style={styles.logoutButton}>
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
    <Pressable onPress={onPress} style={[styles.chip, selected && styles.selectedChip]}>
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
  const [imageError, setImageError] = useState(false);

  useEffect(() => setImageError(false), [uri]);

  return uri && !imageError
    ? <Image
      accessibilityLabel={`${item.fishType || 'Catch'} photo`}
      onError={() => setImageError(true)}
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
  topBar: { minHeight: 66, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: colors.line, backgroundColor: colors.white },
  brandMark: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 19, backgroundColor: colors.ink },
  brandMarkText: { color: colors.white, fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  brandCopy: { flex: 1, marginLeft: 10 },
  brandName: { color: colors.ink, fontSize: 15, fontWeight: '800' },
  accountName: { maxWidth: 170, marginTop: 2, color: colors.muted, fontSize: 11 },
  logoutButton: { minHeight: 40, minWidth: 62, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  logoutText: { color: colors.ink, fontSize: 12, fontWeight: '700' },
  content: { width: '100%', maxWidth: 720, alignSelf: 'center', padding: 18, paddingBottom: 34, gap: 14 },
  pageHeading: { gap: 5, marginTop: 2, marginBottom: 2 },
  pageTitle: { color: colors.ink, fontSize: 27, fontWeight: '800', letterSpacing: -0.5 },
  pageSubtitle: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  card: { padding: 16, borderWidth: 1, borderColor: colors.line, borderRadius: 15, backgroundColor: colors.white, gap: 10 },
  button: { minHeight: 46, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 15, borderRadius: 10 },
  compactButton: { minHeight: 38, paddingHorizontal: 12 },
  primaryButton: { backgroundColor: colors.coral },
  secondaryButton: { backgroundColor: colors.pale },
  dangerButton: { backgroundColor: '#f8e8e6' },
  primaryButtonText: { color: colors.white, fontSize: 13, fontWeight: '800' },
  secondaryButtonText: { color: colors.ink, fontSize: 12, fontWeight: '800' },
  dangerButtonText: { color: colors.danger, fontSize: 12, fontWeight: '800' },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.55 },
  field: { gap: 7 },
  label: { color: colors.ink, fontSize: 12, fontWeight: '700' },
  input: { minHeight: 48, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.line, borderRadius: 9, backgroundColor: colors.foam, color: colors.ink, fontSize: 14 },
  multilineInput: { minHeight: 84, paddingVertical: 11, textAlignVertical: 'top' },
  disabledInput: { opacity: 0.65 },
  chip: { minHeight: 36, justifyContent: 'center', paddingHorizontal: 13, borderWidth: 1, borderColor: colors.line, borderRadius: 18, backgroundColor: colors.white },
  selectedChip: { borderColor: colors.sea, backgroundColor: colors.pale },
  chipText: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  selectedChipText: { color: colors.sea },
  notice: { padding: 12, borderRadius: 10, fontSize: 13, lineHeight: 18 },
  errorNotice: { color: colors.danger, backgroundColor: '#f8e8e6' },
  successNotice: { color: colors.sea, backgroundColor: '#e3f2ed' },
  emptyText: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  loadingCard: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  sectionTitle: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 3 },
  sectionText: { color: colors.ink, fontSize: 16, fontWeight: '800' },
  sectionDetail: { color: colors.muted, fontSize: 11 },
  stat: { flex: 1, minWidth: '43%', padding: 14, borderWidth: 1, borderColor: colors.line, borderRadius: 13, backgroundColor: colors.white, gap: 4 },
  statLabel: { color: colors.muted, fontSize: 11, fontWeight: '600' },
  statValue: { color: colors.ink, fontSize: 22, fontWeight: '800' },
  statNote: { color: colors.muted, fontSize: 10 },
  listingHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  listingName: { flex: 1, color: colors.ink, fontSize: 17, fontWeight: '800' },
  badge: { overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 5, borderRadius: 6, backgroundColor: colors.pale, color: colors.sea, fontSize: 9, fontWeight: '800' },
  listingMeta: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  listingTrust: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 7 },
  listingTrustLevel: { color: colors.sea, fontSize: 10, fontWeight: '800' },
  listingPrice: { color: colors.coral, fontSize: 19, fontWeight: '800' },
  listingUnit: { color: colors.muted, fontSize: 11, fontWeight: '600' },
  listingPhoto: { width: '100%', height: 170, borderRadius: 10, backgroundColor: colors.pale },
  listingPhotoPlaceholder: { minHeight: 90, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: colors.pale },
  photoPlaceholderText: { color: colors.muted, fontSize: 12, fontWeight: '600' },
  listingDetail: { color: colors.ink, fontSize: 12, lineHeight: 18 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 3 }
});
