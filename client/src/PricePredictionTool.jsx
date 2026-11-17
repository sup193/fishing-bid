import { useEffect, useState } from 'react';
import { api } from './api.js';

const initialInput = () => ({
  fishType: '',
  quantity: '',
  quality: 'Good',
  freshness: 'fresh',
  size: 'Medium',
  location: '',
  seasonMonth: String(new Date().getMonth() + 1)
});

export function PricePredictionSummary({ prediction, compact = false }) {
  if (!prediction) return null;
  const estimate = Number(prediction.estimatePerKg ?? prediction.pricePrediction?.estimatePerKg);
  const low = Number(prediction.minimumPerKg ?? prediction.pricePrediction?.minimumPerKg ?? prediction.predictedLow);
  const high = Number(prediction.maximumPerKg ?? prediction.pricePrediction?.maximumPerKg ?? prediction.predictedHigh);
  const total = Number(prediction.estimatedTotal ?? prediction.pricePrediction?.estimatedTotal);
  const reliability = prediction.reliability ?? prediction.pricePrediction?.reliability ?? 'preliminary';
  const model = prediction.model?.name ?? prediction.pricePrediction?.model?.name ?? 'Transparent rule baseline';
  const factors = prediction.factors ?? prediction.pricePrediction?.factors ?? [];
  const history = prediction.historicalPrices || [];
  const maxHistory = Math.max(1, ...history.map(item => item.averagePricePerKg));
  return <section className={`price-prediction-result${compact ? ' is-compact' : ''}`} aria-label="Estimated market price">
    <div className="price-prediction-heading">
      <div><p className="kicker">MARKET PRICE ESTIMATE</p><h3>Indicative value</h3></div>
      <span className={`prediction-reliability reliability-${reliability}`}>{reliability === 'validated' ? 'Validated model' : 'Preliminary estimate'}</span>
    </div>
    <div className="price-prediction-values">
      <article><span>Estimated per kg</span><strong>₹{Number.isFinite(estimate) ? estimate.toLocaleString() : '—'}</strong></article>
      <article><span>Expected range</span><strong>₹{Number.isFinite(low) ? low.toLocaleString() : '—'}–{Number.isFinite(high) ? high.toLocaleString() : '—'}</strong></article>
      {!compact && Number.isFinite(total) && <article><span>Estimated total</span><strong>₹{total.toLocaleString()}</strong></article>}
      <article><span>Market trend</span><strong>{prediction.trend?.direction || 'Stable'}</strong></article>
    </div>
    <p className="prediction-model-note">{model} · {prediction.confidence || 'No sufficient verified sales for calibration.'}</p>
    {!compact && history.length > 0 && <div className="prediction-history" aria-label="Historical verified sale prices">
      <strong>Verified sales history · ₹/kg</strong>
      <div className="prediction-history-chart">
        {history.map(point => <div className="prediction-history-column" key={point.month} title={`${point.month}: ₹${point.averagePricePerKg}/kg · ${point.observations} sales`}>
          <span style={{ height: `${Math.max(8, point.averagePricePerKg / maxHistory * 100)}%` }} />
          <small>{point.month.slice(5)}</small>
        </div>)}
      </div>
    </div>}
    {!compact && factors.length > 0 && <ul className="prediction-factors">
      {factors.map(item => <li key={item.name}><strong>{item.name}</strong><span>{item.description}</span></li>)}
    </ul>}
    <p className="prediction-disclaimer">{prediction.disclaimer || 'Estimate only; not a guaranteed sale price.'}</p>
  </section>;
}

export default function PricePredictionTool() {
  const [meta, setMeta] = useState({ fishTypes: [], qualities: [], sizes: [] });
  const [form, setForm] = useState(initialInput);
  const [prediction, setPrediction] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { api.meta().then(setMeta).catch(err => setError(err.message)); }, []);

  const update = event => setForm(current => ({ ...current, [event.target.name]: event.target.value }));
  const submit = async event => {
    event.preventDefault();
    setError('');
    setPrediction(null);
    setLoading(true);
    try {
      setPrediction(await api.pricePrediction({
        ...form,
        quantity: Number(form.quantity),
        seasonMonth: Number(form.seasonMonth)
      }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return <section className="panel price-prediction-tool">
    <div className="panel-title"><div><p className="kicker">FAIR-PRICE ASSISTANT</p><h2>Estimate a fish price</h2></div><span>Verified sales only</span></div>
    <p className="price-prediction-intro">Compare an indicative range using the existing species guide and available verified paid sales. Estimates are not guaranteed market quotes.</p>
    <form className="prediction-form" onSubmit={submit}>
      <label><span>Fish species</span><select name="fishType" value={form.fishType} onChange={update} required><option value="">Select a species</option>{meta.fishTypes.map(type => <option key={type}>{type}</option>)}</select></label>
      <label><span>Quantity (kg)</span><input name="quantity" type="number" min="0.1" max="100000" step="0.1" value={form.quantity} onChange={update} required /></label>
      <label><span>Quality grade</span><select name="quality" value={form.quality} onChange={update}>{meta.qualities.map(item => <option key={item}>{item}</option>)}</select></label>
      <label><span>Freshness · seller reported</span><select name="freshness" value={form.freshness} onChange={update}><option value="same_day">Same-day</option><option value="fresh">Fresh</option><option value="chilled">Chilled</option><option value="frozen">Frozen</option></select></label>
      <label><span>Size</span><select name="size" value={form.size} onChange={update}>{meta.sizes.map(item => <option key={item}>{item}</option>)}</select></label>
      <label><span>Landing port / market</span><input name="location" maxLength="120" value={form.location} onChange={update} placeholder="Optional" /></label>
      <label><span>Season month</span><select name="seasonMonth" value={form.seasonMonth} onChange={update}>{Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={index + 1}>{new Date(2025, index, 1).toLocaleString(undefined, { month: 'long' })}</option>)}</select></label>
      <button className="button primary" type="submit" disabled={loading || !meta.fishTypes.length}>{loading ? 'Estimating…' : 'Get price estimate'}</button>
    </form>
    {error && <p className="notice" role="alert">{error}</p>}
    {prediction && <PricePredictionSummary prediction={prediction} />}
  </section>;
}
