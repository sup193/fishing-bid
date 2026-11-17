import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Modal, StyleSheet, Text, View } from 'react-native';
import { Button, Card, Empty, Field, Loading, ListingCard, Notice, Page, SectionTitle, Stat, colors, money } from '../components/common';
import { mobileApi } from '../../api';

export function AdminOverviewScreen() {
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      setOverview(await mobileApi.adminOverview());
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { Promise.resolve().then(load); }, [load]);
  const counts = overview?.counts || {};

  return (
    <Page title="Marketplace overview" subtitle="A live snapshot of activity across TideMarket." onRefresh={() => { setRefreshing(true); load(); }} refreshing={refreshing}>
      {error ? <Notice>{error}</Notice> : null}
      {loading ? <Loading label="Loading marketplace overview…" /> : null}
      <View style={styles.stats}>
        <Stat label="Registered users" value={counts.users ?? '—'} />
        <Stat label="Active listings" value={counts.listings ?? '—'} />
        <Stat label="Total bids" value={counts.bids ?? '—'} />
        <Stat label="Verified paid volume" value={money(overview?.paidTotal)} />
      </View>
      <SectionTitle title="Recent orders" detail={`${counts.orders || 0} total`} />
      {overview?.recentOrders?.length ? overview.recentOrders.map(order => (
        <Card key={order.id}>
          <Text style={styles.personName}>{order.orderNumber || order.id}</Text>
          <Text style={styles.detail}>{money(order.amount)} · {order.orderStatus || 'pending'}</Text>
          <Text style={styles.detail}>Payment {order.paymentStatus || 'pending'}</Text>
        </Card>
      )) : !loading && <Empty>Marketplace orders will appear here.</Empty>}
    </Page>
  );
}

export function AdminListingsScreen() {
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [query, setQuery] = useState('');
  const [removing, setRemoving] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      setListings(await mobileApi.adminListings());
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { Promise.resolve().then(load); }, [load]);

  const visibleListings = useMemo(() => listings.filter(item => `${item.fishType || ''} ${item.fisherman?.name || ''} ${item.location || ''} ${item.status || ''}`.toLowerCase().includes(query.trim().toLowerCase())), [listings, query]);

  function confirmRemove(item) {
    Alert.alert('Remove listing?', `Hide ${item.fishType || 'this catch'} from the marketplace? Existing order and payment history will be preserved.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          setRemoving(item.id);
          setError('');
          setMessage('');
          try {
            const result = await mobileApi.removeAdminListing(item.id);
            setMessage(result.message || 'Listing removed.');
            await load();
          } catch (removeError) {
            setError(removeError.message);
          } finally {
            setRemoving('');
          }
        }
      }
    ]);
  }

  return (
    <Page title="Marketplace listings" subtitle="Review catch listings and remove content that should no longer be visible." onRefresh={() => { setRefreshing(true); load(); }} refreshing={refreshing}>
      {error ? <Notice>{error}</Notice> : null}
      {message ? <Notice type="success">{message}</Notice> : null}
      <Field label="Search listings" value={query} onChangeText={setQuery} placeholder="Species, fisherman, port, or status" />
      {loading ? <Loading label="Loading marketplace listings…" /> : !visibleListings.length ? <Empty>{listings.length ? 'No listings match your search.' : 'No marketplace listings yet.'}</Empty> : visibleListings.map(item => (
        <ListingCard
          key={item.id}
          item={item}
          detail={`By ${item.fisherman?.name || 'Unknown fisherman'} · ${item.status || 'unknown'} · ${item.auction?.bidCount || 0} bids`}
          actions={item.status !== 'removed' ? <Button label={removing === item.id ? 'Removing…' : 'Remove listing'} variant="danger" disabled={Boolean(removing)} onPress={() => confirmRemove(item)} /> : null}
        />
      ))}
    </Page>
  );
}

export function AdminPeopleScreen() {
  const [users, setUsers] = useState([]);
  const [requests, setRequests] = useState([]);
  const [selected, setSelected] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', location: '', phone: '' });
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [reviewing, setReviewing] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const [people, pending] = await Promise.all([mobileApi.adminUsers(), mobileApi.registrationRequests()]);
      setUsers(people);
      setRequests(pending);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { Promise.resolve().then(load); }, [load]);

  const fishermen = useMemo(() => users.filter(person => person.role === 'fisherman' && `${person.name} ${person.email} ${person.location || ''}`.toLowerCase().includes(query.trim().toLowerCase())), [users, query]);

  async function reviewRequest(requestId, action) {
    setReviewing(requestId);
    setError('');
    setMessage('');
    try {
      const result = action === 'accept' ? await mobileApi.acceptRegistration(requestId) : await mobileApi.rejectRegistration(requestId);
      setMessage(result.message || `Registration ${action}ed.`);
      await load();
    } catch (reviewError) {
      setError(reviewError.message);
    } finally {
      setReviewing('');
    }
  }

  async function openFisherman(person) {
    setError('');
    try {
      setSelected(await mobileApi.adminFisherman(person.id));
    } catch (detailError) {
      setError(detailError.message);
    }
  }

  function updateForm(key, value) {
    setForm(current => ({ ...current, [key]: value }));
  }

  async function createFisherman() {
    if (!form.name.trim() || !form.email.trim() || !form.password) {
      setError('Name, email, and a temporary password are required.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const person = await mobileApi.createFisherman({
        ...form,
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        location: form.location.trim(),
        phone: form.phone.trim()
      });
      setMessage(`${person.name} can now sign in as a fisherman.`);
      setForm({ name: '', email: '', password: '', location: '', phone: '' });
      setShowForm(false);
      await load();
    } catch (createError) {
      setError(createError.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Page title="People & onboarding" subtitle="Review buyer requests and manage fisherman accounts." onRefresh={() => { setRefreshing(true); load(); }} refreshing={refreshing}>
      {error ? <Notice>{error}</Notice> : null}
      {message ? <Notice type="success">{message}</Notice> : null}
      <View style={styles.peopleActions}>
        <Text style={styles.sectionHeading}>Fishermen ({fishermen.length})</Text>
        <Button label="＋ Create" compact onPress={() => { setError(''); setShowForm(true); }} />
      </View>
      <Field label="Search fishermen" value={query} onChangeText={setQuery} placeholder="Name, email, or port" />
      {loading ? <Loading label="Loading people…" /> : !fishermen.length ? <Empty>No fishermen match this search.</Empty> : fishermen.map(person => (
        <Card key={person.id}>
          <Text style={styles.personName}>{person.name}</Text>
          <Text style={styles.detail}>{person.email} · {person.location || 'Location not set'}</Text>
          <Button label="View performance" variant="secondary" compact onPress={() => openFisherman(person)} />
        </Card>
      ))}
      <SectionTitle title="Buyer registration requests" detail={`${requests.length} pending`} />
      {!loading && !requests.length ? <Empty>No buyer requests are waiting for review.</Empty> : requests.map(request => (
        <Card key={request.id}>
          <Text style={styles.personName}>{request.name}</Text>
          <Text style={styles.detail}>{request.email}{request.phone ? ` · ${request.phone}` : ''}</Text>
          {request.location ? <Text style={styles.detail}>{request.location}</Text> : null}
          <View style={styles.requestActions}>
            <Button label="Accept" compact onPress={() => reviewRequest(request.id, 'accept')} loading={reviewing === request.id} />
            <Button label="Reject" variant="danger" compact onPress={() => reviewRequest(request.id, 'reject')} loading={reviewing === request.id} />
          </View>
        </Card>
      ))}
      <Modal visible={showForm} animationType="slide" onRequestClose={() => setShowForm(false)}>
        <Page title="Create fisherman account" subtitle="The fisherman can use these credentials to sign in on web or mobile.">
          <Card>
            <Field label="Full name" value={form.name} onChangeText={value => updateForm('name', value)} placeholder="Fisherman name" />
            <Field label="Email address" value={form.email} onChangeText={value => updateForm('email', value)} placeholder="name@example.com" keyboardType="email-address" autoCapitalize="none" />
            <Field label="Temporary password" value={form.password} onChangeText={value => updateForm('password', value)} placeholder="Set a temporary password" secureTextEntry autoCapitalize="none" />
            <Field label="Port or location" value={form.location} onChangeText={value => updateForm('location', value)} placeholder="e.g. Mangalore" />
            <Field label="Phone number (optional)" value={form.phone} onChangeText={value => updateForm('phone', value)} placeholder="Phone number" keyboardType="phone-pad" />
            {error ? <Notice>{error}</Notice> : null}
            <View style={styles.requestActions}>
              <Button label="Cancel" variant="secondary" onPress={() => setShowForm(false)} />
              <Button label="Create account" onPress={createFisherman} loading={submitting} />
            </View>
          </Card>
        </Page>
      </Modal>
      <Modal visible={Boolean(selected)} animationType="slide" onRequestClose={() => setSelected(null)}>
        <Page title={selected?.fisherman?.name || 'Fisherman profile'} subtitle={selected?.fisherman?.email}>
          <Button label="← Back to people" variant="secondary" onPress={() => setSelected(null)} />
          {selected ? <>
            <Stat label="Verified earnings" value={money(selected.totalGained)} note={`${selected.listings.length} listings`} />
            <SectionTitle title="Catch performance" />
            {!selected.listings.length ? <Empty>No catches have been posted by this fisherman.</Empty> : selected.listings.map(item => (
              <ListingCard key={item.id} item={item} detail={`${item.bids} bids · Highest bid ${money(item.highestBid)}/kg · ${item.saleStatus}`} />
            ))}
          </> : null}
        </Page>
      </Modal>
    </Page>
  );
}

export function AdminTrustScreen() {
  const [scores, setScores] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [disputes, setDisputes] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [working, setWorking] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const [reputation, customerReviews, complaints, priceData] = await Promise.all([
        mobileApi.adminReputation(), mobileApi.adminReviews(), mobileApi.adminDisputes(), mobileApi.adminPriceAnalytics()
      ]);
      setScores(reputation);
      setReviews(customerReviews);
      setDisputes(complaints);
      setAnalytics(priceData);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { Promise.resolve().then(load); }, [load]);

  async function act(key, action, successMessage) {
    setWorking(key);
    setError('');
    setMessage('');
    try {
      await action();
      setMessage(successMessage);
      await load();
    } catch (actionError) {
      setError(actionError.message);
    } finally {
      setWorking('');
    }
  }

  async function evaluateModel() {
    await act('model', async () => {
      const result = await mobileApi.evaluatePriceModel();
      if (result.status === 'insufficient_data') throw new Error(`Not enough verified sales: ${result.sampleCount}/${result.requiredSampleCount}.`);
    }, 'Price model evaluation completed and analytics refreshed.');
  }

  return (
    <Page title="Trust & price analytics" subtitle="Moderate verified feedback, resolve order complaints, and monitor price model evidence." onRefresh={() => { setRefreshing(true); load(); }} refreshing={refreshing}>
      {error ? <Notice>{error}</Notice> : null}
      {message ? <Notice type="success">{message}</Notice> : null}
      {loading ? <Loading label="Loading reputation and price data…" /> : null}
      <SectionTitle title="Fisherman trust scores" detail={`${scores.length} accounts`} />
      {scores.map(({ fisherman, reputation }) => <Card key={fisherman.id}>
        <Text style={styles.personName}>{fisherman.name} · {reputation.status === 'rated' ? reputation.score : '—'}/100</Text>
        <Text style={styles.detail}>{reputation.level} · {reputation.completedOrderCount} completed · {reputation.averageRating === null ? 'No approved ratings' : `${reputation.averageRating.toFixed(1)} stars`}</Text>
        {reputation.factors?.map(factor => <Text style={styles.detail} key={factor.key}>{factor.key}: {factor.score === null ? 'no data' : `${Math.round(factor.score)}/100`} ({factor.weight}%)</Text>)}
        <Button label={reputation.verified ? 'Remove verification' : 'Verify fisherman'} variant="secondary" compact disabled={Boolean(working)} onPress={() => act(`verify-${fisherman.id}`, () => mobileApi.setFishermanVerification(fisherman.id, !reputation.verified), `${fisherman.name} verification updated.`)} />
      </Card>)}

      <SectionTitle title="Buyer review moderation" detail={`${reviews.filter(review => review.status === 'pending').length} pending`} />
      {!reviews.length && !loading ? <Empty>No buyer reviews submitted.</Empty> : reviews.map(review => (
        <Card key={review.id}>
          <Text style={styles.personName}>{review.rating}/5 stars · {review.status}</Text>
          <Text style={styles.detail}>Verified order {review.order} · fisherman {review.fisherman}</Text>
          {review.comment ? <Text style={styles.detail}>{review.comment}</Text> : null}
          {review.status === 'pending' ? <View style={styles.requestActions}>
            <Button label="Approve" compact disabled={Boolean(working)} onPress={() => act(review.id, () => mobileApi.moderateReview(review.id, { status: 'approved' }), 'Review approved.')} />
            <Button label="Reject" variant="danger" compact disabled={Boolean(working)} onPress={() => act(review.id, () => mobileApi.moderateReview(review.id, { status: 'rejected' }), 'Review rejected.')} />
          </View> : null}
        </Card>
      ))}

      <SectionTitle title="Order complaints" detail={`${disputes.filter(item => item.status !== 'reviewed').length} open`} />
      {!disputes.length && !loading ? <Empty>No buyer complaints reported.</Empty> : disputes.map(dispute => (
        <Card key={dispute.id}>
          <Text style={styles.personName}>Order {dispute.order} · {dispute.status}</Text>
          <Text style={styles.detail}>Fisherman {dispute.fisherman} · buyer identity withheld</Text>
          <Text style={styles.detail}>{dispute.complaint}</Text>
          {dispute.status !== 'reviewed' ? <View style={styles.requestActions}>
            <Button label="Confirm" compact disabled={Boolean(working)} onPress={() => act(dispute.id, () => mobileApi.reviewDispute(dispute.id, { finding: 'confirmed' }), 'Complaint confirmed; score recalculated.')} />
            <Button label="Not confirmed" variant="secondary" compact disabled={Boolean(working)} onPress={() => act(dispute.id, () => mobileApi.reviewDispute(dispute.id, { finding: 'not_confirmed' }), 'Complaint reviewed without a confirmed finding.')} />
          </View> : null}
        </Card>
      ))}

      <SectionTitle title="Price model health" detail={`${analytics?.dataAvailability?.verifiedSaleCount || 0}/${analytics?.dataAvailability?.requiredSampleCount || 50} verified sales`} />
      <Card>
        <Text style={styles.personName}>{analytics?.model?.model === 'linear_regression' ? 'Linear regression' : 'Transparent rule baseline'} · {analytics?.model?.status || 'preliminary'}</Text>
        <Text style={styles.detail}>Prediction requests: {analytics?.predictionUsageCount || 0}</Text>
        {analytics?.model?.validation ? <Text style={styles.detail}>Holdout MAE ₹{analytics.model.validation.metrics?.mae}/kg · RMSE ₹{analytics.model.validation.metrics?.rmse}/kg</Text> : null}
        <Button label={working === 'model' ? 'Evaluating…' : 'Evaluate verified sales'} compact disabled={Boolean(working) || !analytics?.dataAvailability?.canEvaluateModel} onPress={evaluateModel} />
      </Card>
      <SectionTitle title="Species-wise verified prices" />
      {analytics?.species?.length ? analytics.species.map(item => <Card key={item.fishType}>
        <Text style={styles.personName}>{item.fishType} · {item.observations} sales</Text>
        <Text style={styles.detail}>Average ₹{item.averagePricePerKg}/kg · range ₹{item.minimumPricePerKg}–₹{item.maximumPricePerKg}/kg</Text>
      </Card>) : <Empty>No verified paid sales are available for market statistics.</Empty>}
    </Page>
  );
}

const styles = StyleSheet.create({
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  sectionHeading: { color: colors.ink, fontSize: 16, fontWeight: '800' },
  peopleActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  personName: { color: colors.ink, fontSize: 14, fontWeight: '800' },
  detail: { color: colors.muted, fontSize: 11 },
  requestActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginTop: 2 }
});
