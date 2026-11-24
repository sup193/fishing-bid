import { useEffect, useRef, useState } from 'react';
import { Activity, CheckCircle2, ClipboardList, Clock3, Fish, Gavel, ImagePlus, MessageCircle, PackageCheck, Plus, ShoppingBag, Trash2, XCircle } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { api } from '../api.js';
import BidMonitoring from '../BidMonitoring.jsx';
import TransactionHistory from '../TransactionHistory.jsx';
import { sampleImageFor, sampleImageForFishType } from '../fishImages.js';
import ReputationPanel from '../ReputationPanel.jsx';
import { PricePredictionSummary } from '../PricePredictionTool.jsx';
import DemandForecastPanel from '../DemandForecastPanel.jsx';
import useDialogAccessibility from '../useDialogAccessibility.js';

const emptyForm = { fishType: '', quantity: '', quality: 'Premium', size: 'Medium', freshness: 'fresh', location: '', expectedPrice: '', salePrice: '', description: '', imageUrl: '', storagePath: '', saleMode: 'sale', minimumIncrement: 10, endTime: '' };

export default function FishermanDashboard({ initialView = 'inventory', onViewChange }) {
  const [listings, setListings] = useState([]); const [sales, setSales] = useState([]); const [meta, setMeta] = useState({ fishTypes: [], qualities: [], sizes: [] }); const [form, setForm] = useState(emptyForm); const [mode, setMode] = useState(null); const [message, setMessage] = useState(''); const [error, setError] = useState(''); const [imageUploading, setImageUploading] = useState(false); const [reputation, setReputation] = useState(null); const [editingListing, setEditingListing] = useState(null); const [chatAuction, setChatAuction] = useState(null);
  const view = initialView;
  useEffect(() => {
    if (initialView === 'create-auction') {
      setForm({ ...emptyForm, saleMode: 'bid' });
      setMode('bid');
    } else if (initialView === 'create-listing') {
      setForm({ ...emptyForm, saleMode: 'sale' });
      setMode('sale');
    } else {
      setMode(null);
    }
  }, [initialView]);
  const loadListings = () => api.fishermanListings().then(setListings).catch(err => setError(err.message));
  const loadSales = () => api.fishermanSales().then(setSales).catch(err => setError(err.message));
  useEffect(() => {
    api.meta().then(setMeta).catch(err => setError(err.message));
    api.fishermanReputation().then(setReputation).catch(err => setError(err.message));
    loadListings();
    loadSales();
    const refresh = setInterval(() => { loadListings(); loadSales(); }, 30_000);
    return () => clearInterval(refresh);
  }, []);
  useEffect(() => {
    if (!chatAuction?.id) return undefined;
    let active = true;
    const refresh = () => api.auctionChat(chatAuction.id)
      .then(messages => { if (active) setChatAuction(current => current?.id === chatAuction.id ? { ...current, messages } : current); })
      .catch(chatError => { if (active) setError(chatError.message); });
    refresh();
    const interval = window.setInterval(refresh, 5000);
    return () => { active = false; window.clearInterval(interval); };
  }, [chatAuction?.id]);
  const activeAuctions = listings.filter(item => item.saleMode === 'bid' && item.auction?.status === 'active').length;
  const saleListings = listings.filter(item => item.saleMode !== 'bid');
  const biddingListings = listings.filter(item => item.saleMode === 'bid');
  const openListings = listings.filter(item => ['available', 'auction'].includes(item.status)).length;
  const pendingOrders = sales.filter(order => order.paymentStatus !== 'paid' && !['completed', 'cancelled'].includes(order.orderStatus)).length;
  const verifiedSales = sales.filter(order => order.paymentStatus === 'paid' && order.gateway === 'razorpay').reduce((total, order) => total + Number(order.amount || 0), 0);
  const updateForm = event => {
    const { name, value } = event.target;
    setForm(current => {
      if (name !== 'fishType') return { ...current, [name]: value };
      const currentSampleImage = sampleImageForFishType(current.fishType);
      const selectedSampleImage = sampleImageForFishType(value);
      const imageUrl = selectedSampleImage
        ? !current.imageUrl || current.imageUrl === currentSampleImage ? selectedSampleImage : current.imageUrl
        : current.imageUrl === currentSampleImage ? '' : current.imageUrl;
      return { ...current, fishType: value, imageUrl };
    });
  };
  const uploadImage = async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError('');
    setMessage('');
    setImageUploading(true);
    let prediction = null;
    let alternatives = [];
    let detectionError = null;
    try {
      const result = await api.detectFish(file);
      prediction = result.prediction;
      alternatives = result.alternatives || [];
    } catch (err) {
      detectionError = err;
    }
    try {
      const uploaded = await api.uploadFishImage(file);
      setForm(current => ({ ...current, imageUrl: uploaded.imageUrl, storagePath: uploaded.storagePath || '', fishType: prediction?.fish || current.fishType }));
      if (prediction) {
        const confidence = (prediction.confidence * 100).toFixed(1);
        const otherMatches = alternatives.map(item => `${item.fish} (${(item.confidence * 100).toFixed(1)}%)`).join(', ');
        setMessage(`Detected ${prediction.fish} (${confidence}% confidence). Please confirm the species before publishing.${otherMatches ? ` Other matches: ${otherMatches}.` : ''}`);
      } else {
        setError(`Photo uploaded. Species identification is unavailable; choose the species manually. ${detectionError?.message || ''}`);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setImageUploading(false);
      event.target.value = '';
    }
  };
  const submit = async event => { event.preventDefault(); setError(''); try { const expectedPrice = mode === 'bid' ? Number(form.expectedPrice) : Number(form.salePrice); const listing = await api.createListing({ ...form, saleMode: mode, expectedPrice, salePrice: Number(form.salePrice || expectedPrice), quantity: Number(form.quantity) }); if (mode === 'bid') await api.createAuction(listing.id, { startPrice: expectedPrice, minimumIncrement: Number(form.minimumIncrement), startTime: new Date().toISOString(), endTime: new Date(form.endTime).toISOString() }); setMessage(mode === 'bid' ? 'Bidding listing created.' : 'Sale listing created.'); setForm(emptyForm); setMode(null); onViewChange?.('inventory'); loadListings(); } catch (err) { setError(err.message); } };
  const closeBid = async id => { try { const result = await api.closeAuction(id); setMessage(result.winnerName ? `Bidding stopped. ${result.winnerName} won at ₹${Number(result.winningBid).toLocaleString()}/kg. Checkout is ready.` : 'Bidding stopped with no bids.'); loadListings(); loadSales(); } catch (err) { setError(err.message); } };
  const deleteListing = async id => { if (!window.confirm('Delete this fish listing?')) return; try { await api.deleteListing(id); setMessage('Listing deleted.'); loadListings(); } catch (err) { setError(err.message); } };
  const saveListingEdit = async (listing, changes) => {
    try {
      await api.updateListing(listing.id, changes);
      setMessage('Listing updated with a refreshed price estimate.');
      setEditingListing(null);
      loadListings();
    } catch (err) {
      setError(err.message);
    }
  };
  const progressOrder = async (order, status) => { setError(''); try { await api.updateOrderStatus(order.id, status); setMessage(`Order marked ${status}.`); loadSales(); api.fishermanReputation().then(setReputation).catch(err => setError(err.message)); } catch (err) { setError(err.message); } };
  const scheduleDelivery = async (order, date) => { const expectedDeliveryAt = Date.parse(`${date}T23:59:59`); if (!Number.isFinite(expectedDeliveryAt)) { setError('Choose an expected delivery date.'); return; } setError(''); try { await api.setDeliverySchedule(order.id, new Date(expectedDeliveryAt).toISOString()); setMessage('Expected delivery date saved.'); loadSales(); } catch (err) { setError(err.message); } };
  const startPost = () => onViewChange?.('create-listing');
  return <main className="dashboard fisherman-view">
    <section className="fisherman-hero">
      <div className="fisherman-hero-copy">
        <p className="kicker">FISHERMAN DECK <span className="fisherman-live-status"><i /> MARKET CONNECTED</span></p>
        <h1>Your catch,<br /><em>your terms.</em></h1>
        <p>Manage listings, follow live bids, and keep every buyer order moving from catch to coast.</p>
        <button className="button primary" onClick={startPost}><Plus size={17} /> Post a catch</button>
      </div>
      <div className="fisherman-hero-art" aria-hidden="true"><span><Fish size={45} /></span><i /><i /><i /></div>
    </section>
    {message && <p className="success-notice"><CheckCircle2 size={16} /> {message}</p>}
    {error && <p className="notice"><XCircle size={16} /> {error}</p>}
    <section className="fisherman-overview" aria-label="Fisherman business overview">
      <article><span className="fisherman-overview-icon"><PackageCheck size={18} /></span><small>Active listings</small><strong>{openListings}</strong><span>Catch lots open to buyers</span></article>
      <article><span className="fisherman-overview-icon"><Gavel size={18} /></span><small>Live auctions</small><strong>{activeAuctions}</strong><span>Listings receiving bids</span></article>
      <article><span className="fisherman-overview-icon"><Clock3 size={18} /></span><small>Orders to review</small><strong>{pendingOrders}</strong><span>Buyer orders not completed</span></article>
      <article><span className="fisherman-overview-icon"><Activity size={18} /></span><small>Verified sales</small><strong>₹{verifiedSales.toLocaleString()}</strong><span>Confirmed Razorpay payments</span></article>
    </section>
    <nav className="fisherman-tabs" aria-label="Fisherman dashboard sections">
      <NavLink to="/my-auctions" className={view === 'inventory' ? 'active' : ''}><Fish size={17} /> Inventory <b>{listings.length}</b></NavLink>
      <NavLink to="/orders" className={view === 'orders' ? 'active' : ''} onClick={loadSales}><ClipboardList size={17} /> Buyer orders <b>{sales.length}</b></NavLink>
      <NavLink to="/sales" className={view === 'sales' ? 'active' : ''} onClick={loadSales}><ShoppingBag size={17} /> Selling data <b>{sales.filter(order => order.paymentStatus === 'paid' || ['processing', 'completed', 'delivered'].includes(order.orderStatus)).length}</b></NavLink>
      <NavLink to="/reputation" className={view === 'reputation' ? 'active' : ''} onClick={() => api.fishermanReputation().then(setReputation).catch(err => setError(err.message))}><CheckCircle2 size={17} /> Reputation</NavLink>
      <NavLink to="/fisherman/demand" className={view === 'demand' ? 'active' : ''}><Activity size={17} /> Demand insights</NavLink>
      <NavLink to="/fisherman/bids" className={view === 'bids' ? 'active' : ''}><Gavel size={17} /> Bid history</NavLink>
      <NavLink to="/fisherman/transactions" className={view === 'transactions' ? 'active' : ''}><ClipboardList size={17} /> Transactions</NavLink>
    </nav>
    {view === 'transactions' && <TransactionHistory title="Fisherman transaction history" />}
    {view === 'reputation' && <ReputationPanel reputation={reputation} />}
    {view === 'demand' && <DemandForecastPanel role="fisherman" />}
    {view === 'bids' && <BidMonitoring title="Auction bid history & review" />}
    {view === 'orders' && <OrdersPage orders={sales} onStatus={progressOrder} onSchedule={scheduleDelivery} />}
    {view === 'sales' && <SalesPage orders={sales} />}
    {view === 'create-auction' && mode && <ListingForm mode={mode} form={form} meta={meta} imageUploading={imageUploading} onChange={updateForm} onImage={uploadImage} onSubmit={submit} onBack={() => onViewChange?.('inventory')} />}
    {view === 'create-listing' && mode && <ListingForm mode={mode} form={form} meta={meta} imageUploading={imageUploading} onChange={updateForm} onImage={uploadImage} onSubmit={submit} onBack={() => onViewChange?.('inventory')} />}
    {view === 'inventory' && <>
      <section className="fisherman-inventory-tools">
        <div><p className="kicker">YOUR CATCHES</p><h2>Inventory &amp; selling</h2><p>Choose how you want buyers to purchase your next catch.</p></div>
        <div className="fisherman-sell-actions">
          <button className="fisherman-sell-option" onClick={() => onViewChange?.('create-listing')}><ShoppingBag size={17} /><span><strong>Fixed price</strong><small>Sell directly</small></span></button>
          <button className="fisherman-sell-option auction" onClick={() => onViewChange?.('create-auction')}><Gavel size={17} /><span><strong>Start an auction</strong><small>Invite buyer bids</small></span></button>
        </div>
      </section>
      {editingListing && <ListingEditor listing={editingListing} onClose={() => setEditingListing(null)} onSave={saveListingEdit} />}
      <div className="fisherman-inventory-lists">
        <section className="catch-list inventory-sale-list">
          <div className="panel-title"><div className="inventory-list-heading"><span className="inventory-list-icon"><ShoppingBag size={17} /></span><span><p className="kicker">DIRECT SALES</p><h2>Fixed-price listings</h2></span></div><span className="inventory-list-count">{saleListings.length} {saleListings.length === 1 ? 'catch' : 'catches'}</span></div>
          {saleListings.map(item => <CatchRow key={item.id} item={item} onClose={closeBid} onDelete={deleteListing} onEdit={setEditingListing} />)}
          {!saleListings.length && <p className="empty inventory-empty">No fixed-price catches yet. Choose Fixed price to create one.</p>}
        </section>
        <section className="catch-list inventory-bid-list">
          <div className="panel-title"><div className="inventory-list-heading"><span className="inventory-list-icon"><Gavel size={17} /></span><span><p className="kicker">AUCTIONS</p><h2>Bidding listings</h2></span></div><span className="inventory-list-count">{biddingListings.length} {biddingListings.length === 1 ? 'catch' : 'catches'}</span></div>
          {biddingListings.map(item => <CatchRow key={item.id} item={item} onClose={closeBid} onDelete={deleteListing} onChat={item.auction ? setChatAuction : undefined} />)}
          {!biddingListings.length && <p className="empty inventory-empty">No bidding catches yet. Choose Start an auction to create one.</p>}
        </section>
      </div>
    </>}
    {chatAuction && <FishermanAuctionChat auction={chatAuction} onClose={() => setChatAuction(null)} onUpdated={messages => setChatAuction(current => current ? { ...current, messages } : current)} />}
  </main>;
}

function ListingForm({ mode, form, meta, imageUploading, onChange, onImage, onSubmit, onBack }) {
  const [prediction, setPrediction] = useState(null);
  const [predictionError, setPredictionError] = useState('');
  const [demand, setDemand] = useState(null);
  const [demandError, setDemandError] = useState(null);
  const sampleImage = sampleImageForFishType(form.fishType);
  const usingSampleImage = Boolean(sampleImage && form.imageUrl === sampleImage);
  useEffect(() => {
    if (!form.fishType || !form.quantity || Number(form.quantity) <= 0) {
      setPrediction(null);
      return undefined;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      api.previewPricePrediction({
        fishType: form.fishType,
        quantity: Number(form.quantity),
        quality: form.quality,
        size: form.size,
        freshness: form.freshness,
        location: form.location
      }).then(value => {
        if (active) {
          setPrediction(value);
          setPredictionError('');
        }
      }).catch(error => {
        if (active) {
          setPrediction(null);
          setPredictionError(error.message);
        }
      });
    }, 350);
    return () => { active = false; window.clearTimeout(timer); };
  }, [form.fishType, form.quantity, form.quality, form.size, form.freshness, form.location]);
  useEffect(() => {
    if (!form.fishType) return undefined;
    let active = true;
    const timer = window.setTimeout(() => {
      api.demandForecast({ fishType: form.fishType }).then(value => {
        if (active) {
          const insight = value.species?.[0] || null;
          setDemand(insight);
          setDemandError({ fishType: form.fishType, message: insight ? '' : 'No verified historical sales for this species or location.' });
        }
      }).catch(error => {
        if (active) {
          setDemand(null);
          setDemandError({ fishType: form.fishType, message: error.message });
        }
      });
    }, 350);
    return () => { active = false; window.clearTimeout(timer); };
  }, [form.fishType]);
  const selectedPrice = Number(mode === 'bid' ? form.expectedPrice : form.salePrice);
  const predictionLow = Number(prediction?.minimumPerKg);
  const predictionHigh = Number(prediction?.maximumPerKg);
  const currentDemand = demand?.fishType === form.fishType ? demand : null;
  const currentDemandError = demandError?.fishType === form.fishType ? demandError.message : '';
  const priceOutOfRange = selectedPrice > 0 && predictionLow > 0
    && (selectedPrice < predictionLow * 0.8 || selectedPrice > predictionHigh * 1.2);
  return <section className={`panel listing-page listing-page-${mode}`}>
    <button className="back-button" type="button" onClick={onBack}>← Back to selling options</button>
    <div className="listing-form-heading">
      <p className="kicker">{mode === 'bid' ? 'AUCTION SETUP' : 'DIRECT SALE SETUP'}</p>
      <h2>{mode === 'bid' ? 'Create a bidding listing.' : 'Create a fixed-price listing.'}</h2>
      <p>{mode === 'bid' ? 'Set your opening price and invite buyers to compete for your catch.' : 'Set a clear price and make your catch ready for buyers.'}</p>
    </div>
    <form className="listing-form" onSubmit={onSubmit}>
      <div className="listing-image-column">
        <label className="upload-field">
          <ImagePlus size={20} />
          <span>
            <strong>{imageUploading ? 'Checking and uploading photo…' : usingSampleImage ? `TideMarket ${form.fishType} photo selected` : form.imageUrl ? 'Photo ready · choose another' : 'Identify species & upload photo'}</strong>
            <small>{usingSampleImage ? 'Click to upload your own catch photo' : 'JPG, PNG or WEBP · up to 5 MB'}</small>
          </span>
          <input type="file" accept="image/jpeg,image/png,image/webp" onChange={onImage} disabled={imageUploading} required={!form.imageUrl} />
        </label>
        <p className="form-hint">{usingSampleImage ? `Using the supplied sample ${form.fishType} photo. Upload a photo of your own catch if it differs; this sample is not AI-verified.` : 'We’ll try to identify the species. Confirm the selected species before publishing.'}</p>
        {form.imageUrl && <img className="upload-preview" src={form.imageUrl} alt={usingSampleImage ? `Sample ${form.fishType} photo` : 'Uploaded photo of the catch'} />}
      </div>
      <div className="listing-fields-column">
        <p className="listing-section-label">Catch details</p>
        <div className="form-grid">
          <label className="listing-field"><span>Fish species</span><select name="fishType" value={form.fishType} onChange={onChange} required><option value="">Select species</option>{meta.fishTypes.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
          <label className="listing-field"><span>Seller-reported quality grade</span><select name="quality" value={form.quality} onChange={onChange}>{meta.qualities.map(value => <option key={value}>{value}</option>)}</select><small className="listing-grade-hint">Not AI-detected or independently inspected for freshness.</small></label>
          <label className="listing-field"><span>Catch size</span><select name="size" value={form.size} onChange={onChange}>{meta.sizes.map(value => <option key={value}>{value}</option>)}</select></label>
          <label className="listing-field"><span>Reported freshness</span><select name="freshness" value={form.freshness} onChange={onChange}><option value="same_day">Same-day</option><option value="fresh">Fresh</option><option value="chilled">Chilled</option><option value="frozen">Frozen</option></select></label>
          <label className="listing-field"><span>Quantity (kg)</span><input name="quantity" type="number" min="1" placeholder="e.g. 25" value={form.quantity} onChange={onChange} required /></label>
          <label className="listing-field"><span>Landing port</span><input name="location" placeholder="e.g. Mangalore" value={form.location} onChange={onChange} required /></label>
          <label className="listing-field"><span>{mode === 'bid' ? 'Starting bid / kg' : 'Sale price / kg'}</span>{mode === 'bid' ? <input name="expectedPrice" type="number" min="1" placeholder="₹ Starting bid" value={form.expectedPrice} onChange={onChange} required /> : <input name="salePrice" type="number" min="1" placeholder="₹ Price per kg" value={form.salePrice} onChange={onChange} required />}</label>
        </div>
        {predictionError && <p className="notice" role="status">Price estimate unavailable: {predictionError}</p>}
        {prediction && <PricePredictionSummary prediction={prediction} compact />}
        {currentDemandError && <p className="notice" role="status">Demand insight unavailable: {currentDemandError}</p>}
        {currentDemand && <div className="demand-listing-advisory"><strong>Verified demand · {currentDemand.forecast?.next7Days?.demandCategory || 'Insufficient data'}</strong><span>Next 7 days: {currentDemand.forecast?.next7Days?.expectedQuantityKg === null ? 'unavailable' : `${Number(currentDemand.forecast?.next7Days?.expectedQuantityKg).toLocaleString()} kg`} · {currentDemand.trend?.direction || 'Insufficient data'} trend</span><small>Market demand is advisory and will not change your chosen price or quantity.</small></div>}
        {priceOutOfRange && <p className="price-warning" role="status">Your selected price is more than 20% outside this indicative range. This is only a warning; your chosen price will not be changed.</p>}
        {mode === 'bid' && <fieldset className="listing-auction-settings">
          <legend>Auction settings</legend>
          <div className="form-grid">
            <label className="listing-field"><span>Minimum bid increase</span><input name="minimumIncrement" type="number" min="1" placeholder="₹ Minimum increase" value={form.minimumIncrement} onChange={onChange} required /></label>
            <label className="listing-field"><span>Auction end time</span><input name="endTime" type="datetime-local" value={form.endTime} onChange={onChange} required /></label>
          </div>
        </fieldset>}
        <label className="listing-field listing-description"><span>Catch notes <small>(optional)</small></span><textarea name="description" placeholder="Add helpful details about the catch. Avoid unsupported freshness or safety claims." value={form.description} onChange={onChange} /></label>
        <button className="button primary listing-publish-button" type="submit" disabled={imageUploading || !form.imageUrl}>Publish {mode === 'bid' ? 'bidding' : 'sale'} listing</button>
      </div>
    </form>
  </section>;
}
function CatchRow({ item, onClose, onDelete, onEdit, onChat }) {
  const auction = item.auction;
  const image = sampleImageFor(item);
  const low = Number(item.predictedLow);
  const high = Number(item.predictedHigh);
  const hasPriceGuide = Number.isFinite(low) && low > 0 && Number.isFinite(high) && high >= low;
  const canDelete = item.status === 'available' && !auction;
  const canClose = item.saleMode === 'bid' && item.status === 'auction' && ['active', 'scheduled'].includes(auction?.status);
  return <article className="catch-row">
    {image ? <img src={image} alt={item.imageUrl ? item.fishType : `${item.fishType} sample image`} /> : <div className="catch-placeholder"><Fish size={30} /></div>}
    <div className="catch-main">
      <div className="card-row"><h3>{item.fishType}</h3><span className="quality">{item.saleMode === 'bid' ? 'BID' : 'SALE'}</span></div>
      <p>{item.quantity} kg · Seller grade: {item.quality} · {item.location}</p>
      {item.saleMode === 'bid' && auction
        ? <div className="live-price">Initial ₹{auction.startPrice} · Current ₹{auction.currentPrice || auction.startPrice} · <b>+{auction.priceIncreasePercent || 0}%</b>{auction.status === 'completed' && auction.winner ? ' · Winner selected' : auction.status === 'completed' ? ' · Closed with no bids' : ''}</div>
        : <div className="live-price">Fixed sale ₹{item.salePrice || item.expectedPrice}/kg</div>}
      {hasPriceGuide && <div className="live-price">Indicative estimate ₹{low.toLocaleString()}–₹{high.toLocaleString()}/kg · {item.pricePrediction?.reliability || 'preliminary'}</div>}
      <div className="verification">{item.imageVerification === 'verified' ? <><CheckCircle2 size={14} /> Image status marked complete</> : item.imageUrl ? <><ImagePlus size={14} /> Photo uploaded · species not AI-checked</> : <><ImagePlus size={14} /> Photo needed</>}</div>
    </div>
    <div className="catch-side">
      <strong>₹{item.saleMode === 'bid' ? auction?.currentPrice || item.expectedPrice : item.salePrice || item.expectedPrice}<small>/kg</small></strong>
      {canClose && <button className="button small dark" onClick={() => onClose(auction.id)}>Stop bidding</button>}
      {auction && onChat && <button className="button small secondary" onClick={() => onChat({ id: auction.id, fishType: item.fishType, status: auction.status, endTime: auction.endTime, messages: [] })}><MessageCircle size={14} /> Chat</button>}
      {item.saleMode !== 'bid' && item.status === 'available' && <button className="button small secondary" onClick={() => onEdit(item)}>Edit listing</button>}
      {canDelete && <button className="icon-button danger" title="Delete listing" aria-label={`Delete ${item.fishType} listing`} onClick={() => onDelete(item.id)}><Trash2 size={17} /></button>}
    </div>
  </article>;
}

function FishermanAuctionChat({ auction, onClose, onUpdated }) {
  const dialogRef = useRef(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState('');
  useDialogAccessibility({ open: true, dialogRef, onClose, focusKey: auction.id });
  const submit = async event => {
    event.preventDefault();
    if (!draft.trim()) return;
    setSending(true);
    try {
      const sent = await api.sendAuctionChat(auction.id, draft);
      onUpdated([...(auction.messages || []), sent].slice(-100));
      setDraft('');
      setChatError('');
    } catch (error) {
      setChatError(error.message);
    } finally {
      setSending(false);
    }
  };
  return <div className="modal-backdrop" onClick={onClose}>
    <section ref={dialogRef} className="modal auction-chat-modal" role="dialog" aria-modal="true" aria-labelledby="fisherman-chat-title" onClick={event => event.stopPropagation()}>
      <button className="close" type="button" aria-label="Close auction chat" onClick={onClose}>×</button>
      <p className="kicker">BUYER CONVERSATION</p><h2 id="fisherman-chat-title">{auction.fishType} auction chat</h2>
      <p>Answer buyer questions about the catch. Contact details are blocked to keep communication on-platform.</p>
      {chatError && <p className="notice" role="alert">{chatError}</p>}
      <div className="auction-chat-messages">
        {(auction.messages || []).slice(-30).map(chat => <article className="auction-chat-message" key={chat.id}><div><strong>{chat.authorName}</strong><small>{new Date(chat.createdAt).toLocaleString()}</small></div><p>{chat.content}</p></article>)}
        {!auction.messages?.length && <p className="empty">No buyer questions yet.</p>}
      </div>
      {!['completed', 'cancelled'].includes(auction.status) && <form className="auction-chat-form" onSubmit={submit}>
        <input aria-label="Reply to auction chat" data-dialog-autofocus="true" value={draft} maxLength={500} onChange={event => setDraft(event.target.value)} placeholder="Reply to buyers…" />
        <button className="button primary" disabled={sending || !draft.trim()}>{sending ? 'Sending…' : 'Send'}</button>
      </form>}
      <small>Chat refreshes automatically while open. Messages are visible to signed-in buyers viewing this auction.</small>
    </section>
  </div>;
}

function ListingEditor({ listing, onClose, onSave }) {
  const [price, setPrice] = useState(String(listing.salePrice || listing.expectedPrice || ''));
  const [quantity, setQuantity] = useState(String(listing.quantity || ''));
  const [freshness, setFreshness] = useState(listing.freshness || 'fresh');
  const [estimate, setEstimate] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const inputKey = JSON.stringify([listing.fishType, Number(quantity), listing.quality, listing.size, freshness, listing.location]);
  const prediction = estimate?.key === inputKey ? estimate.value : null;
  const outsideRange = prediction && Number(price) > 0
    && (Number(price) < prediction.minimumPerKg * 0.8 || Number(price) > prediction.maximumPerKg * 1.2);

  useEffect(() => {
    if (!Number.isFinite(Number(quantity)) || Number(quantity) <= 0) return undefined;
    let active = true;
    const timer = window.setTimeout(() => {
      api.previewPricePrediction({
        fishType: listing.fishType,
        quantity: Number(quantity),
        quality: listing.quality,
        size: listing.size,
        freshness,
        location: listing.location
      }).then(value => {
        if (active) setEstimate({ key: inputKey, value });
      }).catch(requestError => {
        if (active) setError(`Price estimate unavailable: ${requestError.message}`);
      });
    }, 300);
    return () => { active = false; window.clearTimeout(timer); };
  }, [inputKey, listing.fishType, listing.location, listing.quality, listing.size, quantity, freshness]);

  const submit = async event => {
    event.preventDefault();
    setSaving(true);
    setError('');
    await onSave(listing, { price: Number(price), quantity: Number(quantity), freshness });
    setSaving(false);
  };

  return <section className="panel listing-edit-panel">
    <div className="panel-title"><div><p className="kicker">REFRESH YOUR LISTING</p><h2>Edit {listing.fishType}</h2></div><button className="text-button" type="button" onClick={onClose}>Cancel</button></div>
    <form className="listing-form" onSubmit={submit}>
      <label className="listing-field"><span>Sale price / kg</span><input type="number" min="0.01" step="0.01" value={price} onChange={event => setPrice(event.target.value)} required /></label>
      <label className="listing-field"><span>Quantity (kg)</span><input type="number" min="0.1" step="0.1" value={quantity} onChange={event => setQuantity(event.target.value)} required /></label>
      <label className="listing-field"><span>Reported freshness</span><select value={freshness} onChange={event => setFreshness(event.target.value)}><option value="same_day">Same-day</option><option value="fresh">Fresh</option><option value="chilled">Chilled</option><option value="frozen">Frozen</option></select></label>
      {prediction && <PricePredictionSummary prediction={prediction} compact />}
      {outsideRange && <p className="price-warning" role="status">Your selected price is more than 20% outside this indicative range. This is only a warning; your chosen price will not be changed.</p>}
      {error && <p className="notice" role="alert">{error}</p>}
      <button className="button primary" disabled={saving}>{saving ? 'Saving…' : 'Save listing changes'}</button>
    </form>
  </section>;
}
function OrdersPage({ orders, onStatus, onSchedule }) { const [dates, setDates] = useState({}); return <section className="panel fisherman-data"><div className="panel-title"><h2>Orders from buyers</h2><span>{orders.length} orders</span></div>{orders.map(order => { const next = order.orderStatus === 'processing' ? 'delivered' : order.orderStatus === 'delivered' ? 'completed' : null; const verified = order.paymentStatus === 'paid' && order.gateway === 'razorpay' && Boolean(order.transactionRef); return <div key={order.id} className="fisherman-order-management"><OrderRow order={order} />{verified && !['completed', 'cancelled'].includes(order.orderStatus) && <div className="delivery-schedule-controls"><label>Expected delivery date<input type="date" value={dates[order.id] ?? order.expectedDeliveryAt?.slice(0, 10) ?? ''} onChange={event => setDates(current => ({ ...current, [order.id]: event.target.value }))} /></label><button className="button small secondary" onClick={() => onSchedule(order, dates[order.id] ?? order.expectedDeliveryAt?.slice(0, 10) ?? '')}>Save date</button></div>}{verified && next && <button className="button small primary" onClick={() => onStatus(order, next)}>Mark {next}</button>}</div>; })}{!orders.length && <p className="empty">No buyer orders yet.</p>}</section>; }
function SalesPage({ orders }) { const completed = orders.filter(order => order.paymentStatus === 'paid' && order.gateway === 'razorpay'); const total = completed.reduce((sum, order) => sum + Number(order.amount || 0), 0); return <section className="panel fisherman-data"><div className="panel-title"><h2>Selling data</h2><span>Total ₹{total.toLocaleString()}</span></div>{completed.map(order => <OrderRow key={order.id} order={order} sale />)}{!completed.length && <p className="empty">Verified Razorpay payments will appear here after buyer checkout.</p>}</section>; }
function OrderRow({ order, sale = false }) { const listing = order.listingDetails; const image = sampleImageFor(listing); return <article className="order-row">{image ? <img src={image} alt={listing.imageUrl ? listing.fishType : `${listing.fishType} sample image`} /> : <div className="catch-placeholder"><Fish size={22} /></div>}<div><strong>{listing?.fishType || 'Fish order'}</strong><small>Order {order.orderNumber || order.id}</small><small>{order.quantity || listing?.quantity || 0} kg · Buyer order · {new Date(order.createdAt).toLocaleDateString()}</small></div><div className="order-amount"><strong>₹{Number(order.amount || 0).toLocaleString()}</strong><small className={sale ? 'status-paid' : ''}>{order.orderStatus || 'pending'}</small></div></article>; }