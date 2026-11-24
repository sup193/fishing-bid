import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';

const paymentStatusLabels = {
  creating: 'Awaiting payment',
  pending: 'Awaiting payment',
  pending_verification: 'Pending verification',
  paid: 'Paid',
  rejected: 'Rejected',
  failed: 'Failed'
};

function paymentMethodLabel(transaction) {
  if (transaction.gateway === 'upi' || transaction.paymentMethod === 'upi_qr') return 'UPI QR';
  if (transaction.gateway === 'razorpay') return 'Razorpay';
  return transaction.paymentMethod || transaction.gateway || 'Payment';
}

function formattedDate(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : 'Date unavailable';
}

export default function TransactionHistory({ title = 'Transaction history', admin = false }) {
  const [transactions, setTransactions] = useState([]);
  const [pendingPayments, setPendingPayments] = useState([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [reviewingId, setReviewingId] = useState('');

  const load = useCallback(async () => {
    setError('');
    const [history, pending] = await Promise.all([
      api.transactions(),
      admin ? api.adminPendingPayments() : Promise.resolve([])
    ]);
    setTransactions(history);
    setPendingPayments(pending);
  }, [admin]);

  useEffect(() => {
    load().catch(err => setError(err.message));
  }, [load]);

  const review = async (payment, action) => {
    const actionLabel = action === 'verify' ? 'approve' : 'reject';
    const prompt = action === 'verify'
      ? `Confirm that ₹${Number(payment.amount).toFixed(2)} was received for order ${payment.orderNumber}, then approve this payment?`
      : `Reject the submitted UTR for order ${payment.orderNumber}? The order will remain unpaid.`;
    if (!window.confirm(prompt)) return;
    setError('');
    setMessage('');
    setReviewingId(payment.id);
    try {
      const result = action === 'verify'
        ? await api.verifyUpiPayment(payment.id)
        : await api.rejectUpiPayment(payment.id, '');
      setMessage(result.message || `Payment ${actionLabel}d.`);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setReviewingId('');
    }
  };

  return <section className="panel transaction-panel">
    {admin && <section className="upi-admin-review" aria-labelledby="upi-review-title">
      <div className="panel-title"><div><p className="kicker">MANUAL PAYMENT REVIEW</p><h2 id="upi-review-title">UPI Payment Verification</h2></div><span>{pendingPayments.length} awaiting verification</span></div>
      {message && <p className="success-notice" role="status">{message}</p>}
      {error && <p className="notice" role="alert">{error}</p>}
      {pendingPayments.map(payment => <article className="upi-review-line" key={payment.id}>
        <div className="upi-review-details">
          <strong>Order {payment.orderNumber} · {payment.fishType}</strong>
          <span>Transaction ID: {payment.id}</span>
          <span>Buyer: {payment.buyer?.name || 'Unknown buyer'}{payment.buyer?.email ? ` · ${payment.buyer.email}` : ''}</span>
          <span>Fisherman: {payment.fisherman?.name || 'Unknown fisherman'}</span>
          <span>Amount: ₹{Number(payment.amount).toFixed(2)} · UPI ID: {payment.upiRecipientId}</span>
          <span>Submitted UTR: <strong>{payment.upiUtr}</strong></span>
          <small>{formattedDate(payment.referenceSubmittedAt)} · {payment.status.replaceAll('_', ' ')}</small>
        </div>
        <div className="upi-review-actions">
          <button className="button small primary" type="button" onClick={() => review(payment, 'verify')} disabled={Boolean(reviewingId)}>
            {reviewingId === payment.id ? 'Reviewing…' : 'Verify'}
          </button>
          <button className="button small secondary" type="button" onClick={() => review(payment, 'reject')} disabled={Boolean(reviewingId)}>
            {reviewingId === payment.id ? 'Reviewing…' : 'Reject'}
          </button>
        </div>
      </article>)}
      {!pendingPayments.length && <p className="empty">No UPI payments awaiting verification.</p>}
    </section>}
    <div className="panel-title"><h2>{title}</h2><span>{transactions.length} payment attempts</span></div>
    {!admin && error && <p className="notice" role="alert">{error}</p>}
    {transactions.map(transaction => {
      const status = paymentStatusLabels[transaction.status] || transaction.status;
      return <article className="transaction-line" key={transaction.id}>
        <div className="transaction-details">
          <strong>{transaction.fishType} · Order {transaction.orderNumber || transaction.order}</strong>
          <small>Transaction ID: {transaction.id}</small>
          <small>{paymentMethodLabel(transaction)}{transaction.upiUtr ? ` · UTR ${transaction.upiUtr}` : ''}</small>
          <small>{formattedDate(transaction.referenceSubmittedAt || transaction.paidAt || transaction.createdAt)} · {transaction.quantity} kg</small>
          {transaction.demo && <small className="practice-history-note">Practice data · no real payment processed</small>}
        </div>
        <div className="transaction-amount">
          <strong>₹{Number(transaction.amount || 0).toFixed(2)}</strong>
          <span className={`transaction-status transaction-${transaction.status}`}>{status}</span>
        </div>
      </article>;
    })}
    {!error && transactions.length === 0 && <p className="empty">Payments and their status will appear here.</p>}
  </section>;
}
