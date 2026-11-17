import { useEffect, useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { Button, Card, Chip, Empty, Field, Loading, Notice, Page, SectionTitle, colors } from '../components/common';
import { PricePredictionSummary } from '../components/PricePrediction';
import { mobileApi } from '../../api';

const months = Array.from({ length: 12 }, (_, index) => ({
  label: new Date(2025, index, 1).toLocaleString(undefined, { month: 'short' }),
  value: index + 1
}));

export function PricePredictionScreen() {
  const [meta, setMeta] = useState({ fishTypes: [], qualities: [], sizes: [] });
  const [form, setForm] = useState({
    fishType: '', quantity: '', quality: 'Good', size: 'Medium',
    freshness: 'fresh', location: '', seasonMonth: new Date().getMonth() + 1
  });
  const [prediction, setPrediction] = useState(null);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    mobileApi.meta().then(setMeta).catch(loadError => setError(loadError.message)).finally(() => setLoadingMeta(false));
  }, []);

  const update = (key, value) => setForm(current => ({ ...current, [key]: value }));

  async function estimate() {
    setError('');
    setPrediction(null);
    setSubmitting(true);
    try {
      setPrediction(await mobileApi.pricePrediction({
        ...form, quantity: Number(form.quantity), seasonMonth: Number(form.seasonMonth)
      }));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Page title="Fish price estimate" subtitle="Indicative price guidance, based on the transparent listing baseline and verified sales when available.">
      {error ? <Notice>{error}</Notice> : null}
      {loadingMeta ? <Loading label="Loading available species…" /> : null}
      {!loadingMeta && !meta.fishTypes.length ? <Empty>Fish species are unavailable right now.</Empty> : null}
      <Card>
        <Text style={{ color: colors.ink, fontSize: 13, fontWeight: '800' }}>Fish species</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 7 }}>
          {meta.fishTypes.map(type => <Chip key={type} label={type} selected={form.fishType === type} onPress={() => update('fishType', type)} />)}
        </ScrollView>
        <Field label="Quantity (kg)" value={form.quantity} onChangeText={value => update('quantity', value)} placeholder="e.g. 10" keyboardType="decimal-pad" autoCapitalize="none" />
        <Field label="Landing port or market" value={form.location} onChangeText={value => update('location', value)} placeholder="Optional" />
        <Text style={styles.label}>Quality grade</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {meta.qualities.map(value => <Chip key={value} label={value} selected={form.quality === value} onPress={() => update('quality', value)} />)}
        </ScrollView>
        <Text style={styles.label}>Size</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {meta.sizes.map(value => <Chip key={value} label={value} selected={form.size === value} onPress={() => update('size', value)} />)}
        </ScrollView>
        <Text style={styles.label}>Seller-reported freshness</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {[['same_day', 'Same-day'], ['fresh', 'Fresh'], ['chilled', 'Chilled'], ['frozen', 'Frozen']].map(([value, label]) => <Chip key={value} label={label} selected={form.freshness === value} onPress={() => update('freshness', value)} />)}
        </ScrollView>
        <Text style={styles.label}>Season month</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {months.map(month => <Chip key={month.value} label={month.label} selected={Number(form.seasonMonth) === month.value} onPress={() => update('seasonMonth', month.value)} />)}
        </ScrollView>
        <Button label="Get price estimate" onPress={estimate} loading={submitting} disabled={!form.fishType || !form.quantity || loadingMeta} />
      </Card>
      {prediction ? <PricePredictionSummary prediction={prediction} /> : null}
      {prediction && !prediction.historicalPrices?.length
        ? <Card><SectionTitle title="Historical chart unavailable" /><Text style={styles.muted}>There are not enough verified paid sales to chart this species yet. The displayed value remains a preliminary estimate.</Text></Card>
        : null}
    </Page>
  );
}

const styles = {
  label: { color: colors.ink, fontSize: 12, fontWeight: '700' },
  chips: { gap: 7, paddingVertical: 2 },
  muted: { color: colors.muted, fontSize: 12, lineHeight: 18 }
};
