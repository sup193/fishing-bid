import { useEffect, useMemo, useState } from 'react';
import { Activity, ArrowUpRight, Fish, MapPin, RefreshCw, TrendingDown, TrendingUp } from 'lucide-react';
import { api } from './api.js';

const periods = [
  { key: 'daily', label: 'Daily' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'monthly', label: 'Monthly' }
];

const demandClass = value => String(value || '').toLowerCase().replace(/\s+/g, '-');
const quantityLabel = value => value === null || value === undefined ? 'Unavailable' : `${Number(value).toLocaleString()} kg`;

export default function DemandForecastPanel({ role, listings = [], onExploreFish }) {
  const [data, setData] = useState(null);
  const [performance, setPerformance] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [period, setPeriod] = useState('daily');
  const [filters, setFilters] = useState({ from: '', to: '', fishType: '', category: '', location: '' });
  const isAdmin = role === 'admin';
  const isFisherman = role === 'fisherman';

  useEffect(() => {
    let active = true;
    const load = async () => {
      setError('');
      setLoading(true);
      try {
        const query = Object.fromEntries(Object.entries(filters).filter(([, value]) => value));
        const insightsPromise = isAdmin
          ? api.adminDemandAnalytics(query)
          : isFisherman ? api.fishermanDemand() : api.buyerDemand();
        const [insights, evaluated] = isAdmin
          ? await Promise.all([insightsPromise, api.adminDemandPerformance()])
          : [await insightsPromise, null];
        if (active) {
          setData(insights);
          setPerformance(evaluated);
        }
      } catch (loadError) {
        if (active) setError(loadError.message);
      } finally {
        if (active) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    };
    load();
    return () => { active = false; };
  }, [filters, isAdmin, isFisherman, refreshKey]);

  const chart = useMemo(() => {
    const points = data?.demandHistory?.[period] || [];
    return points.slice(-30);
  }, [data, period]);
  const maxQuantity = Math.max(1, ...chart.map(point => Number(point.quantityKg) || 0));
  const species = data?.species || [];
  const options = data?.species || [];
  const availableLocations = data?.locationBreakdown || [];
  const categories = useMemo(() => {
    const groups = new Map();
    for (const item of species) {
      const current = groups.get(item.category) || { category: item.category, quantityKg: 0, sales: 0, species: 0 };
      current.quantityKg += Number(item.totalQuantityKg) || 0;
      current.sales += Number(item.saleCount) || 0;
      current.species += 1;
      groups.set(item.category, current);
    }
    return [...groups.values()].sort((left, right) => right.quantityKg - left.quantityKg);
  }, [species]);
  const title = isAdmin ? 'AI demand analytics' : isFisherman ? 'AI demand forecasting' : 'Trending fish & demand insights';
  const intro = isAdmin
    ? 'Aggregated verified order quantities, forecast trends, and historical error evaluation.'
    : isFisherman
      ? 'Use verified marketplace demand as an advisory when planning your next catch listing.'
      : 'Explore verified market trends and available catches popular in your area.';

  function setFilter(key, value) {
    setFilters(current => ({ ...current, [key]: value }));
  }

  return <section className={`panel demand-panel demand-panel-${role}`} aria-labelledby="demand-title">
    <div className="demand-heading">
      <div>
        <p className="kicker">{isAdmin ? 'MARKETPLACE ANALYTICS' : 'VERIFIED SALES SIGNAL'}</p>
        <h2 id="demand-title">{title}</h2>
        <p>{intro}</p>
      </div>
      <button className="demand-refresh" type="button" aria-label="Refresh demand insights" disabled={loading} onClick={() => {
        setRefreshing(true);
        setRefreshKey(value => value + 1);
      }}><RefreshCw size={15} className={refreshing ? 'demand-spinning' : ''} /> Refresh</button>
    </div>

    {isAdmin && <div className="demand-filters" aria-label="Demand analytics filters">
      <label>From<input type="date" value={filters.from} onChange={event => setFilter('from', event.target.value)} /></label>
      <label>To<input type="date" value={filters.to} onChange={event => setFilter('to', event.target.value)} /></label>
      <label>Species<select value={filters.fishType} onChange={event => setFilter('fishType', event.target.value)}><option value="">All species</option>{options.map(item => <option key={item.fishType}>{item.fishType}</option>)}</select></label>
      <label>Category<select value={filters.category} onChange={event => setFilter('category', event.target.value)}><option value="">All categories</option>{['Fish', 'Prawns', 'Crab', 'Squid', 'Shellfish', 'Lobster'].map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Location<select value={filters.location} onChange={event => setFilter('location', event.target.value)}><option value="">All locations</option>{availableLocations.map(item => <option key={item.location}>{item.location}</option>)}</select></label>
    </div>}

    {error && <p className="notice" role="alert">Demand insights could not be loaded: {error}</p>}
    {loading && <p className="empty" role="status">Loading verified demand data…</p>}
    {!loading && !error && data && <>
      <div className="demand-metrics">
        <article><span>Verified sales</span><strong>{data.totals?.verifiedSales ?? 0}</strong></article>
        <article><span>Recorded quantity</span><strong>{quantityLabel(data.totals?.historicalQuantityKg)}</strong></article>
        <article><span>Active listings</span><strong>{data.totals?.activeListingCount ?? 0}</strong></article>
        <article><span>Forecast method</span><strong>{data.model?.name || 'Baseline'}</strong></article>
      </div>
      <p className="demand-meta">Model {data.model?.version || '—'} · {data.model?.status === 'insufficient_data' ? 'insufficient data' : 'baseline forecast'}{data.filters?.location ? ` · ${data.filters.location}` : ''} · As of {data.asOf ? new Date(data.asOf).toLocaleString() : '—'}</p>

      {isAdmin && <div className="demand-performance">
        <div><strong>Forecast evaluation</strong><span>{performance?.status === 'evaluated' ? `${performance.evaluatedDays} held-out days` : 'Not enough held-out history'}</span></div>
        <p>{performance?.metrics
          ? `MAE ${performance.metrics.maeKg} kg · MAPE ${performance.metrics.mapePercent === null ? 'unavailable' : `${performance.metrics.mapePercent}%`} · sMAPE ${performance.metrics.smapePercent}%`
          : 'Rolling one-day-ahead results are shown only when enough history is available.'}</p>
      </div>}

      <div className="demand-chart-card">
        <div className="demand-chart-heading"><div><strong>Historical verified demand</strong><small>Zero-sale days are included; units are kilograms.</small></div>
          <div className="demand-period-tabs" role="group" aria-label="Demand chart period">{periods.map(item => <button key={item.key} type="button" aria-pressed={period === item.key} className={period === item.key ? 'active' : ''} onClick={() => setPeriod(item.key)}>{item.label}</button>)}</div>
        </div>
        {chart.length ? <div className="demand-chart" role="img" aria-label={`${period} verified demand chart`}>
          {chart.map(point => {
            const value = Number(point.quantityKg) || 0;
            return <div className="demand-chart-column" key={point.date || point.period} title={`${point.date || point.period}: ${value} kg`}>
              <span style={{ height: `${Math.max(value ? 5 : 1, value / maxQuantity * 100)}%` }} />
              <small>{String(point.date || point.period).slice(period === 'daily' ? 5 : 0, period === 'daily' ? 10 : 10)}</small>
            </div>;
          })}
        </div> : <p className="empty">No verified sale history is available for this period.</p>}
      </div>

      {data.dataAvailability?.status === 'insufficient_data' && <p className="demand-empty-note">There are no verified paid sales in the selected period. Forecasts are not generated from listings or bids, and no market history is fabricated.</p>}
      {!isAdmin && !!categories.length && <div className="demand-categories">
        <strong>Popular seafood categories</strong>
        <div>{categories.slice(0, 5).map(item => <span key={item.category}>{item.category} · {quantityLabel(item.quantityKg)} · {item.species} varieties</span>)}</div>
      </div>}
      {!!species.length && <div className="demand-species-grid">
        {species.slice(0, isAdmin ? 20 : 6).map(item => {
          const weekly = item.forecast?.next7Days;
          const trend = item.trend?.direction || 'Insufficient data';
          const matchingListings = listings.filter(listing => listing.fishType === item.fishType && ['available', 'auction'].includes(listing.status));
          return <article className="demand-species-card" key={item.fishType}>
            <div className="demand-species-heading"><span><Fish size={16} /> {item.fishType}</span><b className={`demand-badge demand-${demandClass(weekly?.demandCategory)}`}>{weekly?.demandCategory || 'Insufficient data'}</b></div>
            <div className="demand-forecast-values">
              <span>24 hours<strong>{quantityLabel(item.forecast?.next24Hours?.expectedQuantityKg)}</strong></span>
              <span>7 days<strong>{quantityLabel(weekly?.expectedQuantityKg)}</strong></span>
              <span>30 days<strong>{quantityLabel(item.forecast?.next30Days?.expectedQuantityKg)}</strong></span>
            </div>
            <div className="demand-trend-line">{trend === 'Increasing' ? <TrendingUp size={15} /> : trend === 'Decreasing' ? <TrendingDown size={15} /> : <Activity size={15} />}
              <span>{trend}{item.trend?.changePercent === null || item.trend?.changePercent === undefined ? '' : ` · ${item.trend.changePercent}%`}</span>
              <small>{weekly?.confidence || 'insufficient_data'} confidence</small>
            </div>
            <p className="demand-recommendation">Demand index: {weekly?.demandIndex === null || weekly?.demandIndex === undefined ? 'unavailable' : `${weekly.demandIndex}% of baseline`}</p>
            {isFisherman && <p className="demand-recommendation">{item.recommendation?.suggestedListingKg
              ? `Advisory: consider listing up to ${quantityLabel(item.recommendation.suggestedListingKg)} from your recorded ${quantityLabel(item.recommendation.availableCatchKg)} catch.`
              : item.recommendation?.explanation || 'No quantity recommendation is available.'}</p>}
            {!isFisherman && item.bestSellingPeriod && <p className="demand-recommendation">Historically strongest: {item.bestSellingPeriod.weekday} · {quantityLabel(item.bestSellingPeriod.historicalAverageKg)} average</p>}
            {isAdmin && <p className="demand-recommendation">{item.saleCount} verified sales · {item.marketActivity?.activeListings || 0} active listings · {item.marketActivity?.auctionBidCount || 0} bids</p>}
            {!isFisherman && !isAdmin && <div className="demand-available">
              <small>{matchingListings.length ? `${matchingListings.length} matching catches available` : 'No matching catch currently available'}</small>
              {onExploreFish && <button type="button" disabled={!matchingListings.length} onClick={() => onExploreFish(item.fishType)}>Explore catches <ArrowUpRight size={14} /></button>}
            </div>}
          </article>;
        })}
      </div>}

      {!!data.locationBreakdown?.length && <div className="demand-locations">
        <strong><MapPin size={15} /> Aggregated demand by landing area</strong>
        <div>{data.locationBreakdown.slice(0, isAdmin ? 20 : 5).map(item => <span key={item.location}>{item.location} · {quantityLabel(item.quantityKg)} / {item.saleCount} sales</span>)}</div>
      </div>}
      {isFisherman && <p className="demand-disclaimer">{data.disclaimer} Recommendations are advisory only and never create listings or change your chosen price or quantity.</p>}
      {!isFisherman && <p className="demand-disclaimer">{data.disclaimer}</p>}
    </>}
  </section>;
}
