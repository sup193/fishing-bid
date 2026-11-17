import { Text, View } from 'react-native';
import { Card, SectionTitle, colors } from './common';

const percent = value => value === null || value === undefined ? '—' : `${Number(value).toFixed(1)}%`;

export function ReputationSummary({ reputation }) {
  if (!reputation) return null;
  return (
    <>
      <Card>
        <Text style={styles.eyebrow}>TRANSPARENT TRUST SCORE</Text>
        <View style={styles.scoreRow}>
          <Text style={styles.score}>{reputation.status === 'rated' ? reputation.score : '—'}</Text>
          <View style={styles.scoreCopy}>
            <Text style={styles.level}>{reputation.verified ? '✓ ' : ''}{reputation.level}</Text>
            <Text style={styles.muted}>{reputation.status === 'rated' ? 'out of 100' : 'Not yet rated'}</Text>
          </View>
        </View>
        {reputation.status === 'unrated' ? <Text style={styles.muted}>No verified paid orders are recorded yet. This is not a negative rating.</Text> : null}
        <View style={styles.stats}>
          <Text style={styles.stat}>Average rating: {reputation.averageRating === null ? '—' : `${reputation.averageRating.toFixed(1)} / 5`}</Text>
          <Text style={styles.stat}>Completed orders: {reputation.completedOrderCount || 0}</Text>
          <Text style={styles.stat}>Successful delivery: {percent(reputation.successfulDeliveryPercent)}</Text>
          <Text style={styles.stat}>On-time delivery: {percent(reputation.onTimeDeliveryPercent)}</Text>
          <Text style={styles.stat}>Cancellations: {percent(reputation.cancellationPercent)}</Text>
        </View>
      </Card>
      <SectionTitle title="Score breakdown" />
      {reputation.factors?.map(item => <Card key={item.key} style={styles.factor}>
        <View style={styles.factorHeading}><Text style={styles.factorName}>{item.key.replace(/([A-Z])/g, ' $1')}</Text><Text style={styles.factorScore}>{item.score === null ? '—' : `${Math.round(item.score)}/100`} · {item.weight}%</Text></View>
        <Text style={styles.muted}>{item.explanation}</Text>
      </Card>)}
      {reputation.improvements?.length ? <Card>
        <SectionTitle title="Ways to build trust" />
        {reputation.improvements.map(item => <Text style={styles.muted} key={item}>• {item}</Text>)}
      </Card> : null}
      <SectionTitle title="Recent buyer reviews" />
      {reputation.recentReviews?.length ? reputation.recentReviews.map(review => <Card key={review.id}>
        <Text style={styles.review}>{'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)} · Verified buyer</Text>
        <Text style={styles.muted}>{review.fishType}{review.createdAt ? ` · ${new Date(review.createdAt).toLocaleDateString()}` : ''}</Text>
        {review.comment ? <Text style={styles.body}>{review.comment}</Text> : null}
      </Card>) : <Card><Text style={styles.muted}>Approved reviews from verified completed orders will appear here.</Text></Card>}
    </>
  );
}

const styles = {
  eyebrow: { color: colors.sea, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  score: { color: colors.ink, fontSize: 46, fontWeight: '900' },
  scoreCopy: { gap: 3 },
  level: { color: colors.sea, fontSize: 15, fontWeight: '800' },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  stat: { width: '48%', color: colors.ink, fontSize: 11, fontWeight: '700' },
  factor: { gap: 5 },
  factorHeading: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  factorName: { color: colors.ink, fontSize: 12, fontWeight: '800', textTransform: 'capitalize' },
  factorScore: { color: colors.sea, fontSize: 11, fontWeight: '800' },
  review: { color: colors.ink, fontSize: 12, fontWeight: '800' },
  muted: { color: colors.muted, fontSize: 11, lineHeight: 16 },
  body: { color: colors.ink, fontSize: 12, lineHeight: 18 }
};
