const API = '/api';

export async function request(path, options = {}) {
  const token = localStorage.getItem('tide_token');
  const isForm = options.body instanceof FormData;
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      ...(isForm ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || 'Request failed');
  return data;
}

export const api = {
  detectFish: file => { const form = new FormData(); form.append('image', file); return request('/fish-detection', { method: 'POST', body: form }); },
  uploadFishImage: file => { const form = new FormData(); form.append('image', file); return request('/uploads/image', { method: 'POST', body: form }); },
  listings: (params = '') => request(`/listings${params}`),
  marketTrends: (days = 7) => request(`/market/trends?days=${encodeURIComponent(days)}`),
  listing: id => request(`/listings/${id}`),
  login: body => request('/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  register: body => request('/auth/register', { method: 'POST', body: JSON.stringify(body) }),
  me: () => request('/auth/me'),
  updatePreferredLanguage: preferredLanguage => request('/auth/preferences', { method: 'PATCH', body: JSON.stringify({ preferredLanguage }) }),
  orders: () => request('/orders'),
  updateOrderStatus: (orderId, status) => request(`/orders/${encodeURIComponent(orderId)}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  setDeliverySchedule: (orderId, expectedDeliveryAt) => request(`/orders/${encodeURIComponent(orderId)}/delivery-schedule`, { method: 'PATCH', body: JSON.stringify({ expectedDeliveryAt }) }),
  transactions: () => request('/transactions'),
  buyerHistory: () => request('/buyer/history'),
  buyerReviews: () => request('/buyer/reviews'),
  submitOrderReview: (orderId, body) => request(`/orders/${encodeURIComponent(orderId)}/reviews`, { method: 'POST', body: JSON.stringify(body) }),
  reportOrderDispute: (orderId, complaint) => request(`/orders/${encodeURIComponent(orderId)}/disputes`, { method: 'POST', body: JSON.stringify({ complaint }) }),
  fishermanReputation: () => request('/fisherman/reputation'),
  pricePrediction: body => request('/price-predictions', { method: 'POST', body: JSON.stringify(body) }),
  previewPricePrediction: body => request('/price-predictions/preview', { method: 'POST', body: JSON.stringify(body) }),
  adminReputation: () => request('/admin/reputation'),
  adminReviews: () => request('/admin/reviews'),
  moderateReview: (id, body) => request(`/admin/reviews/${encodeURIComponent(id)}/moderation`, { method: 'PATCH', body: JSON.stringify(body) }),
  adminDisputes: () => request('/admin/disputes'),
  reviewDispute: (id, body) => request(`/admin/disputes/${encodeURIComponent(id)}/review`, { method: 'PATCH', body: JSON.stringify(body) }),
  setFishermanVerification: (id, verified) => request(`/admin/fishermen/${encodeURIComponent(id)}/verification`, { method: 'PATCH', body: JSON.stringify({ verified }) }),
  adminPriceAnalytics: () => request('/admin/price-analytics'),
  evaluatePriceModel: () => request('/admin/price-model/evaluate', { method: 'POST', body: JSON.stringify({}) }),
  bidMonitoring: () => request('/bid-monitoring'),
  recommendations: () => request('/recommendations'),
  auction: id => request(`/auctions/${id}`),
  bid: (id, amount, requestId) => request(`/auctions/${id}/bids`, { method: 'POST', body: JSON.stringify({ amount, requestId }) }),
  automaticBidding: (id, maxAmount, requestId) => request(`/auctions/${id}/automatic-bidding`, { method: 'POST', body: JSON.stringify({ maxAmount, requestId }) }),
  automaticBiddingStatus: id => request(`/auctions/${id}/automatic-bidding`),
  disableAutomaticBidding: id => request(`/auctions/${id}/automatic-bidding`, { method: 'DELETE' }),
  notifications: () => request('/notifications'),
  markNotificationRead: id => request(`/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH' }),
  createPayment: body => request('/payments/razorpay/orders', { method: 'POST', body: JSON.stringify(body) }),
  verifyPayment: body => request('/payments/razorpay/verify', { method: 'POST', body: JSON.stringify(body) }),
  recordPaymentFailure: body => request('/payments/razorpay/failure', { method: 'POST', body: JSON.stringify(body) }),
  adminOverview: () => request('/admin/overview'),
  adminListings: () => request('/admin/listings'),
  removeAdminListing: id => request(`/admin/listings/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  adminUsers: () => request('/admin/users'),
  adminFisherman: id => request(`/admin/fishermen/${id}`),
  registrationRequests: () => request('/admin/registration-requests'),
  acceptRegistration: id => request(`/admin/registration-requests/${id}/accept`, { method: 'PATCH' }),
  rejectRegistration: id => request(`/admin/registration-requests/${id}/reject`, { method: 'PATCH' }),
  createFisherman: body => request('/admin/fishermen', { method: 'POST', body: JSON.stringify(body) }),
  fishermanListings: () => request('/fisherman/listings'),
  fishermanSales: () => request('/fisherman/sales'),
  deleteListing: id => request(`/listings/${id}`, { method: 'DELETE' }),
  meta: () => request('/meta'),
  createListing: body => request('/listings', { method: 'POST', body: JSON.stringify(body) }),
  updateListing: (id, body) => request(`/listings/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  createAuction: (id, body) => request(`/listings/${id}/auction`, { method: 'POST', body: JSON.stringify(body) }),
  closeAuction: id => request(`/auctions/${id}/close`, { method: 'PATCH' })
};
