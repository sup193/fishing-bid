import { useCallback, useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, Card, Chip, Empty, Field, Loading, Notice, Page, SectionTitle, Stat, colors } from '../components/common';
import { mobileApi } from '../../api';
import { useAuth } from '../auth/AuthContext';

const periods = ['daily', 'weekly', 'monthly'];
const categories = ['Fish', 'Prawns', 'Crab', 'Squid', 'Shellfish', 'Lobster'];
const quantity = value => value === null || value === undefined ? 'Unavailable' : `${Number(value).toLocaleString()} kg`;
const displayPeriod = value => value[0].toUpperCase() + value.slice(1);

function DemandChart({ data }) {
  const [period, setPeriod] = useState('daily');
  const points = (data?.demandHistory?.[period] || []).slice(-30);
  const max = Math.max(1, ...points.map(item => Number(item.quantityKg) || 0));
  return (
    <Card>
      <SectionTitle title="Historical verified demand" detail="Kilograms sold" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {periods.map(item => <Chip key={item} label={displayPeriod(item)} selected={period === item} onPress={() => setPeriod(item)} />)}
      </ScrollView>
      {points.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.chart} accessibilityLabel={`${period} demand chart`}>
          {points.map(point => {
            const value = Number(point.quantityKg) || 0;
            return (
              <View key={point.date || point.period} style={styles.chartColumn}>
                <View style={styles.barTrack}><View style={[styles.bar, { height: `${Math.max(value ? 5 : 1, value / max * 100)}%` }]} /></View>
                <Text style={styles.dateLabel}>{String(point.date || point.period).slice(-5)}</Text>
              </View>
            );
          })}
        </ScrollView>
      ) : <Text style={styles.muted}>No verified sales are available for this period.</Text>}
    </Card>
  );
}

function ForecastCards({ species, fisherman = false, admin = false }) {
  if (!species?.length) return <Empty>No verified sales are available to forecast. Listings and bids are not treated as sales.</Empty>;
  return species.slice(0, admin ? 20 : 6).map(item => {
    const week = item.forecast?.next7Days;
    return (
      <Card key={item.fishType}>
        <View style={styles.speciesHeader}>
          <Text style={styles.speciesTitle}>{item.fishType}</Text>
          <Text style={[styles.badge, week?.demandCategory === 'High' ? styles.highBadge : week?.demandCategory === 'Low' ? styles.lowBadge : null]}>{week?.demandCategory || 'Insufficient data'}</Text>
        </View>
        <Text style={styles.detail}>Next 24 hours: {quantity(item.forecast?.next24Hours?.expectedQuantityKg)}</Text>
        <Text style={styles.detail}>Next 7 days: {quantity(week?.expectedQuantityKg)} · {week?.confidence || 'insufficient_data'} confidence</Text>
        <Text style={styles.detail}>Next 30 days: {quantity(item.forecast?.next30Days?.expectedQuantityKg)}</Text>
        <Text style={styles.detail}>Trend: {item.trend?.direction || 'Insufficient data'}{item.trend?.changePercent === null || item.trend?.changePercent === undefined ? '' : ` · ${item.trend.changePercent}%`}</Text>
        <Text style={styles.detail}>Demand index: {week?.demandIndex === null || week?.demandIndex === undefined ? 'unavailable' : `${week.demandIndex}% of baseline`}</Text>
        {item.bestSellingPeriod ? <Text style={styles.detail}>Historically strongest: {item.bestSellingPeriod.weekday} · {quantity(item.bestSellingPeriod.historicalAverageKg)} average</Text> : null}
        {fisherman ? <Text style={styles.advisory}>{item.recommendation?.suggestedListingKg
          ? `Advisory: consider listing up to ${quantity(item.recommendation.suggestedListingKg)} of your recorded ${quantity(item.recommendation.availableCatchKg)} catch.`
          : item.recommendation?.explanation || 'No quantity recommendation is available.'}</Text> : null}
        {admin ? <Text style={styles.detail}>{item.saleCount} verified sales · {item.marketActivity?.activeListings || 0} active listings · {item.marketActivity?.auctionBidCount || 0} bids</Text> : null}
      </Card>
    );
  });
}

function CategoryInsights({ species = [] }) {
  const grouped = new Map();
  for (const item of species) {
    const category = grouped.get(item.category) || { quantityKg: 0, varieties: 0 };
    category.quantityKg += Number(item.totalQuantityKg) || 0;
    category.varieties += 1;
    grouped.set(item.category, category);
  }
  if (!grouped.size) return null;
  return (
    <Card>
      <SectionTitle title="Popular seafood categories" />
      {[...grouped].sort((left, right) => right[1].quantityKg - left[1].quantityKg).slice(0, 5).map(([category, summary]) => (
        <Text key={category} style={styles.detail}>{category} · {quantity(summary.quantityKg)} · {summary.varieties} varieties</Text>
      ))}
    </Card>
  );
}

export function FishermanDemandScreen() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setError('');
    try {
      setData(await mobileApi.fishermanDemand());
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);
  useEffect(() => { Promise.resolve().then(load); }, [load]);
  return (
    <Page title="AI demand forecasting" subtitle={`Verified marketplace demand${user?.location ? ` near ${user.location}` : ''}. Recommendations are advisory only.`} onRefresh={() => { setRefreshing(true); load(); }} refreshing={refreshing}>
      {error ? <Notice>{error}</Notice> : null}
      {loading ? <Loading label="Loading verified demand…" /> : null}
      {data ? <>
        <View style={styles.stats}>
          <Stat label="Verified sales" value={data.totals?.verifiedSales ?? 0} />
          <Stat label="Historical quantity" value={quantity(data.totals?.historicalQuantityKg)} />
          <Stat label="Recommended varieties" value={data.recommendations?.length || 0} />
        </View>
        <Card>
          <Text style={styles.modelTitle}>{data.model?.name || 'Weighted moving average'} · {data.model?.version}</Text>
          <Text style={styles.detail}>Based on {data.model?.trainingData || 'verified paid order quantities only'} · {data.dataAvailability?.verifiedSaleCount || 0} recorded sales</Text>
          <Text style={styles.advisory}>{data.disclaimer} Recommendations do not create listings or change your selected prices or quantities.</Text>
        </Card>
        <DemandChart data={data} />
        <CategoryInsights species={data.species} />
        <SectionTitle title="Forecasts and listing suggestions" detail={`${data.species?.length || 0} species`} />
        <ForecastCards species={data.species} fisherman />
        <SectionTitle title="Demand by landing area" />
        {data.locationBreakdown?.length ? data.locationBreakdown.slice(0, 10).map(item => (
          <Card key={item.location}><Text style={styles.speciesTitle}>{item.location}</Text><Text style={styles.detail}>{quantity(item.quantityKg)} · {item.saleCount} verified sales · {item.fishTypes} varieties</Text></Card>
        )) : <Empty>No aggregated location data is available yet.</Empty>}
      </> : null}
    </Page>
  );
}

export function BuyerDemandScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const [data, setData] = useState(null);
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setError('');
    try {
      const [insights, market] = await Promise.all([mobileApi.buyerDemand(), mobileApi.listings()]);
      setData(insights);
      setListings(market);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);
  useEffect(() => { Promise.resolve().then(load); }, [load]);
  return (
    <Page title="Trending fish & demand" subtitle={`Aggregated verified sales insights${user?.location ? ` for ${user.location}` : ''}.`} onRefresh={() => { setRefreshing(true); load(); }} refreshing={refreshing}>
      {error ? <Notice>{error}</Notice> : null}
      {loading ? <Loading label="Loading demand insights…" /> : null}
      {data ? <>
        <Card>
          <Text style={styles.modelTitle}>Verified marketplace signals</Text>
          <Text style={styles.detail}>{data.totals?.verifiedSales || 0} sales · {quantity(data.totals?.historicalQuantityKg)} recorded over the selected history</Text>
          <Text style={styles.advisory}>{data.disclaimer}</Text>
        </Card>
        <DemandChart data={data} />
        <CategoryInsights species={data.species} />
        <SectionTitle title="Popular and trending seafood" />
        {!data.species?.length && !loading ? <Empty>No verified paid sales are available for your area yet.</Empty> : data.species?.slice(0, 8).map(item => {
          const available = listings.filter(listing => listing.fishType === item.fishType && ['available', 'auction'].includes(listing.status));
          return (
            <Card key={item.fishType}>
              <Text style={styles.speciesTitle}>{item.fishType} · {item.forecast?.next7Days?.demandCategory || 'Insufficient data'} demand</Text>
              <Text style={styles.detail}>Next 7 days: {quantity(item.forecast?.next7Days?.expectedQuantityKg)} · {item.trend?.direction || 'Insufficient data'}</Text>
              <Text style={styles.detail}>{available.length ? `${available.length} matching catches currently available` : 'No matching catch currently available'}</Text>
              {available.length ? <Button label="Explore matching catches" compact onPress={() => router.push({ pathname: '/buyer', params: { fishType: item.fishType } })} /> : null}
            </Card>
          );
        })}
        <SectionTitle title="Popular landing locations" />
        {data.locationBreakdown?.length ? data.locationBreakdown.slice(0, 8).map(item => (
          <Card key={item.location}><Text style={styles.speciesTitle}>{item.location}</Text><Text style={styles.detail}>{quantity(item.quantityKg)} · {item.saleCount} verified sales</Text></Card>
        )) : <Empty>No aggregated location trends are available.</Empty>}
      </> : null}
    </Page>
  );
}

export function AdminDemandScreen() {
  const [data, setData] = useState(null);
  const [performance, setPerformance] = useState(null);
  const [filters, setFilters] = useState({ from: '', to: '', fishType: '', category: '', location: '' });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const setFilter = (key, value) => setFilters(current => ({ ...current, [key]: value }));
  const load = useCallback(async () => {
    setError('');
    try {
      const query = Object.fromEntries(Object.entries(filters).filter(([, value]) => value));
      const [insights, evaluated] = await Promise.all([mobileApi.adminDemandAnalytics(query), mobileApi.adminDemandPerformance()]);
      setData(insights);
      setPerformance(evaluated);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filters]);
  useEffect(() => { Promise.resolve().then(load); }, [load]);
  return (
    <Page title="AI demand analytics" subtitle="Aggregated verified order demand, regional activity, and walk-forward evaluation." onRefresh={() => { setRefreshing(true); load(); }} refreshing={refreshing}>
      {error ? <Notice>{error}</Notice> : null}
      {loading ? <Loading label="Loading marketplace demand analytics…" /> : null}
      <Card>
        <Field label="From (YYYY-MM-DD)" value={filters.from} onChangeText={value => setFilter('from', value)} placeholder="Optional start date" autoCapitalize="none" />
        <Field label="To (YYYY-MM-DD)" value={filters.to} onChangeText={value => setFilter('to', value)} placeholder="Optional end date" autoCapitalize="none" />
        <Field label="Fish species" value={filters.fishType} onChangeText={value => setFilter('fishType', value)} placeholder="Optional supported species" />
        <Field label="Location" value={filters.location} onChangeText={value => setFilter('location', value)} placeholder="Optional landing area" />
        <Text style={styles.filterLabel}>Category</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          <Chip label="All" selected={!filters.category} onPress={() => setFilter('category', '')} />
          {categories.map(value => <Chip key={value} label={value} selected={filters.category === value} onPress={() => setFilter('category', value)} />)}
        </ScrollView>
      </Card>
      {data ? <>
        <View style={styles.stats}>
          <Stat label="Verified sales" value={data.totals?.verifiedSales ?? 0} />
          <Stat label="Recorded quantity" value={quantity(data.totals?.historicalQuantityKg)} />
          <Stat label="Active listings" value={data.totals?.activeListingCount ?? 0} />
        </View>
        <Card>
          <Text style={styles.modelTitle}>Forecast performance · {performance?.status || 'not evaluated'}</Text>
          {performance?.metrics
            ? <Text style={styles.detail}>MAE {performance.metrics.maeKg} kg · MAPE {performance.metrics.mapePercent === null ? 'unavailable' : `${performance.metrics.mapePercent}%`} · sMAPE {performance.metrics.smapePercent}% · {performance.evaluatedDays} held-out days</Text>
            : <Text style={styles.detail}>Insufficient held-out data to report error metrics.</Text>}
          <Text style={styles.detail}>{performance?.method || 'Walk-forward one-day-ahead evaluation.'}</Text>
        </Card>
        <DemandChart data={data} />
        <SectionTitle title="Most demanded varieties" />
        <ForecastCards species={data.mostDemanded} admin />
        <SectionTitle title="Least demanded varieties" />
        <ForecastCards species={data.leastDemanded} admin />
        <SectionTitle title="Regional demand" />
        {data.locationBreakdown?.length ? data.locationBreakdown.slice(0, 15).map(item => (
          <Card key={item.location}><Text style={styles.speciesTitle}>{item.location}</Text><Text style={styles.detail}>{quantity(item.quantityKg)} · {item.saleCount} sales · {item.fishTypes} species</Text></Card>
        )) : <Empty>No aggregated location demand is available.</Empty>}
      </> : null}
      {data?.model?.version ? <Text style={styles.muted}>Model {data.model.version} · {data.dataAvailability?.status || 'unknown'} · {data.disclaimer}</Text> : null}
    </Page>
  );
}

const styles = {
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chips: { gap: 8, paddingVertical: 2 },
  chart: { minHeight: 125, alignItems: 'flex-end', gap: 5, paddingTop: 6 },
  chartColumn: { width: 31, height: 118, alignItems: 'center', justifyContent: 'flex-end', gap: 5 },
  barTrack: { width: 19, height: 93, justifyContent: 'flex-end', overflow: 'hidden', borderTopLeftRadius: 4, borderTopRightRadius: 4, backgroundColor: '#f0f5f2' },
  bar: { width: '100%', minHeight: 1, borderTopLeftRadius: 4, borderTopRightRadius: 4, backgroundColor: colors.sea },
  dateLabel: { color: colors.muted, fontSize: 8 },
  muted: { color: colors.muted, fontSize: 10, lineHeight: 15 },
  speciesHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  speciesTitle: { color: colors.ink, fontSize: 13, fontWeight: '800' },
  detail: { color: colors.muted, fontSize: 10, lineHeight: 15 },
  badge: { overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12, backgroundColor: '#fff3da', color: '#80621c', fontSize: 9, fontWeight: '800' },
  highBadge: { backgroundColor: '#e5f4e9', color: '#17633b' },
  lowBadge: { backgroundColor: '#fff0e9', color: '#a34a36' },
  advisory: { color: '#80621c', fontSize: 10, lineHeight: 15 },
  modelTitle: { color: colors.ink, fontSize: 13, fontWeight: '800' },
  filterLabel: { color: colors.muted, fontSize: 11, fontWeight: '700' }
};
