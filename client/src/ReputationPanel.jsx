const percent = value => value === null || value === undefined ? 'Not enough recorded data' : `${Number(value).toFixed(1)}%`;

export default function ReputationPanel({ reputation, title = 'Your reputation' }) {
  if (!reputation) return <section className="panel reputation-panel"><p className="empty">Loading your verified marketplace activity…</p></section>;
  return <section className="panel reputation-panel">
    <div className="panel-title"><div><p className="kicker">TRANSPARENT TRUST SCORE</p><h2>{title}</h2></div>
      <span className={`reputation-badge reputation-${reputation.status === 'rated' ? reputation.level?.toLowerCase().replace(/\s+/g, '-') : 'unrated'}`}>
        {reputation.verified && <span aria-label="Verified fisherman">✓ </span>}{reputation.level}
      </span>
    </div>
    <div className="reputation-overview">
      <div className={`trust-score trust-score-${reputation.status}`}><strong>{reputation.status === 'rated' ? reputation.score : '—'}</strong><span>{reputation.status === 'rated' ? 'out of 100' : 'Not yet rated'}</span></div>
      <div className="reputation-stats">
        <article><span>Average rating</span><strong>{reputation.averageRating === null ? '—' : `${reputation.averageRating.toFixed(1)} / 5`}</strong></article>
        <article><span>Verified completed orders</span><strong>{reputation.completedOrderCount || 0}</strong></article>
        <article><span>Successful deliveries</span><strong>{percent(reputation.successfulDeliveryPercent)}</strong></article>
        <article><span>Recorded cancellations</span><strong>{percent(reputation.cancellationPercent)}</strong></article>
      </div>
    </div>
    {reputation.status === 'unrated' && <p className="reputation-unrated-note">No verified paid orders are on record yet. This is not a negative rating; a level is assigned after verified activity.</p>}
    <div className="reputation-breakdown">
      <h3>How the score is calculated</h3>
      {reputation.factors?.map(item => <article key={item.key} className="reputation-factor">
        <div><strong>{item.key.replace(/([A-Z])/g, ' $1')}</strong><span>{item.explanation}</span></div>
        <span className="reputation-factor-score">{item.score === null ? '—' : `${Math.round(item.score)}/100`}<small>{item.weight}% weight</small></span>
      </article>)}
    </div>
    {!!reputation.improvements?.length && <div className="reputation-improvements"><strong>Ways to build trust</strong><ul>{reputation.improvements.map(item => <li key={item}>{item}</li>)}</ul></div>}
    <div className="reputation-reviews">
      <h3>Recent buyer reviews</h3>
      {reputation.recentReviews?.length ? reputation.recentReviews.map(review => <article key={review.id}>
        <div><strong>{review.buyerLabel} · {'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}</strong><small>{review.fishType} · {review.createdAt ? new Date(review.createdAt).toLocaleDateString() : ''}</small></div>
        {review.comment && <p>{review.comment}</p>}
      </article>) : <p className="empty">Approved reviews from verified completed orders will appear here.</p>}
    </div>
  </section>;
}
