import RoleTabs from '../../components/RoleTabs';

const routes = [
  { name: 'index', title: 'Inventory', icon: 'fish-outline' },
  { name: 'orders', title: 'Orders', icon: 'cube-outline' },
  { name: 'sales', title: 'Sales', icon: 'stats-chart-outline' },
  { name: 'reputation', title: 'Trust', icon: 'shield-checkmark-outline' },
  { name: 'demand', title: 'Demand', icon: 'trending-up-outline' },
  { name: 'bids', title: 'Bids', icon: 'hammer-outline' },
  { name: 'transactions', title: 'Payments', icon: 'card-outline' }
];

export default function FishermanLayout() {
  return <RoleTabs role="fisherman" routes={routes} />;
}
