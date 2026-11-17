import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Image, Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Button, Card, Chip, Empty, Field, ListingCard, Loading, Notice, Page, Stat, colors, money } from '../components/common';
import { mobileApi } from '../../api';
import { useAuth } from '../auth/AuthContext';
import VoiceAssistantPanel from '../components/VoiceAssistant';

const blankListing = {
  fishType: '',
  quantity: '',
  quality: 'Premium',
  size: 'Medium',
  location: '',
  price: '',
  description: '',
  minimumIncrement: '10',
  durationHours: '24',
  imageUrl: ''
};

export function FishermanInventoryScreen() {
  const { user, updateUser } = useAuth();
  const [listings, setListings] = useState([]);
  const [form, setForm] = useState(blankListing);
  const [saleMode, setSaleMode] = useState('sale');
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [imageUploading, setImageUploading] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      setListings(await mobileApi.fishermanListings());
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { Promise.resolve().then(load); }, [load]);

  const activeAuctions = listings.filter(item => item.saleMode === 'bid' && ['active', 'scheduled'].includes(item.auction?.status)).length;
  const activeListings = listings.filter(item => ['available', 'auction'].includes(item.status)).length;

  function updateField(key, value) {
    setForm(current => ({ ...current, [key]: value }));
  }

  async function choosePhoto() {
    setError('');
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setError('Allow photo-library access to add a catch photo.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.85
      });
      if (result.canceled) return;

      const photo = result.assets?.[0];
      if (!photo?.uri) throw new Error('The selected photo could not be read.');

      setSelectedPhoto(photo);
      updateField('imageUrl', '');
      setImageUploading(true);
      try {
        const uploaded = await mobileApi.uploadImage(photo);
        updateField('imageUrl', uploaded.imageUrl);
      } catch (uploadError) {
        setError(uploadError.message);
      } finally {
        setImageUploading(false);
      }
    } catch (pickerError) {
      setError(`Could not open your photo library: ${pickerError.message}`);
    }
  }

  async function publishListing() {
    const quantity = Number(form.quantity);
    const price = Number(form.price);
    if (!form.fishType.trim() || !form.location.trim() || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(price) || price <= 0) {
      setError('Enter the fish type, a positive quantity and price, and the landing port.');
      return;
    }
    if (!form.imageUrl) {
      setError('Choose and upload a catch photo before publishing.');
      return;
    }
    if (saleMode === 'bid' && (!Number(form.durationHours) || Number(form.durationHours) <= 0 || !Number(form.minimumIncrement) || Number(form.minimumIncrement) <= 0)) {
      setError('Enter a positive auction duration and minimum bid increase.');
      return;
    }

    setSubmitting(true);
    setError('');
    setMessage('');
    try {
      const listing = await mobileApi.createListing({
        fishType: form.fishType.trim(),
        quantity,
        quality: form.quality.trim() || 'Not set',
        size: form.size.trim() || 'Not set',
        location: form.location.trim(),
        expectedPrice: price,
        salePrice: price,
        saleMode,
        description: form.description.trim(),
        imageUrl: form.imageUrl
      });
      if (saleMode === 'bid') {
        try {
          await mobileApi.createAuction(listing.id, {
            startPrice: price,
            minimumIncrement: Number(form.minimumIncrement),
            startTime: new Date().toISOString(),
            endTime: new Date(Date.now() + Number(form.durationHours) * 60 * 60 * 1000).toISOString()
          });
        } catch (auctionError) {
          setError(`The catch was published, but auction setup failed: ${auctionError.message}`);
          setShowForm(false);
          await load();
          return;
        }
      }
      setMessage(saleMode === 'bid' ? 'Auction listing published.' : 'Fixed-price listing published.');
      setForm(blankListing);
      setSelectedPhoto(null);
      setShowForm(false);
      await load();
    } catch (publishError) {
      setError(publishError.message);
    } finally {
      setSubmitting(false);
    }
  }

  function confirmDelete(item) {
    Alert.alert('Delete this listing?', `${item.fishType} will be removed if it has no active bid or sale record.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setError('');
          try {
            await mobileApi.deleteListing(item.id);
            setMessage('Listing deleted.');
            await load();
          } catch (deleteError) {
            setError(deleteError.message);
          }
        }
      }
    ]);
  }

  function confirmClose(item) {
    Alert.alert('Stop this auction?', 'Bidding will close and the highest bidder, if any, will be selected.', [
      { text: 'Keep open', style: 'cancel' },
      {
        text: 'Stop bidding',
        onPress: async () => {
          setError('');
          try {
            const result = await mobileApi.closeAuction(item.auction.id);
            setMessage(result.winnerName ? `${result.winnerName} won at ${money(result.winningBid)}/kg.` : 'Auction closed without bids.');
            await load();
          } catch (closeError) {
            setError(closeError.message);
          }
        }
      }
    ]);
  }

  return (
    <Page title="Your catch, your terms." subtitle="Post sale listings, start auctions, and manage your inventory." onRefresh={() => { setRefreshing(true); load(); }} refreshing={refreshing}>
      {error ? <Notice>{error}</Notice> : null}
      {message ? <Notice type="success">{message}</Notice> : null}
      {user ? <VoiceAssistantPanel user={user} onUserUpdate={updateUser} onActionComplete={load} /> : null}
      <View style={styles.stats}>
        <Stat label="Active listings" value={activeListings} />
        <Stat label="Open auctions" value={activeAuctions} />
      </View>
      <Button label="＋ Post a catch" onPress={() => { setSaleMode('sale'); setForm(blankListing); setSelectedPhoto(null); setError(''); setShowForm(true); }} />
      {loading ? <Loading label="Loading your catches…" /> : !listings.length ? <Empty>Your inventory is empty. Post your first catch to offer it to buyers.</Empty> : listings.map(item => (
        <ListingCard
          key={item.id}
          item={item}
          detail={`Status: ${item.status || 'unknown'}${item.predictedLow && item.predictedHigh ? ` · Price guide ${money(item.predictedLow)}–${money(item.predictedHigh)}/kg` : ''}`}
          actions={<>
            {item.saleMode === 'bid' && item.auction && ['active', 'scheduled'].includes(item.auction.status) ? <Button label="Stop bidding" variant="secondary" onPress={() => confirmClose(item)} /> : null}
            {item.status === 'available' && !item.auction ? <Button label="Delete listing" variant="danger" onPress={() => confirmDelete(item)} /> : null}
          </>}
        />
      ))}
      <Modal visible={showForm} animationType="slide" onRequestClose={() => setShowForm(false)}>
        <Page title="Post a catch" subtitle="Add catch details, then choose direct sale or bidding.">
          <Card>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              <Chip label="Fixed price" selected={saleMode === 'sale'} onPress={() => setSaleMode('sale')} />
              <Chip label="Auction" selected={saleMode === 'bid'} onPress={() => setSaleMode('bid')} />
            </ScrollView>
            <Field label="Fish species" value={form.fishType} onChangeText={value => updateField('fishType', value)} placeholder="e.g. Tuna" />
            <Field label="Quantity (kg)" value={form.quantity} onChangeText={value => updateField('quantity', value)} placeholder="e.g. 25" keyboardType="decimal-pad" autoCapitalize="none" />
            <Field label={saleMode === 'bid' ? 'Starting bid per kg (₹)' : 'Price per kg (₹)'} value={form.price} onChangeText={value => updateField('price', value)} placeholder="e.g. 380" keyboardType="decimal-pad" autoCapitalize="none" />
            <Field label="Landing port" value={form.location} onChangeText={value => updateField('location', value)} placeholder="e.g. Mangalore" />
            {selectedPhoto?.uri
              ? <Image accessibilityLabel="Selected catch photo preview" source={{ uri: selectedPhoto.uri }} resizeMode="cover" style={styles.photoPreview} />
              : <View style={styles.photoPlaceholder}><Text style={styles.photoPlaceholderText}>Add a photo of this catch</Text></View>}
            <Button label={imageUploading ? 'Uploading photo…' : selectedPhoto ? 'Choose another photo' : 'Choose catch photo'} onPress={choosePhoto} loading={imageUploading} variant="secondary" />
            <Field label="Seller-reported quality" value={form.quality} onChangeText={value => updateField('quality', value)} placeholder="e.g. Premium" />
            <Field label="Size" value={form.size} onChangeText={value => updateField('size', value)} placeholder="e.g. Medium" />
            {saleMode === 'bid' ? <>
              <Field label="Minimum bid increase (₹)" value={form.minimumIncrement} onChangeText={value => updateField('minimumIncrement', value)} keyboardType="decimal-pad" autoCapitalize="none" />
              <Field label="Auction duration (hours)" value={form.durationHours} onChangeText={value => updateField('durationHours', value)} keyboardType="decimal-pad" autoCapitalize="none" />
            </> : null}
            <Field label="Catch notes (optional)" value={form.description} onChangeText={value => updateField('description', value)} placeholder="Add helpful details about the catch." multiline />
            {error ? <Notice>{error}</Notice> : null}
            <View style={styles.formActions}>
              <Button label="Cancel" variant="secondary" onPress={() => setShowForm(false)} />
              <Button label="Publish listing" onPress={publishListing} loading={submitting} disabled={imageUploading || !form.imageUrl} />
            </View>
          </Card>
        </Page>
      </Modal>
    </Page>
  );
}

export function FishermanOrdersScreen() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [updating, setUpdating] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      setOrders(await mobileApi.fishermanSales());
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { Promise.resolve().then(load); }, [load]);

  async function setOrderStatus(order, status) {
    setUpdating(order.id);
    setError('');
    try {
      await mobileApi.updateOrderStatus(order.id, status);
      await load();
    } catch (updateError) {
      setError(updateError.message);
    } finally {
      setUpdating('');
    }
  }

  return (
    <Page title="Buyer orders" subtitle="Track payments and progress for orders on your catches." onRefresh={() => { setRefreshing(true); load(); }} refreshing={refreshing}>
      {error ? <Notice>{error}</Notice> : null}
      {loading ? <Loading label="Loading buyer orders…" /> : !orders.length ? <Empty>Buyer orders will appear here when someone buys your catch.</Empty> : orders.map(order => {
        const nextStatus = order.orderStatus === 'processing' ? 'delivered' : order.orderStatus === 'delivered' ? 'completed' : order.orderStatus === 'completed' ? null : 'processing';
        const canProgress = order.paymentStatus === 'paid' && !['cancelled', 'payment-failed'].includes(order.orderStatus) && nextStatus;
        return (
          <Card key={order.id}>
            <Text style={styles.orderTitle}>{order.listingDetails?.fishType || 'Fish order'} · {money(order.amount)}</Text>
            <Text style={styles.orderMeta}>Order {order.orderNumber || order.id} · {order.quantity || order.listingDetails?.quantity || 0} kg</Text>
            <Text style={styles.orderMeta}>Payment {order.paymentStatus || 'pending'} · Order {order.orderStatus || 'pending'}</Text>
            {canProgress ? <Button label={`Mark ${nextStatus}`} compact onPress={() => setOrderStatus(order, nextStatus)} loading={updating === order.id} /> : null}
          </Card>
        );
      })}
    </Page>
  );
}

export function FishermanSalesScreen() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      setOrders(await mobileApi.fishermanSales());
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { Promise.resolve().then(load); }, [load]);

  const paidOrders = useMemo(() => orders.filter(order => order.paymentStatus === 'paid' && order.gateway === 'razorpay'), [orders]);
  const total = paidOrders.reduce((sum, order) => sum + Number(order.amount || 0), 0);

  return (
    <Page title="Selling data" subtitle="Only verified paid orders count toward completed sales." onRefresh={() => { setRefreshing(true); load(); }} refreshing={refreshing}>
      <Stat label="Verified sales" value={money(total)} note={`${paidOrders.length} paid orders`} />
      {error ? <Notice>{error}</Notice> : null}
      {loading ? <Loading label="Loading sales…" /> : !paidOrders.length ? <Empty>Verified Razorpay sales will appear here after buyer checkout.</Empty> : paidOrders.map(order => (
        <Card key={order.id}>
          <Text style={styles.orderTitle}>{order.listingDetails?.fishType || 'Fish order'} · {money(order.amount)}</Text>
          <Text style={styles.orderMeta}>Order {order.orderNumber || order.id} · {order.quantity || 0} kg</Text>
          <Text style={styles.orderMeta}>{order.orderStatus || 'pending'} · Paid via Razorpay</Text>
        </Card>
      ))}
    </Page>
  );
}

const styles = StyleSheet.create({
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  chips: { gap: 8, paddingVertical: 2 },
  formActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 9, marginTop: 4 },
  photoPreview: { width: '100%', height: 190, borderRadius: 10, backgroundColor: colors.pale },
  photoPlaceholder: { minHeight: 90, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: colors.pale },
  photoPlaceholderText: { color: colors.muted, fontSize: 12, fontWeight: '600' },
  orderTitle: { color: colors.ink, fontSize: 14, fontWeight: '800' },
  orderMeta: { color: colors.muted, fontSize: 11 }
});
