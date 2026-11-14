import { Platform } from 'react-native';

const defaultApiUrl = Platform.OS === 'android'
  ? 'http://10.0.2.2:5000/api'
  : 'http://localhost:5000/api';

export const API_BASE_URL = (process.env.EXPO_PUBLIC_API_URL || defaultApiUrl).replace(/\/+$/, '');
const API_ORIGIN = API_BASE_URL.replace(/\/api\/?$/i, '');

let authToken = null;

export function resolveImageUrl(imageUrl) {
  if (!imageUrl) return null;
  if (/^https?:\/\//i.test(imageUrl)) return imageUrl;
  return `${API_ORIGIN}/${String(imageUrl).replace(/^\/+/, '')}`;
}

async function request(path, { token, ...options } = {}) {
  let response;
  const isMultipart = typeof FormData !== 'undefined' && options.body instanceof FormData;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers: {
        ...(options.body && !isMultipart ? { 'Content-Type': 'application/json' } : {}),
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
const supportedImageTypes = ['image/jpeg', 'image/png', 'image/webp'];

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
  uploadImage: async asset => {
    const mimeType = asset.mimeType || 'image/jpeg';
    if (!supportedImageTypes.includes(mimeType)) {
      throw new Error('Choose a JPG, PNG, or WEBP photo.');
    }

    const extension = mimeType.split('/')[1].replace('jpeg', 'jpg');
    const name = asset.fileName || `catch-${Date.now()}.${extension}`;
    const body = new FormData();
    if (Platform.OS === 'web') {
      const response = await fetch(asset.uri);
      if (!response.ok) throw new Error('Could not read the selected catch photo.');
      body.append('image', await response.blob(), name);
    } else {
      body.append('image', { uri: asset.uri, name, type: mimeType });
    }
    return request('/uploads/image', { method: 'POST', body });
  },
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
