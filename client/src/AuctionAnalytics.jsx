import { useEffect, useState } from 'react';
import { Activity, AlertTriangle, BarChart3, Gavel, ShieldCheck } from 'lucide-react';
import { api } from './api.js';

export default function AuctionAnalytics() {
  const [filters, setFilters] = useState({});
  const [draft, setDraft] = useState({ from: '', to: '', fishType: '', category: '', location: '', status: '' });
  const [analytics, setAnalytics] = useState(null);
  const [reports, setReports] = useState([]);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let active = true;
    Promise.all([api.adminAuctionAnalytics(filters), api.adminAuctionChatReports()])
      .then(([summary, pendingReports]) => {
        if (!active) return;
        setAnalytics(summary);
        setReports(pendingReports);
        setError('');
      })
      .catch(loadError => { if (active) setError(loadError.message); });
    return () => { active = false; };
  }, [filters, refresh]);

  const moderate = async (id, status) => {
    try {
      await api.moderateAuctionMessage(id, { status, moderationNote: status === 'hidden' ? 'Hidden after admin review' : 'Restored after admin review' });
      setRefresh(value => value + 1);
    } catch (moderationError) {
      setError(moderationError.message);
    }
  };

  const summary = analytics?.summary || {};
  return <section className="panel auction-analytics">
    <div className="panel-title"><div><p className="kicker">MARKETPLACE OVERSIGHT</p><h2>AI auction analytics</h2></div><span>Rule-based activity signals · admin review</span></div>
    <p className="history-note">The auction guide combines verified paid auction history with current bidding activity. Sparse history uses a clearly labeled baseline. Review signals do not prove misconduct and never block bids.</p>
    <form className="auction-analytics-filters" onSubmit={event => {
      event.preventDefault();
      setFilters(Object.fromEntries(Object.entries(draft).filter(([, value]) => value)));
    }}>
      <label>From<input type="date" value={draft.from} onChange={event => setDraft({ ...draft, from: event.target.value })} /></label>
      <label>To<input type="date" value={draft.to} onChange={event => setDraft({ ...draft, to: event.target.value })} /></label>
      <label>Fish species<input value={draft.fishType} onChange={event => setDraft({ ...draft, fishType: event.target.value })} placeholder="All species" /></label>
      <label>Category<input value={draft.category} onChange={event => setDraft({ ...draft, category: event.target.value })} placeholder="All categories" /></label>
      <label>Location<input value={draft.location} onChange={event => setDraft({ ...draft, location: event.target.value })} placeholder="All locations" /></label>
      <label>Status<select value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value })}><option value="">All statuses</option><option value="active">Active</option><option value="completed">Completed</option><option value="scheduled">Scheduled</option><option value="cancelled">Cancelled</option></select></label>
      <button className="button primary">Apply filters</button>
    </form>
    {error && <p className="notice" role="alert">{error}</p>}
    {analytics && <div className="metrics admin-metrics">
      <Metric icon={<Gavel />} label="Auctions" value={summary.totalAuctions} detail={`${summary.activeAuctions} active`} />
      <Metric icon={<Activity />} label="Completed" value={summary.completedAuctions} detail="Closed auctions" />
      <Metric icon={<BarChart3 />} label="Recorded bids" value={summary.totalBids} detail="All filtered auctions" />
      <Metric icon={<AlertTriangle />} label="Review signals" value={summary.flaggedAuctions} detail="Needs human review" />
    </div>}
    <div className="auction-analytics-grid">
      <section><h3>Species activity</h3>{analytics?.bySpecies?.length
        ? analytics.bySpecies.map(item => <article className="auction-analytics-row" key={item.fishType}><strong>{item.fishType}</strong><span>{item.auctions} auctions</span><span>{item.bids} bids</span></article>)
        : <p className="empty">No auctions match these filters.</p>}</section>
      <section><h3>Activity review signals</h3>{analytics?.flaggedAuctions?.length
        ? analytics.flaggedAuctions.map(item => <article className="auction-analytics-alert" key={item.id}><AlertTriangle size={15} /><div><strong>{item.fishType} · {item.location || 'Location unavailable'}</strong><small>{item.activity.flags.map(flag => flag.detail).join(' · ')}</small></div></article>)
        : <p className="empty">No auction-level review signals in this result.</p>}</section>
      <section><h3>Location activity</h3>{analytics?.byLocation?.length
        ? analytics.byLocation.map(item => <article className="auction-analytics-row" key={item.location}><strong>{item.location}</strong><span>{item.auctions} auctions</span><span>{item.bids} bids</span></article>)
        : <p className="empty">No location data is available for these auctions.</p>}</section>
    </div>
    <section className="auction-chat-moderation"><h3><ShieldCheck size={16} /> Reported chat messages</h3>
      {reports.length ? reports.map(report => <article key={report.id}><div><strong>{report.message?.authorName || 'Marketplace member'}</strong><p>{report.message?.content || 'Message no longer available'}</p><small>{report.reason || 'No reason provided'} · reported by {report.reporterName}</small></div>
        {report.message && <div className="request-actions"><button className="button small danger" onClick={() => moderate(report.message.id, 'hidden')}>Hide</button><button className="button small secondary" onClick={() => moderate(report.message.id, 'published')}>Keep visible</button></div>}</article>)
        : <p className="empty">No chat reports awaiting review.</p>}
    </section>
    {analytics && <small className="auction-analytics-footnote">Insight model: {analytics.modelVersion}. Estimates use verified paid auction sales only; low-data projections are not accuracy claims.</small>}
  </section>;
}

function Metric({ icon, label, value, detail }) {
  return <article className="metric"><span className="metric-icon">{icon}</span><span>{label}</span><strong>{value ?? '—'}</strong><small>{detail}</small></article>;
}
