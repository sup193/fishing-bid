import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, Card, Empty, Loading, Notice, Page, SectionTitle, Stat, colors } from '../components/common';
import { mobileApi } from '../../api';

export default function AdminAuctionAnalyticsScreen() {
  const [analytics, setAnalytics] = useState(null);
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const [summary, pending] = await Promise.all([
        mobileApi.adminAuctionAnalytics(),
        mobileApi.adminAuctionChatReports()
      ]);
      setAnalytics(summary);
      setReports(pending);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { Promise.resolve().then(load); }, [load]);

  async function moderate(messageId, status) {
    try {
      await mobileApi.moderateAuctionMessage(messageId, {
        status,
        moderationNote: status === 'hidden' ? 'Hidden after admin review' : 'Restored after admin review'
      });
      await load();
    } catch (moderationError) {
      setError(moderationError.message);
    }
  }

  const summary = analytics?.summary || {};
  return (
    <Page title="Auction analytics" subtitle="Aggregate activity, transparent review signals, and reported chat." onRefresh={() => { setRefreshing(true); load(); }} refreshing={refreshing}>
      {error ? <Notice>{error}</Notice> : null}
      {loading ? <Loading label="Loading auction analytics…" /> : null}
      {analytics ? <>
        <View style={styles.stats}>
          <Stat label="Auctions" value={summary.totalAuctions} />
          <Stat label="Active" value={summary.activeAuctions} />
          <Stat label="Completed" value={summary.completedAuctions} />
          <Stat label="Review signals" value={summary.flaggedAuctions} />
        </View>
        <SectionTitle title="Species activity" detail={`${summary.totalBids || 0} recorded bids`} />
        {analytics.bySpecies.length ? analytics.bySpecies.map(item => (
          <Card key={item.fishType}>
            <Text style={styles.title}>{item.fishType}</Text>
            <Text style={styles.detail}>{item.auctions} auctions · {item.bids} bids · {item.completed} completed</Text>
          </Card>
        )) : <Empty>No auctions are available.</Empty>}
        <SectionTitle title="Location activity" detail="Aggregated auction and bid counts" />
        {analytics.byLocation.length ? analytics.byLocation.map(item => (
          <Card key={item.location}>
            <Text style={styles.title}>{item.location}</Text>
            <Text style={styles.detail}>{item.auctions} auctions · {item.bids} bids · {item.completed} completed</Text>
          </Card>
        )) : <Empty>No location data is available.</Empty>}
        <SectionTitle title="Auction review signals" detail="Human review only; not proof of misconduct" />
        {analytics.flaggedAuctions.length ? analytics.flaggedAuctions.map(item => (
          <Card key={item.id}>
            <Text style={styles.title}>{item.fishType} · {item.location || 'Location unavailable'}</Text>
            {item.activity.flags.map(flag => <Text style={styles.detail} key={flag.code}>{flag.detail}</Text>)}
          </Card>
        )) : <Empty>No auction-level review signals.</Empty>}
      </> : null}
      <SectionTitle title="Reported auction messages" detail={`${reports.length} pending`} />
      {reports.length ? reports.map(report => (
        <Card key={report.id}>
          <Text style={styles.title}>{report.message?.authorName || 'Marketplace member'}</Text>
          <Text style={styles.detail}>{report.message?.content || 'Message no longer available'}</Text>
          <Text style={styles.note}>{report.reason || 'No reason provided'} · Reported by {report.reporterName}</Text>
          {report.message ? <View style={styles.actions}>
            <Button label="Hide" variant="danger" compact onPress={() => moderate(report.message.id, 'hidden')} />
            <Button label="Keep visible" variant="secondary" compact onPress={() => moderate(report.message.id, 'published')} />
          </View> : null}
        </Card>
      )) : !loading ? <Empty>No chat reports are awaiting review.</Empty> : null}
      {analytics ? <Text style={styles.note}>Model {analytics.modelVersion}. Sparse historical sales produce preliminary auction estimates, not accuracy claims.</Text> : null}
    </Page>
  );
}

const styles = StyleSheet.create({
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  title: { color: colors.ink, fontSize: 13, fontWeight: '800' },
  detail: { color: colors.muted, fontSize: 11, lineHeight: 16 },
  note: { color: colors.muted, fontSize: 10, lineHeight: 15 },
  actions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' }
});
