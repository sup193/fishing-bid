import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Card, Empty, Loading, Notice, Page, colors, money } from '../components/common';
import { mobileApi } from '../../api';

const paymentStatusLabel = status => ({
  creating: 'Awaiting payment',
  pending: 'Awaiting payment',
  pending_verification: 'Pending verification',
  paid: 'Paid',
  rejected: 'Rejected',
  failed: 'Failed'
}[status] || status || 'Awaiting payment');

export function TransactionsScreen() {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      setTransactions(await mobileApi.transactions());
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { Promise.resolve().then(load); }, [load]);

  return (
    <Page title="Payment activity" subtitle="Transaction records and payment status for this account." onRefresh={() => { setRefreshing(true); load(); }} refreshing={refreshing}>
      {error ? <Notice>{error}</Notice> : null}
      {loading ? <Loading label="Loading transactions…" /> : !transactions.length ? <Empty>No payment transactions yet.</Empty> : transactions.map(item => (
        <Card key={item.id}>
          <TextRow label={item.fishType || 'Fish order'} value={money(item.amount)} strong />
          <TextRow label={`Order ${item.orderNumber || item.order || item.id}`} value={paymentStatusLabel(item.status)} />
          <TextRow label="Payment method" value={item.paymentMethod === 'upi_qr' ? 'UPI QR' : item.gateway || item.paymentMethod || 'Payment'} />
          {item.upiUtr ? <TextRow label="UPI UTR/reference" value={item.upiUtr} /> : null}
          <TextRow label={`${item.quantity || 0} kg · ${item.orderStatus || 'order pending'}`} value={formatDate(item.referenceSubmittedAt || item.paidAt || item.createdAt)} />
        </Card>
      ))}
    </Page>
  );
}

export function BidMonitoringScreen() {
  const [auctions, setAuctions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      setAuctions(await mobileApi.bidMonitoring());
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { Promise.resolve().then(load); }, [load]);

  return (
    <Page title="Bid review" subtitle="Monitor auction activity and flagged bids." onRefresh={() => { setRefreshing(true); load(); }} refreshing={refreshing}>
      {error ? <Notice>{error}</Notice> : null}
      {loading ? <Loading label="Loading auction activity…" /> : !auctions.length ? <Empty>No auctions are available to review.</Empty> : auctions.map(auction => (
        <Card key={auction.id}>
          <TextRow label={auction.listing?.fishType || 'Auction'} value={auction.status} strong />
          <TextRow label={`${auction.listing?.quantity || 0} kg · ${auction.listing?.location || 'Port unavailable'}`} value={`${auction.bids.length} bids`} />
          {auction.activity?.reviewNeeded ? <Notice>{auction.activity.flags.map(flag => flag.detail).join(' · ')}</Notice> : null}
          {auction.winnerName ? <TextRow label={`Winner: ${auction.winnerName}`} value={money(auction.winningBid)} /> : null}
          {auction.bids.map(bid => (
            <Card key={bid.id} style={{ padding: 11, backgroundColor: bid.riskReviewNeeded ? '#fff5e8' : '#f3f8f7' }}>
              <TextRow label={bid.buyer?.name || 'Buyer'} value={`${money(bid.amount)}/kg`} strong />
              <TextRow label={formatDate(bid.createdAt)} value={bid.riskReviewNeeded ? 'Review flagged' : 'No review flag'} />
              {bid.riskFlags?.length ? <Notice>{bid.riskFlags.map(flag => flag.detail || flag.code || 'Review signal').join(', ')}</Notice> : null}
            </Card>
          ))}
        </Card>
      ))}
    </Page>
  );
}

function TextRow({ label, value, strong = false }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, strong && styles.strong]}>{label}</Text>
      <Text style={[styles.rowValue, strong && styles.strong]}>{value}</Text>
    </View>
  );
}

function formatDate(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleString() : 'Date unavailable';
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  rowLabel: { flex: 1, color: colors.muted, fontSize: 11 },
  rowValue: { maxWidth: '55%', color: colors.ink, fontSize: 11, textAlign: 'right', textTransform: 'capitalize' },
  strong: { color: colors.ink, fontSize: 13, fontWeight: '800' }
});
