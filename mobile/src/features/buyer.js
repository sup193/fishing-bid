import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Card, Chip, Empty, Field, ListingCard, Loading, Notice, Page, SectionTitle, Stat, colors, money } from '../components/common';
import { mobileApi } from '../../api';

const filters = ['All catches', 'Fixed price', 'Auctions', 'For you'];

export function BuyerMarketScreen() {
  const [listings, setListings] = useState([]);
  const [recommendations, setRecommendations] = useState([]);
  const [filter, setFilter] = useState('All catches');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [trendDays, setTrendDays] = useState(7);
  const [trendType, setTrendType] = useState('all');
  const [trends, setTrends] = useState(null);
  const [trendLoading, setTrendLoading] = useState(true);
  const [trendError, setTrendError] = useState('');
  const [selectedAuction, setSelectedAuction] = useState(null);
  const [bidAmount, setBidAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');

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
      return matchesMode && matchesQuery;
    });
  }, [filter, listings, recommendations, search]);

  async function submitBid() {
    const amount = Number(bidAmount);
    const minimum = Number(selectedAuction?.auction?.currentPrice || selectedAuction?.auction?.startPrice || selectedAuction?.expectedPrice || 0)
      + Number(selectedAuction?.auction?.minimumIncrement || 10);
    if (!Number.isFinite(amount) || amount < minimum) {
      setError(`Your bid must be at least ${money(minimum)} per kg.`);
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await mobileApi.bid(selectedAuction.auction.id, amount);
      setSelectedAuction(null);
      setBidAmount('');
      setMessage(`Your ${money(amount)}/kg bid was submitted.`);
      await load();
    } catch (bidError) {
      setError(bidError.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Page title="Fresh from the coast." subtitle="Browse direct-sale catches and live auctions from local fishermen." onRefresh={() => { setRefreshing(true); load(); loadTrends(); }} refreshing={refreshing}>
      {message ? <Notice type="success">{message}</Notice> : null}
      {error ? <Notice>{error}</Notice> : null}
      <View style={styles.stats}>
        <Stat label="Available catches" value={listings.length} />
        <Stat label="Live auctions" value={listings.filter(item => item.saleMode === 'bid' && item.auction?.status === 'active').length} />
      </View>
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
        const closed = item.saleMode === 'bid' && ['completed', 'cancelled'].includes(item.auction?.status);
        return (
          <ListingCard
            key={item.id}
            item={item}
            detail={item.description}
            actions={item.saleMode === 'bid'
              ? <Button label={closed ? 'Auction ended' : 'Place a bid'} disabled={closed} onPress={() => {
                const next = Number(item.auction?.currentPrice || item.auction?.startPrice || item.expectedPrice || 0) + Number(item.auction?.minimumIncrement || 10);
                setSelectedAuction(item);
                setBidAmount(String(next));
              }} />
              : <Button label="Buy now" onPress={() => Alert.alert('Secure checkout', 'Payment checkout is not yet available in the mobile app. Open TideMarket on the web to complete a purchase.')} />}
          />
        );
      })}
      <Modal visible={Boolean(selectedAuction)} transparent animationType="slide" onRequestClose={() => setSelectedAuction(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Place your bid</Text>
            <Text style={styles.modalSubtitle}>{selectedAuction?.fishType} · minimum {money(Number(selectedAuction?.auction?.currentPrice || selectedAuction?.auction?.startPrice || selectedAuction?.expectedPrice || 0) + Number(selectedAuction?.auction?.minimumIncrement || 10))}/kg</Text>
            <Field label="Your bid per kg (₹)" value={bidAmount} onChangeText={setBidAmount} placeholder="Enter your bid" keyboardType="decimal-pad" autoCapitalize="none" />
            {error ? <Notice>{error}</Notice> : null}
            <View style={styles.modalActions}>
              <Button label="Cancel" variant="secondary" onPress={() => { setSelectedAuction(null); setError(''); }} />
              <Button label="Submit bid" onPress={submitBid} loading={submitting} />
            </View>
          </View>
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
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      setHistory(await mobileApi.buyerHistory());
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { Promise.resolve().then(load); }, [load]);

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
          </Card>
        ))}
      </> : null}
    </Page>
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
  modalCard: { padding: 20, borderRadius: 18, backgroundColor: colors.white, gap: 14 },
  modalTitle: { color: colors.ink, fontSize: 20, fontWeight: '800' },
  modalSubtitle: { color: colors.muted, fontSize: 12 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  historyRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  historyCopy: { flex: 1, gap: 4 },
  historyValue: { alignItems: 'flex-end', gap: 5 },
  historyName: { color: colors.ink, fontSize: 14, fontWeight: '800' },
  status: { color: colors.sea, fontSize: 10, fontWeight: '700', textTransform: 'capitalize' }
});
