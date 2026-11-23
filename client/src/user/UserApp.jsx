import { useEffect, useState } from 'react';
import { Activity, ArrowUpRight, BadgeCheck, BarChart3, Bell, CircleDollarSign, Clock3, Gavel, Heart, History, MapPin, MessageCircle, ReceiptText, Search, ShoppingBag, Sparkles, Trophy, Waves } from 'lucide-react';
import { Link, NavLink, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import TransactionHistory from '../TransactionHistory.jsx';
import { sampleImageFor, sampleImageForFishType } from '../fishImages.js';
import BuyerHistory from './BuyerHistory.jsx';
import PricePredictionTool, { PricePredictionSummary } from '../PricePredictionTool.jsx';
import DemandForecastPanel from '../DemandForecastPanel.jsx';

const fallback = [
  { id: 'demo-1', fishType: 'Tuna', quality: 'Premium', quantity: 100, location: 'Mangalore', expectedPrice: 380, salePrice: 380, saleMode: 'bid', status: 'auction', imageVerification: 'verified', description: 'Fresh morning catch.', auction: { id: 'demo-auction', startPrice: 380, currentPrice: 380, priceIncreasePercent: 0 } },
  { id: 'demo-2', fishType: 'Prawns', quality: 'Good', quantity: 65, location: 'Udupi', expectedPrice: 600, salePrice: 600, saleMode: 'sale', status: 'available', imageVerification: 'verified', description: 'Chilled prawns landed at sunrise.' }
];

const categories = [
  { name: 'Fish', image: '/images/category-fish-photo.jpe', matches: item => !['prawns', 'shrimp', 'crab', 'squid', 'squids', 'lobster', 'clam', 'clams', 'mussel', 'mussels', 'oyster', 'oysters', 'scallop', 'scallops', 'shellfish'].some(type => String(item.fishType || '').toLowerCase().includes(type)) },
  { name: 'Prawns', image: '/images/category-prawns-photo.jpe', matches: item => /prawn|shrimp/i.test(String(item.fishType || '')) },
  { name: 'Crab', image: '/images/category-crab-photo.jpe', matches: item => /crab/i.test(String(item.fishType || '')) },
  { name: 'Squid', image: '/images/category-squid-photo.png', matches: item => /squid/i.test(String(item.fishType || '')) },
  { name: 'Shellfish', image: '/images/category-shellfish-photo.jpe', matches: item => /clam|mussel|oyster|scallop|shellfish/i.test(String(item.fishType || '')) },
  { name: 'Lobster', image: '/images/category-lobster-photo.jpe', matches: item => /lobster/i.test(String(item.fishType || '')) }
];

function listingImage(item) {
  const image = sampleImageFor(item);
  if (image) return image;
  return categories.find(category => category.name === categoryFor(item))?.image || '/images/category-fish.svg';
}

function fallbackListingImage(item) {
  return sampleImageForFishType(item?.fishType)
    || categories.find(category => category.name === categoryFor(item))?.image
    || '/images/category-fish.svg';
}

function ListingPhoto({ item, className, alt }) {
  const source = listingImage(item);
  const fallback = fallbackListingImage(item);
  const genericFallback = '/images/category-fish.svg';
  const [imageSource, setImageSource] = useState(source);

  useEffect(() => setImageSource(source), [source]);

  const useFallback = () => {
    setImageSource(current => current === fallback ? genericFallback : fallback);
  };

  return <img
    className={className}
    src={imageSource}
    alt={alt}
    onError={imageSource === genericFallback ? undefined : useFallback}
  />;
}

const itemPrice = item => Number(item.saleMode === 'bid'
  ? item.auction?.currentPrice || item.auction?.startPrice || item.expectedPrice || 0
  : item.salePrice || item.expectedPrice || 0);

function priceGuide(item) {
  const low = Number(item.predictedLow);
  const high = Number(item.predictedHigh);
  return Number.isFinite(low) && low > 0 && Number.isFinite(high) && high >= low
    ? `₹${low.toLocaleString()}–₹${high.toLocaleString()}/kg`
    : null;
}

function categoryFor(item) {
  return categories.find(category => category.matches(item))?.name || 'Fish';
}

function storedWishlist(key) {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(saved) ? saved.filter(id => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function countdown(endTime, now) {
  if (!endTime) return 'End time unavailable';
  const remaining = new Date(endTime).getTime() - now;
  if (remaining <= 0) return 'Auction ended';
  const days = Math.floor(remaining / 86400000);
  const hours = Math.floor((remaining % 86400000) / 3600000);
  const minutes = Math.floor((remaining % 3600000) / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  return days ? `${days}d ${hours}h left` : `${hours}h ${minutes}m ${seconds}s left`;
}

function FishCard({ item, onSelect, onBid, isWishlisted, onToggleWishlist, now }) {
  const closed = item.saleMode === 'bid' && (item.auction?.status === 'completed' || (item.auction?.endTime && new Date(item.auction.endTime).getTime() <= now));
  const auction = item.saleMode === 'bid';
  const price = itemPrice(item);
  const guide = priceGuide(item);
  return <article className="market-product-card">
    <div className="market-product-visual">
      <ListingPhoto className="market-product-image" item={item} alt={item.imageUrl ? `${item.fishType} catch` : `${item.fishType} sample image`} />
      <span className={`market-product-mode${auction && !closed ? ' is-live' : ''}`}>{auction ? closed ? 'Auction ended' : 'Live auction' : 'Fixed price'}</span>
      <button className={`wishlist-button${isWishlisted ? ' is-saved' : ''}`} aria-label={isWishlisted ? `Remove ${item.fishType} from wishlist` : `Add ${item.fishType} to wishlist`} aria-pressed={isWishlisted} onClick={() => onToggleWishlist(item.id)}><Heart size={18} fill={isWishlisted ? 'currentColor' : 'none'} /></button>
    </div>
    <div className="market-product-body">
      {item.demo && <span className="market-practice-badge">Practice listing</span>}
      <div className="market-product-title">
        <div><span className="market-product-category">{categoryFor(item)}</span><h3>{item.fishType}</h3></div>
        <span className="market-freshness" title="Seller-reported quality grade; not an independent freshness or food-safety assessment."><BadgeCheck size={15} /><span><small>Seller quality</small>{item.quality || 'Not set'}</span></span>
      </div>
      <p className="market-seller">By {item.fisherman?.name || 'Local fisherman'}</p>
      <div className="market-product-facts">
        <span><MapPin size={14} /> {item.location || 'Location unavailable'}</span>
        <span><ShoppingBag size={14} /> {Number(item.quantity || 0).toLocaleString()} kg available</span>
      </div>
      {auction && <div className="market-auction-fact">
        <span><Clock3 size={14} /> {closed ? 'Auction closed' : countdown(item.auction?.endTime, now)}</span>
        <span><Gavel size={14} /> {Number(item.auction?.bidCount || 0) ? 'Highest bid' : 'Starting bid'} · ₹{price.toLocaleString()}/kg</span>
      </div>}
      <div className="market-product-price"><span>{auction ? Number(item.auction?.bidCount || 0) ? 'Current highest bid' : 'Starting bid' : 'Price per kg'}</span><strong>₹{price.toLocaleString()}<small>/kg</small></strong></div>
      {item.reputation && <div className="market-trust-badge">
        <span className={`reputation-badge reputation-${item.reputation.status === 'rated' ? item.reputation.level?.toLowerCase().replace(/\s+/g, '-') : 'unrated'}`}>
          {item.reputation.verified ? '✓ ' : ''}{item.reputation.level}
        </span>
        <small>{item.reputation.status === 'rated'
          ? `${item.reputation.score}/100 trust · ${item.reputation.averageRating?.toFixed(1) || '—'}★ · ${item.reputation.completedOrderCount} completed`
          : 'No verified order history yet'}</small>
      </div>}
      {guide && <p className="market-price-guide"><span>Indicative estimate</span><strong>{guide}</strong></p>}
      <div className="market-product-actions">
        <button className="market-details-button" onClick={() => onSelect(item)}>View details</button>
        <button className="market-buy-button" disabled={auction && closed} onClick={() => auction ? onBid(item) : onSelect(item)}>{auction ? closed ? 'Auction ended' : 'Place bid' : 'Buy now'}</button>
      </div>
    </div>
  </article>;
}

function MarketTrendChart({ data, loading, error, days, onDaysChange, fishType, onFishTypeChange, items, now }) {
  const points = data?.points || [];
  const totalsByFish = points.reduce((totals, point) => {
    totals[point.fishType] = (totals[point.fishType] || 0) + point.observations;
    return totals;
  }, {});
  const availableFish = Object.keys(totalsByFish).sort((a, b) => totalsByFish[b] - totalsByFish[a] || a.localeCompare(b));
  const selectedPoints = points.filter(point => fishType === 'all' || point.fishType === fishType);
  const pointsByDateSource = new Map();
  for (const point of selectedPoints) {
    const key = `${point.date}:${point.source}`;
    const group = pointsByDateSource.get(key) || { date: point.date, source: point.source, total: 0, observations: 0 };
    group.total += point.averagePrice * point.observations;
    group.observations += point.observations;
    pointsByDateSource.set(key, group);
  }
  const chartPoints = [...pointsByDateSource.values()].map(point => ({
    ...point,
    averagePrice: point.total / point.observations
  }));
  const dates = [...new Set(chartPoints.map(point => point.date))].sort();
  const pointByDateSource = new Map(chartPoints.map(point => [`${point.date}:${point.source}`, point]));
  const maxPrice = Math.max(0, ...chartPoints.map(point => point.averagePrice));
  const step = maxPrice <= 500 ? 100 : maxPrice <= 2000 ? 500 : maxPrice <= 5000 ? 1000 : 5000;
  const yMax = Math.max(step, Math.ceil(maxPrice / step) * step);
  const chart = { width: 840, height: 250, left: 62, right: 22, top: 18, bottom: 42 };
  const plotWidth = chart.width - chart.left - chart.right;
  const plotHeight = chart.height - chart.top - chart.bottom;
  const sources = [
    { key: 'auction', label: 'Auction bids', color: '#0b9a91' },
    { key: 'market', label: 'Fixed-price listings', color: '#f06b68' },
    { key: 'sales', label: 'Paid sales', color: '#8065df' }
  ];
  const dateLabel = value => new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const activeAuctions = items.filter(item => item.saleMode === 'bid' && item.auction?.status !== 'completed' && (!item.auction?.endTime || new Date(item.auction.endTime).getTime() > now));
  const activeBidCount = activeAuctions.reduce((total, item) => total + Number(item.auction?.bidCount || 0), 0);
  const paidSalesCount = points.filter(point => point.source === 'sales').reduce((total, point) => total + point.observations, 0);

  return <section className="market-trend-panel" aria-label="Auction and seafood sales trends">
    <div className="market-trend-heading">
      <div className="market-trend-title">
        <span className="market-trend-icon"><BarChart3 size={19} /></span>
        <div><p className="kicker">LIVE OCEAN MARKET PULSE</p><h2>Auction, market &amp; sales trends</h2><p>Compare auction bids, fixed-price listings, and verified paid sales per kg.</p></div>
      </div>
      <div className="market-trend-controls">
        <label><span>Period</span><select value={days} onChange={event => onDaysChange(Number(event.target.value))}><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option></select></label>
        {availableFish.length > 0 && <label><span>Seafood</span><select value={fishType} onChange={event => onFishTypeChange(event.target.value)}><option value="all">All seafood</option>{availableFish.map(type => <option key={type} value={type}>{type}</option>)}</select></label>}
      </div>
    </div>
    <div className="market-pulse-stats" aria-label="Current marketplace activity">
      <article><span>Available lots</span><strong>{items.length}</strong></article>
      <article><span>Live auctions</span><strong>{activeAuctions.length}</strong></article>
      <article><span>Bids on live auctions</span><strong>{activeBidCount}</strong></article>
      <article><span>Paid sales</span><strong>{paidSalesCount}</strong></article>
      {data?.generatedAt && <span className="market-pulse-updated">Updated {new Date(data.generatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>}
    </div>
    {error && <p className="notice market-trend-message">{error}</p>}
    {loading && <p className="empty market-trend-message">Loading recorded market prices…</p>}
    {!loading && !error && !chartPoints.length && <p className="empty market-trend-message">Trends will appear as fishermen list catches, buyers bid, and paid orders are recorded.</p>}
    {!loading && !error && chartPoints.length > 0 && <>
      <div className="market-trend-chart-wrap">
        <svg className="market-trend-chart" viewBox={`0 0 ${chart.width} ${chart.height}`} role="img" aria-label={`Daily auction bid, fixed-price listing, and paid sale averages over the last ${days} days`}>
          {[0, 1, 2, 3, 4].map(tick => {
            const value = yMax * tick / 4;
            const y = chart.top + plotHeight * (1 - tick / 4);
            return <g key={tick}>
              <line x1={chart.left} y1={y} x2={chart.width - chart.right} y2={y} className="trend-gridline" />
              <text x={chart.left - 10} y={y + 4} textAnchor="end" className="trend-axis-label">₹{Math.round(value).toLocaleString()}</text>
            </g>;
          })}
          {dates.map((date, dateIndex) => {
            const slotWidth = plotWidth / dates.length;
            const groupWidth = Math.min(slotWidth * .84, sources.length * 24);
            const seriesWidth = groupWidth / sources.length;
            const barWidth = Math.max(3, Math.min(20, seriesWidth - 2));
            const groupStart = chart.left + slotWidth * dateIndex + (slotWidth - groupWidth) / 2;
            return <g key={date}>
              {sources.map((source, seriesIndex) => {
                const point = pointByDateSource.get(`${date}:${source.key}`);
                if (!point) return null;
                const barHeight = Math.max(2, plotHeight * point.averagePrice / yMax);
                const x = groupStart + seriesIndex * seriesWidth + (seriesWidth - barWidth) / 2;
                const y = chart.top + plotHeight - barHeight;
                return <g key={source.key}>
                  <rect x={x} y={y} width={barWidth} height={barHeight} rx="5" fill={source.color} className="trend-bar">
                    <title>{`${source.label} · ${dateLabel(date)} · ₹${point.averagePrice.toLocaleString()}/kg · ${point.observations} ${point.observations === 1 ? 'observation' : 'observations'}`}</title>
                  </rect>
                </g>;
              })}
              {(dateIndex % Math.ceil(dates.length / 8) === 0 || dateIndex === dates.length - 1) && <text x={chart.left + slotWidth * dateIndex + slotWidth / 2} y={chart.height - 19} textAnchor="middle" className="trend-axis-label">{dateLabel(date)}</text>}
            </g>;
          })}
        </svg>
      </div>
      <div className="market-trend-legend">{sources.map(source => <span key={source.key}><i style={{ backgroundColor: source.color }} />{source.label}</span>)}</div>
      <p className="market-trend-footnote">Auction bars show each listing’s latest observed auction price (the starting bid until the first bid); fixed-price bars show listed prices. Paid-sale bars use verified Razorpay orders divided by order quantity. All prices are per kg.</p>
    </>}
  </section>;
}

export default function UserApp({ user, onAuth, view = 'market' }) {
  const navigate = useNavigate();
  const { id: listingId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const wishlistStorageKey = `tide_wishlist_${user?.id || 'guest'}`;
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(null);
  const [showBiddingGuide, setShowBiddingGuide] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState('success');
  const [bidAmount, setBidAmount] = useState('');
  const [automaticMax, setAutomaticMax] = useState('');
  const [automaticBudget, setAutomaticBudget] = useState('');
  const [automaticEnabled, setAutomaticEnabled] = useState(false);
  const [auctionInsights, setAuctionInsights] = useState(null);
  const [auctionInsightError, setAuctionInsightError] = useState('');
  const [auctionChat, setAuctionChat] = useState([]);
  const [auctionChatDraft, setAuctionChatDraft] = useState('');
  const [auctionChatError, setAuctionChatError] = useState('');
  const [auctionChatSending, setAuctionChatSending] = useState(false);
  const [bidLoading, setBidLoading] = useState(false);
  const [automaticLoading, setAutomaticLoading] = useState(false);
  const [liveAuctionError, setLiveAuctionError] = useState('');
  const [notifications, setNotifications] = useState([]);
  const [notificationError, setNotificationError] = useState('');
  const [checkout, setCheckout] = useState(null);
  const [transactionRefresh, setTransactionRefresh] = useState(0);
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [wishlist, setWishlist] = useState(() => storedWishlist(wishlistStorageKey));
  const [now, setNow] = useState(Date.now());
  const [trendDays, setTrendDays] = useState(7);
  const [trendFishType, setTrendFishType] = useState('all');
  const [trendData, setTrendData] = useState(null);
  const [trendLoading, setTrendLoading] = useState(true);
  const [trendError, setTrendError] = useState('');
  const [trendRefresh, setTrendRefresh] = useState(0);
  const [buyerHistory, setBuyerHistory] = useState(null);
  const [buyerHistoryLoading, setBuyerHistoryLoading] = useState(false);
  const [buyerHistoryError, setBuyerHistoryError] = useState('');
  const [recommendationCategory, setRecommendationCategory] = useState('All');
  const [recommendationBudget, setRecommendationBudget] = useState('');
  const [recommendationLocation, setRecommendationLocation] = useState('');
  const [recommendationQuality, setRecommendationQuality] = useState('');
  const [recommendationSaleMode, setRecommendationSaleMode] = useState('all');
  const [recommendationWishlistOnly, setRecommendationWishlistOnly] = useState(false);
  const [listingError, setListingError] = useState('');
  const [demandFishType, setDemandFishType] = useState(() => searchParams.get('fishType') || '');

  useEffect(() => {
    let active = true;
    const refreshListings = async () => {
      try {
        const listings = await api.listings();
        if (!active) return;
        setItems(listings);
        setListingError('');
      } catch (error) {
        if (!active) return;
        setListingError(error.message);
        setItems(current => current.length ? current : fallback);
      } finally {
        if (active) setLoading(false);
      }
    };
    refreshListings();
    const interval = window.setInterval(refreshListings, 30000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    let active = true;
    setTrendLoading(true);
    setTrendError('');
    api.marketTrends(trendDays)
      .then(data => { if (active) setTrendData(data); })
      .catch(error => { if (active) setTrendError(error.message); })
      .finally(() => { if (active) setTrendLoading(false); });
    return () => { active = false; };
  }, [trendDays, trendRefresh]);

  useEffect(() => {
    if (user?.role !== 'buyer') {
      setBuyerHistory(null);
      return undefined;
    }
    let active = true;
    setBuyerHistoryLoading(true);
    setBuyerHistoryError('');
    api.buyerHistory()
      .then(history => { if (active) setBuyerHistory(history); })
      .catch(error => { if (active) setBuyerHistoryError(error.message); })
      .finally(() => { if (active) setBuyerHistoryLoading(false); });
    return () => { active = false; };
  }, [user?.id, user?.role, transactionRefresh]);

  useEffect(() => {
    if (user?.role !== 'buyer') {
      setNotifications([]);
      return undefined;
    }
    let active = true;
    const refresh = async () => {
      try {
        const values = await api.notifications();
        if (active) {
          setNotifications(values);
          setNotificationError('');
        }
      } catch (error) {
        if (active) setNotificationError(error.message);
      }
    };
    refresh();
    const interval = window.setInterval(refresh, 15000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [user?.id, user?.role]);

  const selectedAuctionId = selected?.saleMode === 'bid' ? selected.auction?.id : null;
  useEffect(() => {
    if (!selectedAuctionId) {
      setLiveAuctionError('');
      setAutomaticEnabled(false);
      setAutomaticMax('');
      setAutomaticBudget('');
      setAuctionInsights(null);
      setAuctionChat([]);
      setAuctionChatDraft('');
      return undefined;
    }
    let active = true;
    const refresh = async () => {
      try {
        const detail = await api.auction(selectedAuctionId);
        if (!active) return;
        const updated = {
          ...detail.listing,
          auction: detail.auction,
          bids: detail.bids,
          activeBidderCount: detail.activeBidderCount
        };
        setSelected(current => current?.auction?.id === selectedAuctionId ? updated : current);
        setItems(current => current.map(item => item.id === updated.id ? updated : item));
        setLiveAuctionError('');
      } catch (error) {
        if (active) setLiveAuctionError(error.message);
      }
    };
    refresh();
    const interval = window.setInterval(refresh, 2500);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [selectedAuctionId]);

  useEffect(() => {
    if (!selectedAuctionId || user?.role !== 'buyer') return undefined;
    let active = true;
    api.automaticBiddingStatus(selectedAuctionId)
      .then(result => {
        if (!active) return;
        setAutomaticEnabled(result.enabled);
        setAutomaticMax(result.maxAmount ? String(result.maxAmount) : '');
        setAutomaticBudget(result.totalBudget ? String(result.totalBudget) : '');
      })
      .catch(error => {
        if (active) setLiveAuctionError(error.message);
      });
    return () => { active = false; };
  }, [selectedAuctionId, user?.id, user?.role]);

  useEffect(() => {
    if (!selectedAuctionId || user?.role !== 'buyer') {
      setAuctionInsights(null);
      setAuctionInsightError('');
      setAuctionChat([]);
      return undefined;
    }
    let active = true;
    api.auctionInsights(selectedAuctionId)
      .then(insights => { if (active) setAuctionInsights(insights); })
      .catch(error => { if (active) setAuctionInsightError(error.message); });
    const refreshChat = async () => {
      try {
        const chat = await api.auctionChat(selectedAuctionId);
        if (!active) return;
        setAuctionChat(chat);
        setAuctionChatError('');
      } catch (error) {
        if (active) setAuctionChatError(error.message);
      }
    };
    refreshChat();
    const interval = window.setInterval(refreshChat, 5000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [selectedAuctionId, user?.role]);

  useEffect(() => {
    const interval = window.setInterval(() => setTrendRefresh(value => value + 1), 30000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    setWishlist(storedWishlist(wishlistStorageKey));
  }, [wishlistStorageKey]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const locationOptions = [...new Set(items.map(item => item.location).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const priceHighlights = [...items].sort((a, b) => itemPrice(a) - itemPrice(b)).slice(0, 3);
  const visible = items.filter(item => {
    const category = categories.find(option => option.name === selectedCategory);
    return (selectedCategory === 'All' || category?.matches(item))
      && (!demandFishType || item.fishType === demandFishType);
  }).sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  const guestPreviewItems = visible.slice(0, 3);
  const activeAuctions = items.filter(item => item.saleMode === 'bid' && item.auction?.status !== 'completed' && (!item.auction?.endTime || new Date(item.auction.endTime).getTime() > now)).length;
  const landingLocations = new Set(items.map(item => item.location).filter(Boolean)).size;
  const purchaseCounts = [...(buyerHistory?.orders || []), ...(buyerHistory?.bids || [])].reduce((counts, activity) => {
    const fishType = String(activity.fishType || '').toLowerCase();
    if (fishType) counts[fishType] = (counts[fishType] || 0) + 1;
    return counts;
  }, {});
  const recommendedItems = items
    .filter(item => {
      const category = categories.find(option => option.name === recommendationCategory);
      return (recommendationCategory === 'All' || category?.matches(item))
        && (!recommendationBudget || itemPrice(item) <= Number(recommendationBudget))
        && (!recommendationLocation || item.location === recommendationLocation)
        && (!recommendationQuality || item.quality === recommendationQuality)
        && (recommendationSaleMode === 'all' || (recommendationSaleMode === 'auction' ? item.saleMode === 'bid' : item.saleMode !== 'bid'))
        && (!recommendationWishlistOnly || wishlist.includes(item.id));
    })
    .map(item => ({ item, historyMatches: purchaseCounts[String(item.fishType || '').toLowerCase()] || 0 }))
    .sort((a, b) => b.historyMatches - a.historyMatches || itemPrice(a.item) - itemPrice(b.item))
    .slice(0, 3);
  const freshCatchItems = visible.filter(item => item.saleMode !== 'bid' || item.auction?.status === 'completed' || (item.auction?.endTime && new Date(item.auction.endTime).getTime() <= now));
  const liveAuctionItems = visible.filter(item => item.saleMode === 'bid' && item.auction?.status !== 'completed' && (!item.auction?.endTime || new Date(item.auction.endTime).getTime() > now));
  const nearbyFishermen = [...items.reduce((fishermen, item) => {
    const name = item.fisherman?.name;
    if (!name) return fishermen;
    const id = item.fisherman.id || name;
    const fisherman = fishermen.get(id) || { id, name, locations: new Set(), listingCount: 0 };
    if (item.location) fisherman.locations.add(item.location);
    fisherman.listingCount += 1;
    fishermen.set(id, fisherman);
    return fishermen;
  }, new Map()).values()].slice(0, 4);
  const toggleWishlist = id => setWishlist(current => {
    const next = current.includes(id) ? current.filter(itemId => itemId !== id) : [...current, id];
    localStorage.setItem(wishlistStorageKey, JSON.stringify(next));
    return next;
  });
  const resetAuctionContext = () => {
    setAuctionInsights(null);
    setAuctionInsightError('');
    setAuctionChat([]);
    setAuctionChatDraft('');
    setAuctionChatError('');
  };
  const openListing = listing => {
    setSelected(listing);
    setMessage('');
    setBidAmount('');
    resetAuctionContext();
    navigate(`/auctions/${encodeURIComponent(listing.id)}`);
  };
  const closeListing = () => {
    setSelected(null);
    if (listingId) navigate('/auctions');
  };
  useEffect(() => {
    if (!listingId || !items.length) return;
    const listing = items.find(item => item.id === listingId || item.auction?.id === listingId);
    if (listing && selected?.id !== listing.id) {
      setSelected(listing);
      resetAuctionContext();
    }
  }, [items, listingId, selected?.id]);
  const beginBid = item => {
    if (!user) return onAuth('login');
    openListing(item);
    setBidAmount(String(itemPrice(item) + Number(item.auction?.minimumIncrement || 1)));
    setMessage('');
  };
  const placeBid = async () => {
    if (!user) return onAuth('login');
    setBidLoading(true);
    try {
      await api.bid(selected.auction.id, Number(bidAmount), `bid-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
      setTransactionRefresh(value => value + 1);
      setMessageType('success');
      setMessage('Your bid is live.');
      setTrendRefresh(value => value + 1);
      const detail = await api.auction(selected.auction.id);
      const updated = { ...detail.listing, auction: detail.auction, bids: detail.bids, activeBidderCount: detail.activeBidderCount };
      setSelected(updated);
      setItems(current => current.map(item => item.id === updated.id ? updated : item));
    } catch (error) {
      setMessageType('error');
      setMessage(error.message);
    } finally {
      setBidLoading(false);
    }
  };

  const saveAutomaticBidding = async () => {
    if (!user) return onAuth('login');
    setAutomaticLoading(true);
    try {
      const amount = automaticMax ? Number(automaticMax) : null;
      const budget = automaticBudget ? Number(automaticBudget) : null;
      if ((!Number.isFinite(amount) || amount <= 0) && (!Number.isFinite(budget) || budget <= 0)) {
        throw new Error('Enter a maximum bid per kg or a total budget.');
      }
      await api.automaticBidding(
        selected.auction.id,
        amount,
        `auto-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        budget
      );
      setAutomaticEnabled(true);
      setMessageType('success');
      setMessage('Automatic bidding is active. Your maximum stays private.');
      setTransactionRefresh(value => value + 1);
    } catch (error) {
      setMessageType('error');
      setMessage(error.message);
    } finally {
      setAutomaticLoading(false);
    }
  };

  const sendAuctionMessage = async event => {
    event.preventDefault();
    if (!selectedAuctionId || !auctionChatDraft.trim()) return;
    setAuctionChatSending(true);
    try {
      const sent = await api.sendAuctionChat(selectedAuctionId, auctionChatDraft);
      setAuctionChat(current => [...current, sent].slice(-100));
      setAuctionChatDraft('');
      setAuctionChatError('');
    } catch (error) {
      setAuctionChatError(error.message);
    } finally {
      setAuctionChatSending(false);
    }
  };

  const toggleAutomaticBidding = async () => {
    if (!user) return onAuth('login');
    if (!automaticEnabled) return saveAutomaticBidding();
    setAutomaticLoading(true);
    try {
      await api.disableAutomaticBidding(selected.auction.id);
      setAutomaticEnabled(false);
      setMessageType('success');
      setMessage('Automatic bidding has been turned off.');
    } catch (error) {
      setMessageType('error');
      setMessage(error.message);
    } finally {
      setAutomaticLoading(false);
    }
  };

  const markNotificationRead = async notification => {
    try {
      await api.markNotificationRead(notification.id);
      setNotifications(current => current.map(item => item.id === notification.id ? { ...item, read: true } : item));
    } catch (error) {
      setNotificationError(error.message);
    }
  };

  const startPayment = async form => {
    if (!user) return onAuth('login');
    let payment;
    try {
      payment = await api.createPayment({
        ...(checkout.type === 'auction' ? { auctionId: selected.auction.id } : { listingId: selected.id }),
        address: form.address
      });
      setTransactionRefresh(value => value + 1);

      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.async = true;
      await new Promise((resolve, reject) => {
        if (window.Razorpay) return resolve();
        script.onload = resolve;
        script.onerror = () => reject(new Error('Could not load Razorpay Checkout. Check your internet connection and try again.'));
        document.body.appendChild(script);
      });
      const checkoutOptions = {
        key: payment.keyId,
        amount: payment.amount,
        currency: payment.currency,
        name: payment.name,
        description: payment.description,
        order_id: payment.gatewayOrderId,
        prefill: { name: user.name, email: user.email },
        theme: { color: '#f47a58' },
        handler: async result => {
          try {
            await api.verifyPayment({ transactionId: payment.transactionId, ...result });
            setTransactionRefresh(value => value + 1);
            setMessageType('success');
            setMessage(`Payment confirmed. Order ${payment.orderNumber} is being processed.`);
            setCheckout(null);
            closeListing();
          } catch (error) {
            setTransactionRefresh(value => value + 1);
            setMessageType('error');
            setMessage(error.message);
          }
        },
        modal: {
          ondismiss: async () => {
            try {
              await api.recordPaymentFailure({ transactionId: payment.transactionId, reason: 'Checkout was closed before payment completed' });
              setTransactionRefresh(value => value + 1);
              setMessageType('error');
              setMessage('Checkout closed. No payment was confirmed; you can retry from the listing.');
            } catch (error) {
              setMessageType('error');
              setMessage(error.message);
            }
          }
        }
      };
      const razorpay = new window.Razorpay(checkoutOptions);
      razorpay.on('payment.failed', async event => {
        try {
          await api.recordPaymentFailure({
            transactionId: payment.transactionId,
            reason: event.error?.description || 'Payment was not completed'
          });
          setTransactionRefresh(value => value + 1);
          setMessageType('error');
          setMessage(event.error?.description || 'Payment was not completed. You can retry checkout.');
        } catch (error) {
          setMessageType('error');
          setMessage(error.message);
        }
      });
      setCheckout(null);
      razorpay.open();
    } catch (error) {
      let displayError = error.message;
      if (payment?.transactionId) {
        try {
          await api.recordPaymentFailure({ transactionId: payment.transactionId, reason: 'Checkout could not be opened' });
        } catch (recordError) {
          displayError = `${displayError} Payment history update failed: ${recordError.message}`;
        }
      }
      setTransactionRefresh(value => value + 1);
      setMessageType('error');
      setMessage(displayError);
      throw new Error(displayError);
    }
  };

  const bidClosed = selected?.saleMode === 'bid' && (selected?.auction?.status === 'completed' || (selected?.auction?.endTime && new Date(selected.auction.endTime).getTime() <= now));
  const buyerView = user?.role === 'buyer';
  const currentView = view;
  const marketplaceView = currentView === 'market' || currentView === 'home';
  const routeListing = listingId ? items.find(item => item.id === listingId || item.auction?.id === listingId) : null;
  return <div className={`user-shell${buyerView ? ' buyer-dashboard' : ''}`}>
    {!user && currentView !== 'home' && <div className="guest-login-ticker">
      <div className="guest-login-ticker-window" role="status" aria-label="Log in to get more features and explore more products">
        <div className="guest-login-ticker-track" aria-hidden="true">
          <span>Log in to get more features and explore more products</span>
          <span>Log in to get more features and explore more products</span>
        </div>
      </div>
      <button className="guest-ticker-button" onClick={() => onAuth('login')}>Log in</button>
    </div>}
    {buyerView && <>
      {currentView === 'dashboard' && <section className="buyer-overview">
        <div className="buyer-welcome">
          <div>
            <p className="kicker">BUYER WORKSPACE</p>
            <h1>Welcome back, {user.name?.trim() || 'there'}.</h1>
            <p>Find today's catch, follow your bids, and keep track of every payment.</p>
          </div>
          <span className="buyer-live-pill"><span /> MARKET OPEN</span>
        </div>
        <div className="buyer-stat-grid">
          <article className="buyer-stat"><span>Available lots</span><strong>{loading ? '—' : items.length}</strong><small>Fresh catches listed</small></article>
          <article className="buyer-stat"><span>Live auctions</span><strong>{loading ? '—' : activeAuctions}</strong><small>Open for bidding</small></article>
          <article className="buyer-stat"><span>Landing locations</span><strong>{loading ? '—' : landingLocations}</strong><small>Coastal ports covered</small></article>
        </div>
      </section>}
      <nav className="buyer-dashboard-nav" aria-label="Buyer dashboard">
        <NavLink to="/dashboard" className={currentView === 'dashboard' ? 'active' : ''}><Activity size={17} /> Dashboard</NavLink>
        <NavLink to="/auctions" className={currentView === 'market' ? 'active' : ''}><Search size={17} /> Auctions</NavLink>
        <NavLink to="/demand" className={currentView === 'demand' ? 'active' : ''}><Activity size={17} /> Demand insights</NavLink>
        <NavLink to="/prices" className={currentView === 'prices' ? 'active' : ''}><BarChart3 size={17} /> Price estimate</NavLink>
        <NavLink to="/bids" className={currentView === 'history' ? 'active' : ''}><History size={17} /> Bids &amp; orders</NavLink>
        <NavLink to="/transactions" className={currentView === 'transactions' ? 'active' : ''}><ReceiptText size={17} /> Transactions</NavLink>
        <NavLink to="/notifications" className={currentView === 'notifications' ? 'active' : ''}><Bell size={17} /> Notifications</NavLink>
      </nav>
    </>}
    {buyerView && currentView === 'dashboard' && <main className="buyer-view buyer-dashboard-home">
      <div className="buyer-page-heading"><div><p className="kicker">YOUR WORKSPACE</p><h2>What would you like to do?</h2><p>Open a dedicated page to explore the marketplace and manage your activity.</p></div></div>
      <div className="buyer-home-cards">
        <Link to="/auctions"><Search size={21} /><strong>Explore auctions</strong><span>Browse seafood and live listings</span></Link>
        <Link to="/bids"><History size={21} /><strong>Bids &amp; orders</strong><span>Track bids and purchases</span></Link>
        <Link to="/transactions"><ReceiptText size={21} /><strong>Transactions</strong><span>Review your payment history</span></Link>
        <Link to="/notifications"><Bell size={21} /><strong>Notifications</strong><span>{notifications.filter(item => !item.read).length} unread updates</span></Link>
        <Link to="/prices"><BarChart3 size={21} /><strong>Price estimate</strong><span>Check current price guidance</span></Link>
        <Link to="/demand"><Activity size={21} /><strong>Demand insights</strong><span>See market demand outlook</span></Link>
        <Link to="/profile"><ShoppingBag size={21} /><strong>Your profile</strong><span>Review account information</span></Link>
      </div>
    </main>}
    {buyerView && currentView === 'notifications' && <main className="buyer-view" id="notifications">
      <div className="buyer-page-heading"><div><p className="kicker">STAY UP TO DATE</p><h2>Notifications</h2><p>Updates about your bids, auctions, and orders.</p></div><Bell size={23} /></div>
      {notificationError && <p className="notice" role="alert">{notificationError}</p>}
      <section className="buyer-notifications" aria-label="Auction notifications">
        <div className="buyer-notifications-heading"><Bell size={17} /><strong>Auction notifications</strong><span>{notifications.filter(item => !item.read).length} unread</span></div>
        {notifications.map(notification => <article className={`buyer-notification${notification.read ? ' is-read' : ''}`} key={notification.id}>
          <div><strong>{notification.title}</strong><p>{notification.message}</p><small>{new Date(notification.createdAt).toLocaleString()}</small></div>
          {!notification.read && <button type="button" onClick={() => markNotificationRead(notification)} aria-label={`Mark read: ${notification.title}`}>Mark read</button>}
        </article>)}
        {!notifications.length && !notificationError && <p className="empty">You’re all caught up. New auction and order updates will appear here.</p>}
      </section>
    </main>}
    {marketplaceView && !user && currentView === 'home' && <section className="guest-hero">
        <div className="guest-hero-copy">
          <span className="guest-eyebrow"><Waves size={15} /> TIDEMARKET · YOUR COASTAL MARKETPLACE</span>
          <h1>From Our Coast,<br /><em>Fresh to Your Table.</em></h1>
          <p>Discover responsibly sourced seafood, connect with local fishers, and bring the day’s finest catch straight to your table.</p>
          <div className="guest-hero-actions">
            <Link className="button guest-primary" to="/auctions">Explore auctions <ArrowUpRight size={18} /></Link>
            <button className="guest-secondary" onClick={() => setShowBiddingGuide(true)}>How bidding works</button>
          </div>
          <div className="guest-trust"><span><i /> Fresh catches, listed daily</span><span><i /> Fair trade, coast to coast</span></div>
        </div>
        <div className="guest-hero-art">
          <img className="guest-hero-image" src="/images/seafood-hero.svg" alt="Illustration of a fresh fish above ocean waves" />
          <div className="guest-market-status"><span className="guest-live-dot" /> MARKET PREVIEW <b>Fresh from the coast</b></div>
          <div className="guest-art-caption"><strong>Today's catch,<br />straight from the coast.</strong><span>Local fishermen · fair prices</span></div>
        </div>
      </section>}
    {marketplaceView && !user && currentView === 'home' && <section className="guest-home-benefits">
      <p className="kicker">FRESH, FAIR, CONNECTED</p><h2>A better way to buy from the coast.</h2>
      <p>TideMarket brings seafood buyers and local fishermen together in one easy-to-use marketplace.</p>
      <Link className="button guest-primary" to="/auctions">Browse the marketplace <ArrowUpRight size={18} /></Link>
    </section>}
    {marketplaceView && <>
      {user ? <section className="market buyer-market" id="market">
        {listingError && <p className="notice market-listing-error" role="status">Could not refresh marketplace listings: {listingError}. Showing the latest available listings.</p>}
        <section className="market-pulse-section" aria-label="Live market pulse">
          <MarketTrendChart
            data={trendData}
            loading={trendLoading}
            error={trendError}
            days={trendDays}
            onDaysChange={setTrendDays}
            fishType={trendFishType}
            onFishTypeChange={setTrendFishType}
            items={items}
            now={now}
          />
        </section>
        <section className="market-price-highlights" aria-label="Today's seafood price highlights">
          <div className="market-section-title"><div><p className="kicker">TODAY'S MARKET</p><h2>Seafood price highlights</h2></div><span>Prices shown per kg</span></div>
          <div className="market-price-grid">
            {loading ? <p className="empty">Loading today's prices…</p> : priceHighlights.length ? priceHighlights.map((item, index) => <article className="market-price-card" key={item.id}>
              <span className={`market-price-index market-price-index-${index + 1}`}>{index === 0 ? 'BEST PRICE' : item.saleMode === 'bid' ? 'LIVE BID' : 'FRESH CATCH'}</span>
              <div><strong>{item.fishType}</strong><span>{item.location || 'Coastal catch'}</span></div>
              <b>₹{itemPrice(item).toLocaleString()}<small>/kg</small></b>
            </article>) : <p className="empty">New catch prices will appear here as fishermen list seafood.</p>}
          </div>
        </section>
        <section className="seafood-categories" id="categories" aria-label="Seafood categories">
          <div className="market-section-title"><div><p className="kicker">PICK YOUR CATCH</p><h2>Shop by category</h2></div><button className={`category-all-button${selectedCategory === 'All' ? ' selected' : ''}`} onClick={() => setSelectedCategory('All')}>All seafood</button></div>
          <div className="seafood-category-grid">
            {categories.map(category => {
              const categoryListings = items.filter(category.matches);
              const categoryPhoto = categoryListings.find(item => item.imageUrl)?.imageUrl || category.image;
              const count = categoryListings.length;
              return <button key={category.name} className={`seafood-category-card${selectedCategory === category.name ? ' selected' : ''}`} aria-pressed={selectedCategory === category.name} onClick={() => setSelectedCategory(selectedCategory === category.name ? 'All' : category.name)}>
                <img src={categoryPhoto} alt="" onError={event => { event.currentTarget.onerror = null; event.currentTarget.src = category.image; }} />
                <span className="seafood-category-shade" aria-hidden="true" />
                <span className="seafood-category-topline"><span>FRESH FROM THE COAST</span><ArrowUpRight size={16} aria-hidden="true" /></span>
                <span className="seafood-category-copy"><strong>{category.name}</strong><small>{count} {count === 1 ? 'catch' : 'catches'} available</small></span>
              </button>;
            })}
          </div>
        </section>
        {buyerView && <section className="recommendation-panel" aria-label="Personalized seafood recommendations">
          <div className="recommendation-heading">
            <div><p className="kicker">PICKS FOR YOU</p><h2>Personalized Recommendations</h2><p>Preference-based suggestions use your seafood category, budget, and previous bids and orders.</p></div>
            <Sparkles size={22} aria-hidden="true" />
          </div>
          <div className="recommendation-controls">
            <label><span>Seafood preference</span><select value={recommendationCategory} onChange={event => setRecommendationCategory(event.target.value)}><option>All</option>{categories.map(category => <option key={category.name}>{category.name}</option>)}</select></label>
            <label><span>Maximum price per kg</span><input type="number" min="0" step="10" placeholder="Any budget" value={recommendationBudget} onChange={event => setRecommendationBudget(event.target.value)} /></label>
            <label><span>Location</span><select value={recommendationLocation} onChange={event => setRecommendationLocation(event.target.value)}><option value="">All locations</option>{locationOptions.map(location => <option key={location} value={location}>{location}</option>)}</select></label>
            <label><span>Seller-reported quality</span><select value={recommendationQuality} onChange={event => setRecommendationQuality(event.target.value)}><option value="">All grades</option>{[...new Set(items.map(item => item.quality).filter(Boolean))].map(quality => <option key={quality} value={quality}>{quality}</option>)}</select></label>
            <label><span>Sale type</span><select value={recommendationSaleMode} onChange={event => setRecommendationSaleMode(event.target.value)}><option value="all">Auction &amp; fixed price</option><option value="auction">Auction</option><option value="fixed">Fixed price</option></select></label>
            <label className="recommendation-wishlist-filter"><input type="checkbox" checked={recommendationWishlistOnly} onChange={event => setRecommendationWishlistOnly(event.target.checked)} /><Heart size={15} /> Wishlist only <span>{wishlist.length}</span></label>
          </div>
          {buyerHistoryError && <p className="notice recommendation-message" role="alert">Could not load your purchase and bidding history: {buyerHistoryError}</p>}
          {buyerHistoryLoading && <p className="empty recommendation-message">Finding catches that fit your preferences…</p>}
          {!buyerHistoryLoading && !buyerHistoryError && recommendedItems.length > 0 && <div className="recommendation-grid">
            {recommendedItems.map(({ item, historyMatches }) => <article className="recommendation-card" key={item.id}>
              <p>{historyMatches ? `Similar to seafood in your history (${historyMatches} ${historyMatches === 1 ? 'activity' : 'activities'})` : 'Matches your seafood preference and budget'}</p>
              <FishCard item={item} onSelect={openListing} onBid={beginBid} isWishlisted={wishlist.includes(item.id)} onToggleWishlist={toggleWishlist} now={now} />
            </article>)}
          </div>}
          {!buyerHistoryLoading && !buyerHistoryError && recommendedItems.length === 0 && <p className="empty recommendation-message">No available catches match these preferences. Try another category or a higher budget.</p>}
          <p className="recommendation-note">These are preference-based suggestions, not food-safety or freshness assessments.</p>
        </section>}
        {message && !selected && <p className={messageType === 'error' ? 'notice' : 'success-notice'}>{message}</p>}
        <section className="market-listing-section" aria-labelledby="fresh-catch-title">
          <div className="market-section-title"><div><p className="kicker">MARKET LISTINGS</p><h2 id="fresh-catch-title">Available Catch</h2></div><span>{freshCatchItems.length} available</span></div>
          {demandFishType && <p className="demand-filter-notice">Showing {demandFishType} from demand insights. <button type="button" onClick={() => { setDemandFishType(''); setSearchParams({}); }}>Clear filter</button></p>}
          <p className="market-section-description">Fixed-price catches and completed auction listings from local fishermen. Quality grades are seller-reported.</p>
          <div className="fish-grid">
            {loading ? <p className="empty">Scanning the morning catch...</p> : freshCatchItems.map(item => <FishCard key={item.id} item={item} onSelect={openListing} onBid={beginBid} isWishlisted={wishlist.includes(item.id)} onToggleWishlist={toggleWishlist} now={now} />)}
            {!loading && !freshCatchItems.length && <p className="empty buyer-no-results">No fresh catches are available in this category right now.</p>}
          </div>
        </section>
        <section className="market-listing-section" aria-labelledby="live-auctions-title">
          <div className="market-section-title"><div><p className="kicker">BID BEFORE THEY'RE GONE</p><h2 id="live-auctions-title">Live Auctions</h2></div><span>{liveAuctionItems.length} live</span></div>
          <p className="market-section-description">Follow current bids and place an offer before each auction closes.</p>
          <div className="fish-grid">
            {liveAuctionItems.map(item => <FishCard key={item.id} item={item} onSelect={openListing} onBid={beginBid} isWishlisted={wishlist.includes(item.id)} onToggleWishlist={toggleWishlist} now={now} />)}
            {!liveAuctionItems.length && <p className="empty buyer-no-results">No live auctions are available in this category right now.</p>}
          </div>
        </section>
        <p className="market-quality-disclaimer"><strong>Quality &amp; food safety:</strong> Grades are provided by sellers. AI image checks identify seafood species only; images and listing grades are not freshness estimates and do not replace proper food-safety inspection.</p>
        <section className="nearby-fishermen-section" aria-label="Nearby fishermen">
          <div className="market-section-title"><div><p className="kicker">LOCAL SELLERS</p><h2>Nearby Fishermen</h2></div><span>{nearbyFishermen.length} fishermen</span></div>
          <p className="market-section-description">Find fishermen with active catches at the landing locations listed in this marketplace.</p>
          {nearbyFishermen.length ? <div className="nearby-fishermen-grid">{nearbyFishermen.map(fisherman => <article className="nearby-fisherman-card" key={fisherman.id}>
            <span className="nearby-fisherman-avatar"><Waves size={19} /></span>
            <div><strong>{fisherman.name}</strong><span><MapPin size={13} /> {fisherman.locations.size ? [...fisherman.locations].join(', ') : 'Coastal location'}</span></div>
            <small>{fisherman.listingCount} {fisherman.listingCount === 1 ? 'catch' : 'catches'}</small>
          </article>)}</div> : <p className="empty">Fishermen will appear here when they publish available catches.</p>}
        </section>
      </section> : currentView === 'market' ? <section className="market guest-market" id="market">
        <>
        <MarketTrendChart
          data={trendData}
          loading={trendLoading}
          error={trendError}
          days={trendDays}
          onDaysChange={setTrendDays}
          fishType={trendFishType}
          onFishTypeChange={setTrendFishType}
          items={items}
          now={now}
        />
        <section className="guest-preview" id="featured-catches" aria-labelledby="guest-preview-title">
          <div className="market-section-title">
            <div><p className="kicker">A TASTE OF THE MARKET</p><h2 id="guest-preview-title">Featured catches</h2></div>
            <span>Preview up to 3 listings</span>
          </div>
          <p className="market-section-description">See what local fishermen are bringing in. Log in to browse every catch, compare prices, and join live auctions.</p>
          <div className="fish-grid guest-preview-grid">
            {loading ? <p className="empty">Loading featured catches…</p> : guestPreviewItems.map(item => <FishCard key={item.id} item={item} onSelect={openListing} onBid={beginBid} isWishlisted={wishlist.includes(item.id)} onToggleWishlist={toggleWishlist} now={now} />)}
            {!loading && !guestPreviewItems.length && <p className="empty buyer-no-results">New catches will appear here as local fishermen publish listings.</p>}
          </div>
        </section>
        </>
      </section> : null}
    </>}
    {buyerView && currentView === 'history' && <main className="buyer-view" id="history">
      <div className="buyer-page-heading"><div><p className="kicker">YOUR ACTIVITY</p><h2>Bids &amp; orders</h2><p>Review your auction activity and purchase status.</p></div><History size={23} /></div>
      <BuyerHistory key={transactionRefresh} />
    </main>}
    {buyerView && currentView === 'transactions' && <main className="buyer-view" id="transactions">
      <div className="buyer-page-heading"><div><p className="kicker">PAYMENT ACTIVITY</p><h2>Transactions</h2><p>View payment attempts and verified payment status.</p></div><CircleDollarSign size={23} /></div>
      <TransactionHistory key={transactionRefresh} title="Payment transactions" />
    </main>}
    {buyerView && currentView === 'prices' && <main className="buyer-view" id="prices">
      <div className="buyer-page-heading"><div><p className="kicker">MARKET GUIDANCE</p><h2>Fish price estimate</h2><p>Compare a transparent estimate and verified sale history when available.</p></div><BarChart3 size={23} /></div>
      <PricePredictionTool />
    </main>}
    {buyerView && currentView === 'demand' && <main className="buyer-view" id="demand">
      <DemandForecastPanel role="buyer" listings={items} onExploreFish={fishType => {
        setDemandFishType(fishType);
        setSelectedCategory('All');
        navigate(`/auctions?fishType=${encodeURIComponent(fishType)}`);
      }} />
    </main>}
    {showBiddingGuide && <div className="modal-backdrop bidding-guide-backdrop" onClick={() => setShowBiddingGuide(false)}>
      <section className="modal bidding-guide-modal" role="dialog" aria-modal="true" aria-labelledby="market-bidding-title" onClick={event => event.stopPropagation()}>
        <button className="close" aria-label="Close bidding guide" onClick={() => setShowBiddingGuide(false)}>×</button>
        <div className="bidding-guide-heading">
          <p className="kicker">SIMPLE, FAIR, TRANSPARENT</p>
          <h2 id="market-bidding-title">How Bidding Works</h2>
          <p>Found a catch you love? Here’s how to go from your first bid to fresh fish.</p>
        </div>
        <div className="bidding-steps">
          <article className="bidding-step"><span className="bidding-step-number">01</span><span className="bidding-step-icon"><Search size={19} /></span><h3>Choose a live catch</h3><p>Open a listing marked <strong>Live auction</strong> to see its starting and current price.</p></article>
          <article className="bidding-step"><span className="bidding-step-number">02</span><span className="bidding-step-icon"><Gavel size={19} /></span><h3>Place your bid</h3><p>Enter a price per kilogram higher than the current bid. You can bid again as the auction moves.</p></article>
          <article className="bidding-step"><span className="bidding-step-number">03</span><span className="bidding-step-icon"><ShoppingBag size={19} /></span><h3>Win, then check out</h3><p>When the fisherman closes bidding, the winning buyer can complete checkout and track the order.</p></article>
        </div>
      </section>
    </div>}
    {listingId && !routeListing && !loading && <main className="buyer-view auction-detail-page">
      <button className="back-button" type="button" onClick={closeListing}>← Back to auctions</button>
      <section className="panel auction-detail-content"><h1>Catch not found</h1><p>This auction or listing is no longer available.</p></section>
    </main>}
    {selected && listingId && (selected.id === listingId || selected.auction?.id === listingId) && <main className="buyer-view auction-detail-page">
      <button className="back-button" type="button" onClick={closeListing}>← Back to auctions</button>
      <section className={`panel auction-detail-content${selected.saleMode === 'bid' ? ' auction-detail-modal' : ''}`}>
        <ListingPhoto className="detail-photo" item={selected} alt={`${selected.fishType} catch`} />
        <p className="kicker">{selected.saleMode === 'bid' ? bidClosed ? 'BID CLOSED' : 'LIVE BIDDING' : 'DIRECT SALE'}</p>
        <h2>{selected.fishType}, {String(selected.quality || 'ungraded').toLowerCase()} seller grade</h2>
        <p>{selected.quantity} kg from {selected.location}. {selected.description || 'Listing details supplied by the fisherman.'}</p>
        {selected.saleMode === 'bid' && <p className="auction-seller">Fisherman: <strong>{selected.fisherman?.name || 'Local fisherman'}</strong></p>}
        <p className="quality-safety-note">The quality grade is seller-provided. Any AI image result identifies species only and does not estimate freshness or replace food-safety inspection.</p>
        {selected.fisherman?.reputation && <section className="listing-trust-detail" aria-label="Fisherman reputation">
          <div><strong>{selected.fisherman.name || 'Fisherman'}</strong><span className={`reputation-badge reputation-${selected.fisherman.reputation.status === 'rated' ? selected.fisherman.reputation.level?.toLowerCase().replace(/\s+/g, '-') : 'unrated'}`}>{selected.fisherman.reputation.verified ? '✓ Verified · ' : ''}{selected.fisherman.reputation.level}</span></div>
          <p>{selected.fisherman.reputation.status === 'rated'
            ? `${selected.fisherman.reputation.score}/100 trust · ${selected.fisherman.reputation.averageRating?.toFixed(1) || '—'} average rating · ${selected.fisherman.reputation.completedOrderCount} verified completed orders`
            : 'No verified completed orders yet; this is not a negative rating.'}</p>
        </section>}
        {selected.pricePrediction
          ? <PricePredictionSummary prediction={selected.pricePrediction} fishType={selected.fishType} />
          : priceGuide(selected) && <p className="quality-safety-note market-price-guide-note"><strong>Indicative price estimate: {priceGuide(selected)}.</strong> This is guidance only, not a guaranteed sale price or live market quote.</p>}
        {selected.saleMode === 'bid' && <>
          <div className="auction-live-summary">
            <article><span>Current highest bid</span><strong>₹{Number(selected.auction?.currentPrice || selected.auction?.startPrice || selected.expectedPrice).toLocaleString()}<small>/kg</small></strong></article>
            <article><span>Time remaining</span><strong>{countdown(selected.auction?.endTime, now)}</strong></article>
            <article><span>Active bidders</span><strong>{Number(selected.activeBidderCount || 0)}</strong></article>
            <article><span>Minimum increment</span><strong>₹{Number(selected.auction?.minimumIncrement || 0).toLocaleString()}/kg</strong></article>
          </div>
          <p className="auction-status-line">
            <span className={`auction-status-dot ${bidClosed ? 'is-closed' : ''}`} />
            Status: <strong>{selected.auction?.status || (bidClosed ? 'completed' : 'active')}</strong>
            {selected.auction?.currentBidder?.name && <> · Leading bidder: <strong>{selected.auction.currentBidder.name}</strong></>}
          </p>
          {Date.parse(selected.auction?.endTime) - now <= 5 * 60_000 && Date.parse(selected.auction?.endTime) > now
            && <p className="auction-closing-note"><Clock3 size={15} /> Closing soon. A valid bid in the final 30 seconds extends the auction by 30 seconds.</p>}
          {liveAuctionError && <p className="notice" role="alert">Live auction update unavailable: {liveAuctionError}</p>}
          {user?.role === 'buyer' && <section className="auction-ai-guide" aria-label="Auction guidance">
            <div className="auction-panel-heading"><h3><Sparkles size={16} /> Smart auction guide</h3><span>{auctionInsights?.confidence || 'Loading'}</span></div>
            {auctionInsightError && <p className="notice" role="alert">{auctionInsightError}</p>}
            {auctionInsights ? <>
              <p>Suggested next bid: <strong>₹{Number(auctionInsights.suggestedBidPerKg).toLocaleString()}/kg</strong>
                <button className="button small secondary" type="button" onClick={() => setBidAmount(String(auctionInsights.suggestedBidPerKg))}>Use suggestion</button>
              </p>
              <p>Estimated final range: <strong>₹{Number(auctionInsights.estimatedFinalPricePerKg.minimumPerKg).toLocaleString()}–₹{Number(auctionInsights.estimatedFinalPricePerKg.maximumPerKg).toLocaleString()}/kg</strong></p>
              <small>{auctionInsights.verifiedHistoricalAuctionCount
                ? `${auctionInsights.verifiedHistoricalAuctionCount} verified paid auction sales inform the estimate.`
                : 'No sufficient verified auction history; this range is a low-confidence bid-activity baseline.'}</small>
              {auctionInsights.priceEstimate && <small>Existing fish-price estimate: ₹{Number(auctionInsights.priceEstimate.minimumPerKg).toLocaleString()}–₹{Number(auctionInsights.priceEstimate.maximumPerKg).toLocaleString()}/kg ({auctionInsights.priceEstimate.reliability}).</small>}
              {auctionInsights.demand?.trend && <small>Demand outlook: {auctionInsights.demand.trend.direction} · {auctionInsights.demand.next7Days?.expectedQuantityKg ?? '—'} kg next 7 days, when available.</small>}
              <small>{auctionInsights.disclaimer}</small>
            </> : !auctionInsightError && <p className="form-hint">Loading market-based guidance…</p>}
          </section>}
          <section className="auction-bid-history" aria-label="Complete bid history">
            <div className="auction-panel-heading"><h3>Bid history</h3><span>{selected.bids?.length || 0} bids</span></div>
            {selected.bids?.length
              ? <div className="auction-bid-list">{selected.bids.map(bid => <article className="auction-bid-row" key={bid.id}>
                <span className="auction-bid-avatar">{String(bid.buyer?.name || 'B').trim().charAt(0).toUpperCase()}</span>
                <div><strong>{bid.buyer?.name || 'Buyer'}</strong><small>{new Date(bid.createdAt).toLocaleString()} · {bid.type === 'automatic' ? 'Automatic bid' : 'Manual bid'}</small></div>
                <strong>₹{Number(bid.amount).toLocaleString()}/kg</strong>
              </article>)}</div>
              : <p className="empty auction-empty">No bids yet. The starting price is ₹{Number(selected.auction?.startPrice || 0).toLocaleString()}/kg.</p>}
          </section>
          {user?.role === 'buyer' && <section className="auction-chat" aria-label="Auction chat">
            <div className="auction-panel-heading"><h3><MessageCircle size={16} /> Auction chat</h3><span>Visible to buyers and the fisherman</span></div>
            {auctionChatError && <p className="notice" role="alert">{auctionChatError}</p>}
            <div className="auction-chat-messages" aria-live="polite">
              {auctionChat.slice(-12).map(chat => <article className="auction-chat-message" key={chat.id}>
                <div><strong>{chat.authorName}</strong><small>{new Date(chat.createdAt).toLocaleTimeString()}</small></div>
                <p>{chat.content}</p>
                {!chat.isMine && <button type="button" onClick={async () => {
                  try { await api.reportAuctionMessage(selectedAuctionId, chat.id, 'Buyer report'); setAuctionChatError('Message sent to admin for review.'); }
                  catch (error) { setAuctionChatError(error.message); }
                }}>Report</button>}
              </article>)}
              {!auctionChat.length && !auctionChatError && <p className="empty">Ask a question about this catch.</p>}
            </div>
            {!bidClosed && <form className="auction-chat-form" onSubmit={sendAuctionMessage}>
              <input aria-label="Auction chat message" value={auctionChatDraft} maxLength={500} onChange={event => setAuctionChatDraft(event.target.value)} placeholder="Ask the fisherman a question…" />
              <button className="button secondary" disabled={auctionChatSending || !auctionChatDraft.trim()}>{auctionChatSending ? 'Sending…' : 'Send'}</button>
            </form>}
            <small>Keep messages on-platform; sharing contact details is not allowed.</small>
          </section>}
          {!bidClosed && user?.role === 'buyer' && <>
            <div className="auction-bid-form">
              <label htmlFor="manual-bid-amount">Manual bid (₹ per kg)</label>
              <div className="bid-box">
                <input id="manual-bid-amount" type="number" min={selected.auction?.minimumBid || Number(selected.auction?.currentPrice || 0) + Number(selected.auction?.minimumIncrement || 1)} step="0.01" placeholder="Enter your bid" value={bidAmount} onChange={event => setBidAmount(event.target.value)} />
                <button className="button primary" disabled={bidLoading || !bidAmount} onClick={placeBid}><Gavel size={17} /> {bidLoading ? 'Bidding…' : 'Place bid'}</button>
              </div>
            </div>
            <section className="automatic-bid-panel">
              <div className="automatic-bid-heading"><div><p className="kicker">BID ON YOUR BEHALF</p><h3>Automatic bidding</h3></div><label className="automatic-bid-toggle"><input type="checkbox" checked={automaticEnabled} onChange={toggleAutomaticBidding} disabled={automaticLoading} /><span>{automaticEnabled ? 'On' : 'Off'}</span></label></div>
              <p>We raise your bid only when needed and never above your private maximum.</p>
              <label htmlFor="automatic-bid-maximum">Your maximum bid (₹ per kg)</label>
              <input id="automatic-bid-maximum" type="number" min={selected.auction?.minimumBid || Number(selected.auction?.currentPrice || 0) + Number(selected.auction?.minimumIncrement || 1)} step="0.01" value={automaticMax} onChange={event => setAutomaticMax(event.target.value)} placeholder="Set your maximum" />
              <label htmlFor="automatic-bid-budget">Optional total budget for this catch (₹)</label>
              <input id="automatic-bid-budget" type="number" min="0.01" step="0.01" value={automaticBudget} onChange={event => setAutomaticBudget(event.target.value)} placeholder="Caps per-kg bids by quantity" />
              {automaticBudget && selected.quantity ? <small>At {Number(selected.quantity).toLocaleString()} kg, your total spend cap limits bidding to about ₹{(Number(automaticBudget) / Number(selected.quantity)).toLocaleString(undefined, { maximumFractionDigits: 2 })}/kg.</small> : null}
              <button className="button secondary full" type="button" disabled={automaticLoading || !(automaticMax || automaticBudget)} onClick={saveAutomaticBidding}>{automaticLoading ? 'Saving…' : automaticEnabled ? 'Update maximum bid' : 'Activate automatic bidding'}</button>
              <small>Your limits are private and are never shown to other buyers. Automatic bids never exceed your per-kg maximum or total budget.</small>
            </section>
          </>}
          {!bidClosed && user?.role !== 'buyer' && <button className="button primary full" onClick={() => onAuth('login')}>Log in to place a bid</button>}
        </>}
        {selected.saleMode === 'bid' && !bidClosed
          ? null
          : selected.saleMode === 'sale' && selected.status === 'available'
            ? <button className="button primary full" onClick={() => user ? setCheckout({ type: 'buyout' }) : onAuth('login')}><ShoppingBag size={17} /> Buy now · ₹{selected.salePrice || selected.expectedPrice}/kg</button>
            : bidClosed
              ? selected.auction?.winner && selected.auction.winner === user?.id
                ? <button className="button primary full" onClick={() => setCheckout({ type: 'auction' })}><Trophy size={17} /> Checkout winning bid</button>
                : <p className="form-hint">{selected.auction?.winner ? 'The auction is complete. Another buyer won this catch.' : 'The auction closed without bids.'}</p>
              : <p className="form-hint">Bidding has stopped. The winning buyer can complete checkout.</p>}
        {selected.imageVerification === 'verified' && <p className="verification">Image status marked complete · not a species, freshness, or food-safety check</p>}
        {message && <p className={messageType === 'success' ? 'success-notice' : 'notice'} role="status">{message}</p>}
      </section>
    </main>}
    {checkout && <CheckoutForm type={checkout.type} onClose={() => setCheckout(null)} onSubmit={startPayment} />}
  </div>;
}

function CheckoutForm({ type, onClose, onSubmit }) {
  const [address, setAddress] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const submit = async event => {
    event.preventDefault();
    setLoading(true);
    try {
      await onSubmit({ address });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };
  return <div className="modal-backdrop" onClick={onClose}>
    <div className="modal" onClick={event => event.stopPropagation()}>
      <button className="close" onClick={onClose}>×</button>
      <p className="kicker">{type === 'buyout' ? 'BUYOUT ORDER' : 'AUCTION CHECKOUT'}</p>
      <h2>Pay securely with Razorpay.</h2>
      <form onSubmit={submit}>
        <textarea name="address" placeholder="Delivery or pickup address" value={address} onChange={event => setAddress(event.target.value)} rows="3" required />
        {error && <p className="form-error">{error}</p>}
        <button className="button primary full" type="submit" disabled={loading}>{loading ? 'Preparing secure checkout…' : 'Continue to payment'}</button>
      </form>
    </div>
  </div>;
}
