import { Text, View } from 'react-native';
import { Card, colors, money } from './common';

export function PricePredictionSummary({ prediction, compact = false, fishType }) {
  if (!prediction) return null;
  const reliability = prediction.reliability || 'preliminary';
  const species = fishType || prediction.input?.fishType;
  return (
    <Card>
      <Text style={{ color: colors.sea, fontSize: 10, fontWeight: '800', letterSpacing: 1 }}>INDICATIVE MARKET PRICE</Text>
      {species ? <Text style={{ color: colors.ink, fontSize: 13, fontWeight: '700' }}>{species}</Text> : null}
      <Text style={{ color: colors.ink, fontSize: 18, fontWeight: '800' }}>{money(prediction.estimatePerKg)}/kg</Text>
      <Text style={{ color: colors.muted, fontSize: 12 }}>Expected range {money(prediction.minimumPerKg)}–{money(prediction.maximumPerKg)}/kg</Text>
      {!compact ? <Text style={{ color: colors.muted, fontSize: 12 }}>Estimated total {money(prediction.estimatedTotal)} · trend {prediction.trend?.direction || 'Stable'}</Text> : null}
      <Text style={{ color: reliability === 'validated' ? colors.sea : colors.coral, fontSize: 11, fontWeight: '700' }}>
        {reliability === 'validated' ? 'Validated model' : 'Preliminary estimate'} · {prediction.model?.name || 'Rule baseline'}
      </Text>
      {prediction.asOf ? <Text style={{ color: colors.muted, fontSize: 10 }}>Estimate date {new Date(prediction.asOf).toLocaleDateString()}</Text> : null}
      {!compact && prediction.historicalPrices?.length ? (
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 7, minHeight: 75 }}>
          {prediction.historicalPrices.map(point => {
            const maximum = Math.max(...prediction.historicalPrices.map(item => item.averagePricePerKg), 1);
            return <View key={point.month} style={{ flex: 1, alignItems: 'center', gap: 3 }}>
              <View style={{ width: '100%', height: Math.max(8, point.averagePricePerKg / maximum * 54), borderTopLeftRadius: 4, borderTopRightRadius: 4, backgroundColor: colors.sea }} />
              <Text style={{ color: colors.muted, fontSize: 8 }}>{point.month.slice(5)}</Text>
            </View>;
          })}
        </View>
      ) : null}
      <Text style={{ color: colors.muted, fontSize: 10, lineHeight: 15 }}>{prediction.disclaimer || 'Estimate only; not a guaranteed sale price.'}</Text>
    </Card>
  );
}
