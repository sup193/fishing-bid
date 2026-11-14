import RoleTabs from '../../components/RoleTabs';

const routes = [
  { name: 'index', title: 'Market', icon: 'fish-outline' },
  { name: 'history', title: 'My activity', icon: 'receipt-outline' },
  { name: 'transactions', title: 'Payments', icon: 'card-outline' }
];

export default function BuyerLayout() {
  return <RoleTabs role="buyer" routes={routes} />;
}
