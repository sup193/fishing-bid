import { useEffect, useState } from 'react';
import { Gavel, ShoppingBag } from 'lucide-react';
import { api } from '../api.js';

const money = amount => `₹${Number(amount || 0).toLocaleString()}`;
const date = value => value ? new Date(value).toLocaleString() : 'Date unavailable';

function HistoryRows({ entries, kind }) {
  if (!entries.length) return <p className="empty">No {kind} history yet.</p>;
  return entries.map(item => <article className="history-row" key={item.id}>
    <div className="history-main">
      <strong>{kind === 'bids' ? item.fishType : `${item.fishType} · ${item.orderNumber || 'Order'}`}</strong>
      <small>{date(item.createdAt)}{item.quantity ? ` · ${item.quantity} kg` : ''}</small>
      {kind === 'bids' && <small>Highest bid: {money(item.highestBid)}/kg</small>}
      {kind === 'orders' && item.paymentMethod && <small>Payment method: {item.paymentMethod}</small>}
      {item.demo && <small className="practice-history-note">Practice data · no real order or payment</small>}
    </div>
    <div className="history-side">
      <strong>{money(item.amount)}{kind === 'bids' ? '/kg' : ''}</strong>
      <span className={`transaction-status transaction-${kind === 'bids' ? item.bidStatus : kind === 'orders' ? item.paymentStatus : item.status}`}>
        {kind === 'bids' ? item.bidStatus : kind === 'orders' ? `payment ${item.paymentStatus}` : item.status}
      </span>
      {kind === 'orders' && <small>{item.orderStatus}</small>}
    </div>
  </article>);
}

export default function BuyerHistory() {
  const [history, setHistory] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    api.buyerHistory().then(setHistory).catch(err => setError(err.message));
    api.buyerReviews().then(setReviews).catch(err => setError(err.message));
  }, []);

  const submitReview = async (order, rating, comment) => {
    const review = await api.submitOrderReview(order.id, { rating, comment });
    setReviews(current => [review, ...current]);
    setHistory(current => ({
      ...current,
      orders: current.orders.map(item => item.id === order.id
        ? { ...item, canReview: false, reviewSubmitted: true }
        : item)
    }));
    setNotice('Your review was submitted for moderation.');
  };

  const reportIssue = async (order, complaint) => {
    await api.reportOrderDispute(order.id, complaint);
    setHistory(current => ({
      ...current,
      orders: current.orders.map(item => item.id === order.id ? { ...item, canReport: false } : item)
    }));
    setNotice('Your order issue was sent to the marketplace admin team.');
  };

  return <section className="panel buyer-history">
    <div className="panel-title"><h2>Your bids &amp; orders</h2><span>Private to your account</span></div>
    <p className="history-note">Payment attempts and verified payment status are shown separately in Transactions.</p>
    {notice && <p className="success-notice" role="status">{notice}</p>}
    {error && <p className="notice">{error}</p>}
    {!history && !error && <p className="empty">Loading your account history...</p>}
    {history && <>
      <section className="history-group">
        <h3><Gavel size={17} /> My bids</h3>
        <HistoryRows entries={history.bids} kind="bids" />
      </section>
      <section className="history-group">
        <h3><ShoppingBag size={17} /> My purchases</h3>
        <HistoryRows entries={history.orders} kind="orders" />
        {history.orders.map(order => <div className="buyer-order-actions" key={`actions-${order.id}`}>
          <div><strong>{order.fishType}</strong><small>Fisherman: {order.fisherman}</small></div>
          {order.canReview && <ReviewForm order={order} onSubmit={submitReview} />}
          {order.reviewSubmitted && <span className="review-pending">Review submitted · pending moderation</span>}
          {order.canReport && <IssueForm order={order} onSubmit={reportIssue} />}
        </div>)}
      </section>
      <section className="history-group">
        <h3>Your submitted reviews</h3>
        {!reviews.length && <p className="empty">Reviews you submit will appear here with their moderation status.</p>}
        {reviews.map(review => <article className="buyer-review-row" key={review.id}>
          <div><strong>{'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)} · {review.status}</strong><small>Order {review.order}</small></div>
          {review.comment && <p>{review.comment}</p>}
        </article>)}
      </section>
    </>}
  </section>;
}

function ReviewForm({ order, onSubmit }) {
  const [rating, setRating] = useState('5');
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submit = async event => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await onSubmit(order, Number(rating), comment);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSubmitting(false);
    }
  };
  return <form className="buyer-review-form" onSubmit={submit}>
    <label>Rate {order.fisherman}<select value={rating} onChange={event => setRating(event.target.value)}>{[5, 4, 3, 2, 1].map(value => <option key={value} value={value}>{value} star{value === 1 ? '' : 's'}</option>)}</select></label>
    <textarea maxLength="1000" value={comment} onChange={event => setComment(event.target.value)} placeholder="Share optional feedback about this completed order" />
    {error && <small className="form-error">{error}</small>}
    <button className="button small primary" disabled={submitting}>{submitting ? 'Submitting…' : 'Submit verified review'}</button>
  </form>;
}

function IssueForm({ order, onSubmit }) {
  const [open, setOpen] = useState(false);
  const [complaint, setComplaint] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submit = async event => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await onSubmit(order, complaint);
      setOpen(false);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSubmitting(false);
    }
  };
  if (!open) return <button className="text-button buyer-report-button" type="button" onClick={() => setOpen(true)}>Report an order issue</button>;
  return <form className="buyer-review-form" onSubmit={submit}>
    <label>Describe the issue<textarea minLength="10" maxLength="2000" value={complaint} onChange={event => setComplaint(event.target.value)} required /></label>
    {error && <small className="form-error">{error}</small>}
    <div><button className="button small secondary" type="button" onClick={() => setOpen(false)}>Cancel</button><button className="button small primary" disabled={submitting}>{submitting ? 'Sending…' : 'Send to admin'}</button></div>
  </form>;
}
