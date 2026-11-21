import RoleTabs from '../../components/RoleTabs';

const routes = [
  { name: 'index', title: 'Overview', icon: 'grid-outline' },
  { name: 'listings', title: 'Listings', icon: 'storefront-outline' },
  { name: 'people', title: 'People', icon: 'people-outline' },
  { name: 'trust', title: 'Trust & prices', icon: 'shield-checkmark-outline' },
  { name: 'demand', title: 'Demand', icon: 'trending-up-outline' },
  { name: 'bids', title: 'Bids', icon: 'hammer-outline' },
  { name: 'auction-analytics', title: 'Auction analytics', icon: 'analytics-outline' },
  { name: 'transactions', title: 'Payments', icon: 'card-outline' }
];

export default function AdminLayout() {
  return <RoleTabs role="admin" routes={routes} />;
}
