import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Modal, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Button, Card, Chip, Empty, Field, ListingCard, Loading, Notice, Page, SectionTitle, Stat, colors, money } from '../components/common';
import { mobileApi } from '../../api';
import { useAuth } from '../auth/AuthContext';
import VoiceAssistantPanel from '../components/VoiceAssistant';
import { filterVoiceListings } from '../../../shared/voice/actions';

const filters = ['All catches', 'Fixed price', 'Auctions', 'For you'];

export function BuyerMarketScreen() {
  const { user, updateUser } = useAuth();
  const [listings, setListings] = useState([]);
  const [recommendations, setRecommendations] = useState([]);
  const [filter, setFilter] = useState('All catches');
  const [search, setSearch] = useState('');
  const [voiceFilter, setVoiceFilter] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [trendDays, setTrendDays] = useState(7);
  const [trendType, setTrendType] = useState('all');
  const [trends, setTrends] = useState(null);
  const [trendLoading, setTrendLoading] = useState(true);
  const [trendError, setTrendError] = useState('');
  const [selectedAuction, setSelectedAuction] = useState(null);
  const [auctionDetail, setAuctionDetail] = useState(null);
  const [bidAmount, setBidAmount] = useState('');
  const [automaticMax, setAutomaticMax] = useState('');
  const [automaticEnabled, setAutomaticEnabled] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [automaticLoading, setAutomaticLoading] = useState(false);
  const [auctionNow, setAuctionNow] = useState(0);
  const [message, setMessage] = useState('');
  const [notifications, setNotifications] = useState([]);
  const [notificationError, setNotificationError] = useState('');
  const selectedAuctionId = selectedAuction?.auction?.id;

  const load = useCallback(async () => {
    setError('');
    try {
      const [market, suggested] = await Promise.all([
        mobileApi.listings(),
        mobileApi.recommendations()
      ]);
      setListings(market);
      setRecommendations(suggested);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { Promise.resolve().then(load); }, [load]);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const values = await mobileApi.notifications();
        if (active) {
          setNotifications(values);
          setNotificationError('');
        }
      } catch (notificationLoadError) {
        if (active) setNotificationError(notificationLoadError.message);
      }
    };
    refresh();
    const interval = setInterval(refresh, 15000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  const refreshAuctionDetail = useCallback(async () => {
    if (!selectedAuctionId) return;
    try {
      const detail = await mobileApi.auction(selectedAuctionId);
      setAuctionDetail(detail);
      if (detail.auction.minimumBid) {
        setBidAmount(current => !current || Number(current) < detail.auction.minimumBid
          ? String(detail.auction.minimumBid)
          : current);
      }
      setError('');
    } catch (detailError) {
      setError(detailError.message);
    }
  }, [selectedAuctionId]);

  useEffect(() => {
    if (!selectedAuctionId) return undefined;
    Promise.resolve().then(refreshAuctionDetail);
    const interval = setInterval(refreshAuctionDetail, 3000);
    return () => clearInterval(interval);
  }, [refreshAuctionDetail, selectedAuctionId]);

  useEffect(() => {
    if (!selectedAuctionId) return undefined;
    let active = true;
    mobileApi.automaticBiddingStatus(selectedAuctionId)
      .then(result => {
        if (!active) return;
        setAutomaticEnabled(result.enabled);
        setAutomaticMax(result.maxAmount ? String(result.maxAmount) : '');
      })
      .catch(statusError => { if (active) setError(statusError.message); });
    return () => { active = false; };
  }, [selectedAuctionId]);

  useEffect(() => {
    const interval = setInterval(() => setAuctionNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const loadTrends = useCallback(async () => {
    setTrendLoading(true);
    setTrendError('');
    try {
      setTrends(await mobileApi.marketTrends(trendDays));
    } catch (trendLoadError) {
      setTrendError(trendLoadError.message);
    } finally {
      setTrendLoading(false);
    }
  }, [trendDays]);

  useEffect(() => { Promise.resolve().then(loadTrends); }, [loadTrends]);

  const filteredListings = useMemo(() => {
    const source = filter === 'For you' ? recommendations : listings;
    return source.filter(item => {
      const matchesMode = filter === 'Fixed price'
        ? item.saleMode !== 'bid'
        : filter === 'Auctions'
          ? item.saleMode === 'bid'
          : true;
      const query = search.trim().toLowerCase();
      const matchesQuery = !query || `${item.fishType} ${item.location} ${item.fisherman?.name || ''}`.toLowerCase().includes(query);
      return matchesMode && matchesQuery && (!voiceFilter || filterVoiceListings([item], voiceFilter).length > 0);
    });
  }, [filter, listings, recommendations, search, voiceFilter]);

  const activeAuction = auctionDetail?.auction || selectedAuction?.auction;
  const minimumBid = Number(activeAuction?.minimumBid || Number(activeAuction?.currentPrice || activeAuction?.startPrice || selectedAuction?.expectedPrice || 0)
    + Number(activeAuction?.minimumIncrement || 10));
  const auctionEnd = Date.parse(activeAuction?.endTime || '');
  const auctionClosed = ['completed', 'cancelled'].includes(activeAuction?.status) || (Number.isFinite(auctionEnd) && auctionEnd <= auctionNow);
  const remaining = auctionEnd - auctionNow;
  const timerLabel = !Number.isFinite(auctionEnd) ? 'Timer unavailable'
    : remaining <= 0 ? 'Closed'
      : `${Math.floor(remaining / 60000)}m ${Math.floor((remaining % 60000) / 1000)}s`;

  async function submitBid() {
    const amount = Number(bidAmount);
    const auction = auctionDetail?.auction || selectedAuction?.auction;
    const minimum = Number(auction?.minimumBid || Number(auction?.currentPrice || auction?.startPrice || selectedAuction?.expectedPrice || 0)
      + Number(auction?.minimumIncrement || 10));
    if (!Number.isFinite(amount) || amount < minimum) {
      setError(`Your bid must be at least ${money(minimum)} per kg.`);
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await mobileApi.bid(selectedAuction.auction.id, amount);
      setMessage(`Your ${money(amount)}/kg bid was submitted.`);
      await refreshAuctionDetail();
      await load();
    } catch (bidError) {
      setError(bidError.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function saveAutomaticBidding() {
    const amount = Number(automaticMax);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Enter a valid maximum bid amount.');
      return;
    }
    setAutomaticLoading(true);
    setError('');
    try {
      await mobileApi.automaticBidding(selectedAuctionId, amount);
      setAutomaticEnabled(true);
      setMessage('Automatic bidding is active. Your maximum stays private.');
      await refreshAuctionDetail();
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setAutomaticLoading(false);
    }
  }

  async function toggleAutomaticBidding(enabled) {
    if (enabled) return saveAutomaticBidding();
    setAutomaticLoading(true);
    setError('');
    try {
      await mobileApi.disableAutomaticBidding(selectedAuctionId);
      setAutomaticEnabled(false);
      setMessage('Automatic bidding has been turned off.');
    } catch (toggleError) {
      setError(toggleError.message);
    } finally {
      setAutomaticLoading(false);
    }
  }

  async function markNotificationRead(notification) {
    try {
      await mobileApi.markNotificationRead(notification.id);
      setNotifications(current => current.map(item => item.id === notification.id ? { ...item, read: true } : item));
    } catch (markError) {
      setNotificationError(markError.message);
    }
  }

  return (
    <Page title="Fresh from the coast." subtitle="Browse direct-sale catches and live auctions from local fishermen." onRefresh={() => { setRefreshing(true); load(); loadTrends(); }} refreshing={refreshing}>
      {message ? <Notice type="success">{message}</Notice> : null}
      {error ? <Notice>{error}</Notice> : null}
      {user ? <VoiceAssistantPanel
        user={user}
        onUserUpdate={updateUser}
        onSearch={intent => { setVoiceFilter(intent); setFilter('All catches'); setSearch(''); }}
        onActionComplete={load}
      /> : null}
      <View style={styles.stats}>
        <Stat label="Available catches" value={listings.length} />
        <Stat label="Live auctions" value={listings.filter(item => item.saleMode === 'bid' && item.auction?.status === 'active').length} />
      </View>
      {notificationError ? <Notice>{notificationError}</Notice> : null}
      {notifications.length ? <Card>
        <SectionTitle title="Auction notifications" detail={`${notifications.filter(item => !item.read).length} unread`} />
        {notifications.slice(0, 4).map(notification => (
          <View key={notification.id} style={styles.notificationRow}>
            <View style={styles.notificationCopy}>
              <Text style={styles.historyName}>{notification.title}</Text>
              <Text style={styles.muted}>{notification.message}</Text>
            </View>
            {!notification.read ? <Button label="Read" variant="secondary" compact onPress={() => markNotificationRead(notification)} /> : null}
          </View>
        ))}
      </Card> : null}
      <MarketTrendCard
        data={trends}
        days={trendDays}
        fishType={trendType}
        loading={trendLoading}
        error={trendError}
        onDaysChange={setTrendDays}
        onFishChange={setTrendType}
      />
      <Field label="Find seafood or port" value={search} onChangeText={setSearch} placeholder="Try tuna or Mangalore" autoCapitalize="none" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {filters.map(item => <Chip key={item} label={item} selected={filter === item} onPress={() => setFilter(item)} />)}
      </ScrollView>
      <SectionTitle title={filter === 'For you' ? 'Recommended for you' : 'Marketplace'} detail={`${filteredListings.length} catches`} />
      {loading ? <Loading label="Loading the marketplace…" /> : !filteredListings.length ? <Empty>No catches match this view yet. Pull down to refresh.</Empty> : filteredListings.map(item => {
        const closed = item.saleMode === 'bid' && (['completed', 'cancelled'].includes(item.auction?.status)
          || (item.auction?.endTime && Date.parse(item.auction.endTime) <= auctionNow));
        return (
          <ListingCard
            key={item.id}
            item={item}
            detail={item.description}
            actions={item.saleMode === 'bid'
              ? <Button label={closed ? 'Auction ended' : 'Place a bid'} disabled={closed} onPress={() => {
                const next = Number(item.auction?.currentPrice || item.auction?.startPrice || item.expectedPrice || 0) + Number(item.auction?.minimumIncrement || 10);
                setAuctionDetail(null);
                setAutomaticEnabled(false);
                setAutomaticMax('');
                setError('');
                setSelectedAuction(item);
                setBidAmount(String(next));
                setAuctionNow(Date.now());
              }} />
              : <Button label="Buy now" onPress={() => Alert.alert('Secure checkout', 'Payment checkout is not yet available in the mobile app. Open TideMarket on the web to complete a purchase.')} />}
          />
        );
      })}
      <Modal visible={Boolean(selectedAuction)} transparent animationType="slide" onRequestClose={() => setSelectedAuction(null)}>
        <View style={styles.modalBackdrop}>
          <ScrollView contentContainerStyle={styles.modalScrollContent} keyboardShouldPersistTaps="handled">
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>{selectedAuction?.fishType} auction</Text>
              <Text style={styles.modalSubtitle}>Fisherman: {selectedAuction?.fisherman?.name || 'Local fisherman'}</Text>
              <View style={styles.auctionFacts}>
                <Text style={styles.auctionFact}>Current bid: {money(activeAuction?.currentPrice || activeAuction?.startPrice)}/kg</Text>
                <Text style={styles.auctionFact}>Minimum increment: {money(activeAuction?.minimumIncrement)}/kg</Text>
                <Text style={styles.auctionFact}>Time remaining: {timerLabel}</Text>
                <Text style={styles.auctionFact}>Active bidders: {auctionDetail?.activeBidderCount || 0}</Text>
                <Text style={styles.auctionFact}>Status: {activeAuction?.status || 'loading'}</Text>
                {activeAuction?.currentBidder?.name ? <Text style={styles.auctionFact}>Leading: {activeAuction.currentBidder.name}</Text> : null}
              </View>
              {remaining > 0 && remaining <= 300000 ? <Text style={styles.closingNotice}>A valid bid in the final 30 seconds extends the auction by 30 seconds.</Text> : null}
              <Text style={styles.historyTitle}>Bid history · {auctionDetail?.bids?.length || 0}</Text>
              {auctionDetail?.bids?.length
                ? auctionDetail.bids.map(bid => (
                  <View key={bid.id} style={styles.bidHistoryRow}>
                    <View style={styles.bidHistoryCopy}>
                      <Text style={styles.bidHistoryName}>{bid.buyer?.name || 'Buyer'}</Text>
                      <Text style={styles.muted}>{formatDate(bid.createdAt)} · {bid.type === 'automatic' ? 'Automatic' : 'Manual'}</Text>
                    </View>
                    <Text style={styles.bidHistoryAmount}>{money(bid.amount)}/kg</Text>
                  </View>
                ))
                : <Text style={styles.muted}>No bids yet.</Text>}
              {!auctionClosed ? <>
                <Field label={`Manual bid per kg (minimum ${money(minimumBid)})`} value={bidAmount} onChangeText={setBidAmount} placeholder="Enter your bid" keyboardType="decimal-pad" autoCapitalize="none" />
                <Button label="Submit bid" onPress={submitBid} loading={submitting} />
                <View style={styles.autoBidPanel}>
                  <View style={styles.autoBidHeader}>
                    <Text style={styles.historyTitle}>Automatic bidding</Text>
                    <Switch value={automaticEnabled} onValueChange={toggleAutomaticBidding} disabled={automaticLoading} />
                  </View>
                  <Text style={styles.muted}>Bids increase only as needed and never exceed your private maximum.</Text>
                  <Field label="Maximum bid per kg (₹)" value={automaticMax} onChangeText={setAutomaticMax} placeholder="Set your maximum" keyboardType="decimal-pad" autoCapitalize="none" />
                  <Button label={automaticEnabled ? 'Update maximum' : 'Activate automatic bidding'} variant="secondary" onPress={saveAutomaticBidding} loading={automaticLoading} />
                </View>
              </> : <Text style={styles.muted}>{activeAuction?.winner ? 'Auction closed. The winner can continue to checkout on the web app.' : 'Auction closed without bids.'}</Text>}
              {error ? <Notice>{error}</Notice> : null}
              <View style={styles.modalActions}>
                <Button label="Close" variant="secondary" onPress={() => { setSelectedAuction(null); setError(''); }} />
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </Page>
  );
}

function MarketTrendCard({ data, days, fishType, loading, error, onDaysChange, onFishChange }) {
  const [selectedPoints, fishTypes] = useMemo(() => {
    const points = data?.points || [];
    return [
      points.filter(point => fishType === 'all' || point.fishType === fishType),
      [...new Set(points.map(point => point.fishType))].sort()
    ];
  }, [data, fishType]);

  const grouped = useMemo(() => {
    const groups = new Map();
    for (const point of selectedPoints) {
      const key = `${point.date}:${point.source}`;
      const group = groups.get(key) || { date: point.date, source: point.source, total: 0, count: 0 };
      group.total += Number(point.averagePrice) * Number(point.observations);
      group.count += Number(point.observations);
      groups.set(key, group);
    }
    return [...groups.values()].map(point => ({ ...point, averagePrice: point.total / point.count }));
  }, [selectedPoints]);

  const dates = useMemo(() => [...new Set(grouped.map(point => point.date))].sort(), [grouped]);
  const maximum = Math.max(0, ...grouped.map(point => point.averagePrice));
  const sourceMeta = [
    { key: 'auction', label: 'Auction bids', color: '#177e78' },
    { key: 'market', label: 'Fixed price', color: '#c94e39' },
    { key: 'sales', label: 'Paid sales', color: '#8065df' }
  ];
  const averageFor = source => {
    const points = grouped.filter(point => point.source === source);
    const count = points.reduce((total, point) => total + point.count, 0);
    return count ? points.reduce((total, point) => total + point.total, 0) / count : 0;
  };
  const pointFor = (date, source) => grouped.find(point => point.date === date && point.source === source);

  return (
    <Card>
      <View style={styles.trendHeading}>
        <View style={styles.trendCopy}>
          <Text style={styles.trendEyebrow}>LIVE OCEAN MARKET PULSE</Text>
          <Text style={styles.trendTitle}>Market price trends</Text>
          <Text style={styles.muted}>Daily averages per kg; paid sales include verified Razorpay orders.</Text>
        </View>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        <Chip label="7 days" selected={days === 7} onPress={() => onDaysChange(7)} />
        <Chip label="30 days" selected={days === 30} onPress={() => onDaysChange(30)} />
      </ScrollView>
      {fishTypes.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          <Chip label="All seafood" selected={fishType === 'all'} onPress={() => onFishChange('all')} />
          {fishTypes.map(type => <Chip key={type} label={type} selected={fishType === type} onPress={() => onFishChange(type)} />)}
        </ScrollView>
      ) : null}
      {sourceMeta.map(source => (
        <View key={source.key} style={styles.legendRow}>
          <View style={[styles.legendDot, { backgroundColor: source.color }]} />
          <Text style={styles.legendLabel}>{source.label}</Text>
          <Text style={styles.legendValue}>{averageFor(source) ? `${money(averageFor(source))}/kg avg.` : 'No data'}</Text>
        </View>
      ))}
      {error ? <Notice>{error}</Notice> : null}
      {loading ? <Loading label="Loading recorded market prices…" /> : !grouped.length && !error ? <Text style={styles.muted}>Trends will appear as catches are listed, buyers bid, and paid orders are recorded.</Text> : null}
      {!loading && grouped.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.chart} accessibilityLabel={`Market price chart for the last ${days} days`}>
          {dates.map(date => (
            <View key={date} style={styles.chartColumn}>
              <View style={styles.barGroup}>
                {sourceMeta.map(source => {
                  const point = pointFor(date, source.key);
                  const height = point && maximum ? Math.max(4, point.averagePrice / maximum * 96) : 0;
                  return (
                    <View key={source.key} style={[styles.bar, { height, backgroundColor: source.color }]} />
                  );
                })}
              </View>
              <Text style={styles.dateLabel}>{new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })}</Text>
            </View>
          ))}
        </ScrollView>
      ) : null}
    </Card>
  );
}

export function BuyerHistoryScreen() {
  const [history, setHistory] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const [buyerHistory, submittedReviews] = await Promise.all([mobileApi.buyerHistory(), mobileApi.buyerReviews()]);
      setHistory(buyerHistory);
      setReviews(submittedReviews);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { Promise.resolve().then(load); }, [load]);

  async function submitReview(order, rating, comment) {
    const review = await mobileApi.submitOrderReview(order.id, { rating, comment });
    setReviews(current => [review, ...current]);
    setHistory(current => ({
      ...current,
      orders: current.orders.map(item => item.id === order.id ? { ...item, canReview: false, reviewSubmitted: true } : item)
    }));
  }

  async function reportIssue(order, complaint) {
    await mobileApi.reportOrderDispute(order.id, complaint);
    setHistory(current => ({
      ...current,
      orders: current.orders.map(item => item.id === order.id ? { ...item, canReport: false } : item)
    }));
  }

  return (
    <Page title="Your activity" subtitle="Review your bidding activity and marketplace orders." onRefresh={() => { setRefreshing(true); load(); }} refreshing={refreshing}>
      {error ? <Notice>{error}</Notice> : null}
      {!history && !error ? <Loading label="Loading your bids and orders…" /> : null}
      {history ? <>
        <SectionTitle title="My bids" detail={`${history.bids.length} bids`} />
        {!history.bids.length ? <Empty>Your bids will appear here.</Empty> : history.bids.map(bid => (
          <Card key={bid.id}>
            <View style={styles.historyRow}>
              <View style={styles.historyCopy}>
                <Text style={styles.historyName}>{bid.fishType}</Text>
                <Text style={styles.muted}>{bid.quantity} kg · {formatDate(bid.createdAt)}</Text>
                <Text style={styles.muted}>Highest bid {money(bid.highestBid)}/kg</Text>
              </View>
              <View style={styles.historyValue}>
                <Text style={styles.historyName}>{money(bid.amount)}/kg</Text>
                <Text style={styles.status}>{bid.bidStatus}</Text>
              </View>
            </View>
          </Card>
        ))}
        <SectionTitle title="My purchases" detail={`${history.orders.length} orders`} />
        {!history.orders.length ? <Empty>Your orders will appear here after you buy a catch or win an auction.</Empty> : history.orders.map(order => (
          <Card key={order.id}>
            <View style={styles.historyRow}>
              <View style={styles.historyCopy}>
                <Text style={styles.historyName}>{order.fishType}</Text>
                <Text style={styles.muted}>{order.orderNumber} · {order.quantity} kg</Text>
                <Text style={styles.muted}>{formatDate(order.createdAt)} · {order.orderStatus}</Text>
              </View>
              <View style={styles.historyValue}>
                <Text style={styles.historyName}>{money(order.amount)}</Text>
                <Text style={styles.status}>Payment {order.paymentStatus}</Text>
              </View>
            </View>
            {order.canReview ? <BuyerOrderFeedback order={order} onReview={submitReview} /> : null}
            {order.reviewSubmitted ? <Text style={styles.feedbackStatus}>Review submitted · pending moderation</Text> : null}
            {order.canReport ? <BuyerOrderFeedback order={order} reportOnly onReport={reportIssue} /> : null}
          </Card>
        ))}
        <SectionTitle title="Your submitted reviews" detail={`${reviews.length} reviews`} />
        {!reviews.length ? <Empty>Reviews you submit will appear here with their moderation status.</Empty> : reviews.map(review => (
          <Card key={review.id}>
            <Text style={styles.historyName}>{'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)} · {review.status}</Text>
            <Text style={styles.muted}>Order {review.order}</Text>
            {review.comment ? <Text style={styles.muted}>{review.comment}</Text> : null}
          </Card>
        ))}
      </> : null}
    </Page>
  );
}

function BuyerOrderFeedback({ order, reportOnly = false, onReview, onReport }) {
  const [rating, setRating] = useState('5');
  const [comment, setComment] = useState('');
  const [open, setOpen] = useState(!reportOnly);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  async function submit() {
    setError('');
    setSubmitting(true);
    try {
      if (reportOnly) {
        await onReport(order, comment);
        setOpen(false);
      } else {
        await onReview(order, Number(rating), comment);
      }
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setSubmitting(false);
    }
  }
  if (!open) return <Button label="Report an order issue" variant="secondary" compact onPress={() => setOpen(true)} />;
  return (
    <View style={styles.feedbackForm}>
      {!reportOnly ? <>
        <Text style={styles.muted}>Rate {order.fisherman}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {[5, 4, 3, 2, 1].map(value => <Chip key={value} label={`${value} ★`} selected={Number(rating) === value} onPress={() => setRating(String(value))} />)}
        </ScrollView>
      </> : <Text style={styles.muted}>Report an issue with this verified paid order (10–2,000 characters).</Text>}
      <Field label={reportOnly ? 'Describe the issue' : 'Optional feedback'} value={comment} onChangeText={setComment} placeholder={reportOnly ? 'Explain what happened' : 'Share feedback about the order'} multiline />
      {error ? <Notice>{error}</Notice> : null}
      <View style={styles.feedbackActions}>
        {reportOnly ? <Button label="Cancel" variant="secondary" compact onPress={() => setOpen(false)} /> : null}
        <Button label={submitting ? 'Sending…' : reportOnly ? 'Send report' : 'Submit verified review'} compact onPress={submit} loading={submitting} />
      </View>
    </View>
  );
}

function formatDate(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleString() : 'Date unavailable';
}

const styles = StyleSheet.create({
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  chips: { gap: 8, paddingVertical: 1 },
  trendHeading: { flexDirection: 'row', justifyContent: 'space-between' },
  trendCopy: { flex: 1, gap: 4 },
  trendEyebrow: { color: colors.sea, fontSize: 9, fontWeight: '800', letterSpacing: 1.1 },
  trendTitle: { color: colors.ink, fontSize: 17, fontWeight: '800' },
  muted: { color: colors.muted, fontSize: 11, lineHeight: 16 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  legendDot: { width: 9, height: 9, borderRadius: 5 },
  legendLabel: { flex: 1, color: colors.ink, fontSize: 11, fontWeight: '700' },
  legendValue: { color: colors.muted, fontSize: 10 },
  chart: { minHeight: 133, alignItems: 'flex-end', gap: 5, paddingTop: 6 },
  chartColumn: { width: 30, alignItems: 'center', justifyContent: 'flex-end', gap: 5 },
  barGroup: { height: 103, flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  bar: { width: 7, borderTopLeftRadius: 3, borderTopRightRadius: 3 },
  dateLabel: { color: colors.muted, fontSize: 8 },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', padding: 14, backgroundColor: 'rgba(10,31,36,0.5)' },
  modalScrollContent: { flexGrow: 1, justifyContent: 'flex-end' },
  modalCard: { maxHeight: '92%', padding: 20, borderRadius: 18, backgroundColor: colors.white, gap: 14 },
  modalTitle: { color: colors.ink, fontSize: 20, fontWeight: '800' },
  modalSubtitle: { color: colors.muted, fontSize: 12 },
  auctionFacts: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  auctionFact: { padding: 8, borderRadius: 8, backgroundColor: '#eef7f3', color: colors.ink, fontSize: 10, fontWeight: '700' },
  closingNotice: { padding: 10, borderRadius: 8, backgroundColor: '#fff8e9', color: '#85621a', fontSize: 10, lineHeight: 15 },
  historyTitle: { color: colors.ink, fontSize: 13, fontWeight: '800' },
  bidHistoryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#edf2ef' },
  bidHistoryCopy: { flex: 1, gap: 3 },
  bidHistoryName: { color: colors.ink, fontSize: 11, fontWeight: '800' },
  bidHistoryAmount: { color: colors.sea, fontSize: 11, fontWeight: '800' },
  autoBidPanel: { gap: 9, padding: 12, borderWidth: 1, borderColor: '#dce9e5', borderRadius: 11, backgroundColor: '#f5faf7' },
  autoBidHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  notificationRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, borderTopWidth: 1, borderTopColor: '#edf2ef' },
  notificationCopy: { flex: 1, gap: 4 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  historyRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  historyCopy: { flex: 1, gap: 4 },
  historyValue: { alignItems: 'flex-end', gap: 5 },
  historyName: { color: colors.ink, fontSize: 14, fontWeight: '800' },
  status: { color: colors.sea, fontSize: 10, fontWeight: '700', textTransform: 'capitalize' },
  feedbackForm: { gap: 8, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.line },
  feedbackActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  feedbackStatus: { color: colors.sea, fontSize: 11, fontWeight: '700' }
});
