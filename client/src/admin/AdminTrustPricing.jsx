import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';

export default function AdminTrustPricing() {
  const [scores, setScores] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [disputes, setDisputes] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const [reputation, customerReviews, complaints, priceData] = await Promise.all([
        api.adminReputation(), api.adminReviews(), api.adminDisputes(), api.adminPriceAnalytics()
      ]);
      setScores(reputation);
      setReviews(customerReviews);
      setDisputes(complaints);
      setAnalytics(priceData);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const run = async (key, operation, successMessage) => {
    setWorking(key);
    setError('');
    setMessage('');
    try {
      await operation();
      setMessage(successMessage);
      await load();
    } catch (operationError) {
      setError(operationError.message);
    } finally {
      setWorking('');
    }
  };

  const evaluate = async () => {
    setWorking('model');
    setError('');
    setMessage('');
    try {
      const result = await api.evaluatePriceModel();
      setMessage(`Evaluation complete: ${result.selectedModel} selected from ${result.sampleCount} verified sales.`);
      await load();
    } catch (evaluationError) {
      setError(evaluationError.message);
      await load();
    } finally {
      setWorking('');
    }
  };

  return <main className="admin-trust-pricing">
    {error && <p className="notice" role="alert">{error}</p>}
    {message && <p className="success-notice" role="status">{message}</p>}
    {loading && <p className="empty">Loading verified reputation and price data…</p>}
    <section className="panel admin-page">
      <div className="panel-title"><div><p className="kicker">FISHERMAN ACCOUNTABILITY</p><h2>Trust scores &amp; verification</h2></div><span>{scores.length} fishermen</span></div>
      {scores.map(({ fisherman, reputation }) => <article className="admin-trust-row" key={fisherman.id}>
        <div><strong>{fisherman.name}</strong><small>{fisherman.location || 'Location unavailable'} · {reputation.verified ? 'Verified' : 'Not verified'}</small><small>{reputation.completedOrderCount} verified completed orders · {reputation.averageRating === null ? 'No approved ratings' : `${reputation.averageRating.toFixed(1)} average rating`}</small></div>
        <div className="admin-trust-score"><strong>{reputation.status === 'rated' ? reputation.score : '—'}</strong><span>{reputation.level}</span></div>
        <button className="button small secondary" disabled={working === `verify-${fisherman.id}`} onClick={() => run(`verify-${fisherman.id}`, () => api.setFishermanVerification(fisherman.id, !reputation.verified), `${fisherman.name} verification updated.`)}>{reputation.verified ? 'Remove verification' : 'Verify fisherman'}</button>
        <details className="admin-score-details"><summary>Calculation details</summary>{reputation.factors.map(item => <p key={item.key}><strong>{item.key} · {item.weight}%:</strong> {item.score === null ? 'not measured' : `${item.score}/100`} — {item.explanation}</p>)}</details>
      </article>)}
      {!loading && !scores.length && <p className="empty">No fishermen to score yet.</p>}
    </section>
    <section className="panel admin-page">
      <div className="panel-title"><div><p className="kicker">BUYER FEEDBACK</p><h2>Review moderation</h2></div><span>{reviews.filter(review => review.status === 'pending').length} pending</span></div>
      {reviews.map(review => <article className="admin-review-row" key={review.id}>
        <div><strong>{review.rating}/5 stars · {review.status}</strong><small>Verified order {review.order} · Fisherman {review.fisherman}</small>{review.comment && <p>{review.comment}</p>}</div>
        {review.status === 'pending' && <div className="request-actions">
          <button className="button small primary" disabled={Boolean(working)} onClick={() => run(review.id, () => api.moderateReview(review.id, { status: 'approved' }), 'Review approved.')}>Approve</button>
          <button className="button small secondary" disabled={Boolean(working)} onClick={() => run(review.id, () => api.moderateReview(review.id, { status: 'rejected' }), 'Review rejected.')}>Reject</button>
        </div>}
      </article>)}
      {!reviews.length && <p className="empty">No buyer reviews have been submitted.</p>}
    </section>
    <section className="panel admin-page">
      <div className="panel-title"><div><p className="kicker">ORDER INVESTIGATIONS</p><h2>Complaints &amp; disputes</h2></div><span>{disputes.filter(item => item.status !== 'reviewed').length} open</span></div>
      {disputes.map(dispute => <article className="admin-review-row" key={dispute.id}>
        <div><strong>Order {dispute.order} · {dispute.status}</strong><small>Fisherman {dispute.fisherman} · buyer identity withheld</small><p>{dispute.complaint}</p>{dispute.adminNote && <small>Admin note: {dispute.adminNote}</small>}</div>
        {dispute.status !== 'reviewed' && <div className="request-actions">
          <button className="button small primary" disabled={Boolean(working)} onClick={() => run(dispute.id, () => api.reviewDispute(dispute.id, { finding: 'confirmed' }), 'Complaint confirmed and reputation recalculated.')}>Confirm</button>
          <button className="button small secondary" disabled={Boolean(working)} onClick={() => run(dispute.id, () => api.reviewDispute(dispute.id, { finding: 'not_confirmed' }), 'Complaint reviewed without a confirmed finding.')}>Not confirmed</button>
        </div>}
      </article>)}
      {!disputes.length && <p className="empty">No order complaints have been reported.</p>}
    </section>
    <section className="panel admin-page">
      <div className="panel-title"><div><p className="kicker">MODEL GOVERNANCE</p><h2>Price prediction analytics</h2></div><button className="button small primary" onClick={evaluate} disabled={Boolean(working) || !analytics?.dataAvailability?.canEvaluateModel}>{working === 'model' ? 'Evaluating…' : 'Evaluate verified sales'}</button></div>
      <p className="price-prediction-intro">Verified paid sales: {analytics?.dataAvailability?.verifiedSaleCount || 0} / {analytics?.dataAvailability?.requiredSampleCount || 50} needed. No model is marked validated before a chronological holdout evaluation.</p>
      <div className="price-admin-stats">
        <article><span>Active model</span><strong>{analytics?.model?.model === 'linear_regression' ? 'Linear regression' : 'Rule baseline'}</strong></article>
        <article><span>Model status</span><strong>{analytics?.model?.status || 'preliminary'}</strong></article>
        <article><span>Prediction requests</span><strong>{analytics?.predictionUsageCount || 0}</strong></article>
      </div>
      {analytics?.model?.validation && <p className="prediction-model-note">Holdout MAE ₹{analytics.model.validation.metrics?.mae}/kg · RMSE ₹{analytics.model.validation.metrics?.rmse}/kg · sMAPE {analytics.model.validation.metrics?.smapePercent}%</p>}
      <h3 className="admin-subheading">Species-wise verified paid sales</h3>
      {analytics?.species?.length ? analytics.species.map(item => <article className="admin-price-row" key={item.fishType}><strong>{item.fishType}</strong><span>{item.observations} sales</span><span>₹{item.averagePricePerKg}/kg average</span><small>₹{item.minimumPricePerKg}–₹{item.maximumPricePerKg}/kg</small></article>) : <p className="empty">No verified sale labels are available for market statistics.</p>}
      {analytics?.evaluations?.map(item => <p className="prediction-model-note" key={item.id}>Last evaluation: {item.status} · {item.sampleCount} samples · {item.evaluatedAt ? new Date(item.evaluatedAt).toLocaleString() : ''}</p>)}
    </section>
  </main>;
}
