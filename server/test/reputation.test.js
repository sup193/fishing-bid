import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateFishermanReputation,
  isVerifiedPaidOrder,
  reputationLevel
} from '../src/reputation.js';

const fisherman = { id: 'seller-1', verificationStatus: 'verified' };
const paidCompletedOrder = {
  id: 'order-1',
  fisherman: fisherman.id,
  buyer: 'buyer-1',
  listing: 'listing-1',
  paymentStatus: 'paid',
  gateway: 'razorpay',
  transactionRef: 'pay_verified',
  orderStatus: 'completed',
  expectedDeliveryAt: '2026-03-05T00:00:00.000Z',
  deliveredAt: '2026-03-04T00:00:00.000Z'
};

test('maps trust scores to the published reputation levels', () => {
  assert.equal(reputationLevel(90), 'Excellent');
  assert.equal(reputationLevel(89), 'Trusted');
  assert.equal(reputationLevel(75), 'Trusted');
  assert.equal(reputationLevel(74), 'Good');
  assert.equal(reputationLevel(60), 'Good');
  assert.equal(reputationLevel(59), 'Average');
  assert.equal(reputationLevel(40), 'Average');
  assert.equal(reputationLevel(39), 'Needs Improvement');
});

test('only captured, non-demo Razorpay orders with transaction references are verified', () => {
  assert.equal(isVerifiedPaidOrder(paidCompletedOrder), true);
  assert.equal(isVerifiedPaidOrder({ ...paidCompletedOrder, transactionRef: undefined }), false);
  assert.equal(isVerifiedPaidOrder({ ...paidCompletedOrder, demo: true }), false);
  assert.equal(isVerifiedPaidOrder(paidCompletedOrder, { demo: true }), false);
  assert.equal(isVerifiedPaidOrder({ ...paidCompletedOrder, gateway: 'practice' }), false);
});

test('calculates only evidence-backed reputation factors and hides unapproved reviews', () => {
  const result = calculateFishermanReputation({
    fisherman,
    orders: [
      paidCompletedOrder,
      { ...paidCompletedOrder, id: 'demo', demo: true, orderStatus: 'completed' },
      { ...paidCompletedOrder, id: 'unverified', transactionRef: '', orderStatus: 'cancelled' }
    ],
    listings: [{ id: 'listing-1', fishType: 'Tuna' }],
    reviews: [
      { id: 'approved', fisherman: fisherman.id, order: paidCompletedOrder.id, rating: 5, status: 'approved', createdAt: '2026-03-05T00:00:00.000Z' },
      { id: 'pending', fisherman: fisherman.id, order: paidCompletedOrder.id, rating: 1, status: 'pending' }
    ],
    disputes: [
      { id: 'unconfirmed', fisherman: fisherman.id, order: paidCompletedOrder.id, finding: 'pending' }
    ]
  });

  assert.equal(result.status, 'rated');
  assert.equal(result.verifiedOrderCount, 1);
  assert.equal(result.completedOrderCount, 1);
  assert.equal(result.averageRating, 5);
  assert.equal(result.onTimeDeliveryPercent, 100);
  assert.equal(result.confirmedDisputeCount, 0);
  assert.deepEqual(result.recentReviews.map(review => review.id), ['approved']);
  assert.equal(result.recentReviews[0].buyerLabel, 'Verified buyer');
});

test('leaves fishermen without verified activity unrated rather than granting an earned badge', () => {
  const result = calculateFishermanReputation({
    fisherman,
    orders: [{ ...paidCompletedOrder, transactionRef: '', orderStatus: 'completed' }],
    reviews: [{ id: 'review', fisherman: fisherman.id, order: 'order-1', rating: 5, status: 'approved' }]
  });

  assert.equal(result.score, 0);
  assert.equal(result.status, 'unrated');
  assert.equal(result.level, 'Not yet rated');
  assert.equal(result.averageRating, null);
});

test('excludes unverified seller cancellations from the cancellation factor', () => {
  const input = {
    fisherman,
    orders: [paidCompletedOrder],
    listings: [{ id: 'listing-1' }]
  };
  const verifiedOnly = calculateFishermanReputation(input);
  const withUnverifiedCancellation = calculateFishermanReputation({
    ...input,
    orders: [
      ...input.orders,
      {
        ...paidCompletedOrder,
        id: 'unverified-cancellation',
        transactionRef: '',
        orderStatus: 'cancelled',
        cancellationActor: 'fisherman'
      }
    ]
  });

  assert.equal(verifiedOnly.cancellationPercent, 0);
  assert.equal(withUnverifiedCancellation.cancellationPercent, 0);
  assert.equal(
    withUnverifiedCancellation.factors.find(item => item.key === 'cancellations').score,
    verifiedOnly.factors.find(item => item.key === 'cancellations').score
  );
});
