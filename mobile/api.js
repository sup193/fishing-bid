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
  updatePreferredLanguage: preferredLanguage => request('/auth/preferences', { method: 'PATCH', body: json({ preferredLanguage }) }),
  listings: () => request('/listings'),
  marketTrends: days => request(`/market/trends?days=${encodeURIComponent(days)}`),
  recommendations: () => request('/recommendations'),
  buyerHistory: () => request('/buyer/history'),
  buyerReviews: () => request('/buyer/reviews'),
  submitOrderReview: (orderId, body) => request(`/orders/${encodeURIComponent(orderId)}/reviews`, { method: 'POST', body: json(body) }),
  reportOrderDispute: (orderId, complaint) => request(`/orders/${encodeURIComponent(orderId)}/disputes`, { method: 'POST', body: json({ complaint }) }),
  transactions: () => request('/transactions'),
  fishermanReputation: () => request('/fisherman/reputation'),
  pricePrediction: body => request('/price-predictions', { method: 'POST', body: json(body) }),
  previewPricePrediction: body => request('/price-predictions/preview', { method: 'POST', body: json(body) }),
  auction: auctionId => request(`/auctions/${encodeURIComponent(auctionId)}`),
  bid: (auctionId, amount, requestId = `mobile-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`) => request(`/auctions/${encodeURIComponent(auctionId)}/bids`, { method: 'POST', body: json({ amount, requestId }) }),
  automaticBidding: (auctionId, maxAmount) => request(`/auctions/${encodeURIComponent(auctionId)}/automatic-bidding`, { method: 'POST', body: json({ maxAmount, requestId: `mobile-auto-${Date.now()}-${Math.random().toString(36).slice(2, 10)}` }) }),
  automaticBiddingStatus: auctionId => request(`/auctions/${encodeURIComponent(auctionId)}/automatic-bidding`),
  disableAutomaticBidding: auctionId => request(`/auctions/${encodeURIComponent(auctionId)}/automatic-bidding`, { method: 'DELETE' }),
  notifications: () => request('/notifications'),
  markNotificationRead: notificationId => request(`/notifications/${encodeURIComponent(notificationId)}/read`, { method: 'PATCH' }),
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
  updateListing: (listingId, body) => request(`/listings/${encodeURIComponent(listingId)}`, { method: 'PATCH', body: json(body) }),
  createAuction: (listingId, body) => request(`/listings/${encodeURIComponent(listingId)}/auction`, { method: 'POST', body: json(body) }),
  closeAuction: auctionId => request(`/auctions/${encodeURIComponent(auctionId)}/close`, { method: 'PATCH' }),
  deleteListing: listingId => request(`/listings/${encodeURIComponent(listingId)}`, { method: 'DELETE' }),
  orders: () => request('/orders'),
  updateOrderStatus: (orderId, status) => request(`/orders/${encodeURIComponent(orderId)}/status`, { method: 'PATCH', body: json({ status }) }),
  setDeliverySchedule: (orderId, expectedDeliveryAt) => request(`/orders/${encodeURIComponent(orderId)}/delivery-schedule`, { method: 'PATCH', body: json({ expectedDeliveryAt }) }),
  adminOverview: () => request('/admin/overview'),
  adminListings: () => request('/admin/listings'),
  removeAdminListing: listingId => request(`/admin/listings/${encodeURIComponent(listingId)}`, { method: 'DELETE' }),
  adminUsers: () => request('/admin/users'),
  adminFisherman: userId => request(`/admin/fishermen/${encodeURIComponent(userId)}`),
  adminReputation: () => request('/admin/reputation'),
  adminReviews: () => request('/admin/reviews'),
  moderateReview: (reviewId, body) => request(`/admin/reviews/${encodeURIComponent(reviewId)}/moderation`, { method: 'PATCH', body: json(body) }),
  adminDisputes: () => request('/admin/disputes'),
  reviewDispute: (disputeId, body) => request(`/admin/disputes/${encodeURIComponent(disputeId)}/review`, { method: 'PATCH', body: json(body) }),
  setFishermanVerification: (userId, verified) => request(`/admin/fishermen/${encodeURIComponent(userId)}/verification`, { method: 'PATCH', body: json({ verified }) }),
  adminPriceAnalytics: () => request('/admin/price-analytics'),
  evaluatePriceModel: () => request('/admin/price-model/evaluate', { method: 'POST', body: json({}) }),
  registrationRequests: () => request('/admin/registration-requests'),
  acceptRegistration: requestId => request(`/admin/registration-requests/${encodeURIComponent(requestId)}/accept`, { method: 'PATCH' }),
  rejectRegistration: requestId => request(`/admin/registration-requests/${encodeURIComponent(requestId)}/reject`, { method: 'PATCH' }),
  createFisherman: body => request('/admin/fishermen', { method: 'POST', body: json(body) })
};
