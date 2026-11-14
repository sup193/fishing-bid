import { Platform } from 'react-native';

const defaultApiUrl = Platform.OS === 'android'
  ? 'http://10.0.2.2:5000/api'
  : 'http://localhost:5000/api';

export const API_BASE_URL = (process.env.EXPO_PUBLIC_API_URL || defaultApiUrl).replace(/\/+$/, '');

let authToken = null;

async function request(path, { token, ...options } = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...((token || authToken) ? { Authorization: `Bearer ${token || authToken}` } : {}),
        ...options.headers
      }
    });
  } catch {
    throw new Error(`Cannot reach ${API_BASE_URL}. Check the backend and mobile API URL.`);
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return data;
}

const json = body => JSON.stringify(body);

export const mobileApi = {
  setToken: token => { authToken = token; },
  login: body => request('/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  me: token => request('/auth/me', { token }),
  listings: () => request('/listings'),
  marketTrends: days => request(`/market/trends?days=${encodeURIComponent(days)}`),
  recommendations: () => request('/recommendations'),
  buyerHistory: () => request('/buyer/history'),
  transactions: () => request('/transactions'),
  bid: (auctionId, amount) => request(`/auctions/${encodeURIComponent(auctionId)}/bids`, { method: 'POST', body: json({ amount }) }),
  fishermanListings: () => request('/fisherman/listings'),
  fishermanSales: () => request('/fisherman/sales'),
  bidMonitoring: () => request('/bid-monitoring'),
  meta: () => request('/meta'),
  createListing: body => request('/listings', { method: 'POST', body: json(body) }),
  createAuction: (listingId, body) => request(`/listings/${encodeURIComponent(listingId)}/auction`, { method: 'POST', body: json(body) }),
  closeAuction: auctionId => request(`/auctions/${encodeURIComponent(auctionId)}/close`, { method: 'PATCH' }),
  deleteListing: listingId => request(`/listings/${encodeURIComponent(listingId)}`, { method: 'DELETE' }),
  orders: () => request('/orders'),
  updateOrderStatus: (orderId, status) => request(`/orders/${encodeURIComponent(orderId)}/status`, { method: 'PATCH', body: json({ status }) }),
  adminOverview: () => request('/admin/overview'),
  adminListings: () => request('/admin/listings'),
  removeAdminListing: listingId => request(`/admin/listings/${encodeURIComponent(listingId)}`, { method: 'DELETE' }),
  adminUsers: () => request('/admin/users'),
  adminFisherman: userId => request(`/admin/fishermen/${encodeURIComponent(userId)}`),
  registrationRequests: () => request('/admin/registration-requests'),
  acceptRegistration: requestId => request(`/admin/registration-requests/${encodeURIComponent(requestId)}/accept`, { method: 'PATCH' }),
  rejectRegistration: requestId => request(`/admin/registration-requests/${encodeURIComponent(requestId)}/reject`, { method: 'PATCH' }),
  createFisherman: body => request('/admin/fishermen', { method: 'POST', body: json(body) })
};
