import { useEffect, useState } from 'react';
import { Activity, ClipboardList, Eye, EyeOff, Fish, Gavel, LogIn, LogOut, Mail, MapPin, Menu, ReceiptText, ShipWheel, ShoppingBag, Store, UserRound, Users, X } from 'lucide-react';
import { api } from './api.js';
import UserApp from './user/UserApp.jsx';
import AdminDashboard from './admin/AdminDashboard.jsx';
import FishermanDashboard from './fisherman/FishermanDashboard.jsx';

export default function App() {
  const [user, setUser] = useState(() => JSON.parse(localStorage.getItem('tide_user') || 'null'));
  const [authMode, setAuthMode] = useState(null);
  const [menu, setMenu] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [fishermanView, setFishermanView] = useState('inventory');

  const auth = async form => {
    const result = authMode === 'login' ? await api.login(form) : await api.register(form);
    if (result.status === 'pending') return result;
    completeAuthentication(result);
  };
  const completeAuthentication = result => {
    if (!result?.token) return;
    localStorage.setItem('tide_token', result.token);
    localStorage.setItem('tide_user', JSON.stringify(result.user));
    setUser(result.user);
    setAuthMode(null);
  };
  const logout = () => {
    localStorage.clear();
    setUser(null);
  };
  const rolePage = user?.role === 'admin'
    ? <AdminDashboard />
    : user?.role === 'fisherman'
      ? <FishermanDashboard initialView={fishermanView} onViewChange={setFishermanView} />
      : <UserApp user={user} onAuth={setAuthMode} />;

  return <>
    <header className="topbar">
      <a className="brand" href="/"><span className="brand-mark"><ShipWheel size={20} /></span>Tide<span>Market</span></a>
      <button className="mobile-menu" onClick={() => setMenu(!menu)} aria-label={menu ? 'Close navigation' : 'Open navigation'}>{menu ? <X /> : <Menu />}</button>
      <nav className={menu ? 'open' : ''}>
        {user?.role !== 'buyer' && user?.role !== 'admin' && user?.role !== 'fisherman' && <a href="#market" onClick={() => setMenu(false)}>Marketplace</a>}
        {user?.role === 'buyer' && <button className="user-name profile-trigger" onClick={() => setShowProfile(true)} aria-label={`Open buyer profile for ${user.name}`}><UserRound size={15} /> {user.name}</button>}
        {user?.role === 'admin' && <button className="user-name profile-trigger" onClick={() => setShowProfile(true)} aria-label={`Open admin profile for ${user.name}`}><UserRound size={15} /> {user.name}</button>}
        {user
          ? <>{user.role === 'fisherman' && <button className="user-name profile-trigger" onClick={() => setShowProfile(true)} aria-label={`Open fisherman profile for ${user.name}`}><UserRound size={15} /> {user.name}</button>}{user.role !== 'buyer' && user.role !== 'fisherman' && user.role !== 'admin' && <span className="user-name"><UserRound size={15} /> {user.name}</span>}{user.role !== 'buyer' && user.role !== 'fisherman' && <button className="text-button" onClick={logout}>Log out</button>}</>
          : <><button className="button dark" onClick={() => setAuthMode('login')}><LogIn size={16} /> Log in</button><button className="text-button" onClick={() => setAuthMode('register')}>Sign up</button></>}
      </nav>
    </header>
    {rolePage}
    {showProfile && user && <ProfileDialog user={user} onClose={() => setShowProfile(false)} onLogout={() => { logout(); setShowProfile(false); }} onNavigate={view => { setFishermanView(view); setShowProfile(false); }} />}
    {authMode && <AuthModal mode={authMode} onClose={() => setAuthMode(null)} onSwitch={() => setAuthMode(authMode === 'login' ? 'register' : 'login')} onSubmit={auth} onAuthenticated={completeAuthentication} />}
  </>;
}
function ProfileDialog({ user, onClose, onLogout, onNavigate }) {
  const fisherman = user.role === 'fisherman';
  const admin = user.role === 'admin';
  const name = user.name || 'TideMarket member';
  const initials = name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();

  return <div className="modal-backdrop profile-backdrop" onClick={onClose}>
    <section className={`profile-dialog profile-dialog-${admin ? 'admin' : fisherman ? 'fisherman' : 'buyer'}`} role="dialog" aria-modal="true" aria-labelledby="profile-title" onClick={event => event.stopPropagation()}>
      <button className="close profile-close" onClick={onClose} aria-label="Close profile"><X size={20} /></button>
      <div className="profile-banner">
        <span className="profile-avatar">{initials || <UserRound size={28} />}</span>
        <div className="profile-identity">
          <p className="profile-eyebrow">{admin ? 'ADMIN PROFILE' : fisherman ? 'FISHERMAN PROFILE' : 'BUYER PROFILE'}</p>
          <h2 id="profile-title">{name}</h2>
          <span className="profile-role-badge">{admin ? <ShipWheel size={14} /> : fisherman ? <Fish size={14} /> : <ShoppingBag size={14} />}{admin ? 'Marketplace admin' : fisherman ? 'Coastal seller' : 'Seafood buyer'}</span>
        </div>
        <span className="profile-wave-mark" aria-hidden="true"><Activity size={33} /></span>
      </div>
      <div className="profile-content">
        <div className="profile-details">
          <article><span className="profile-detail-icon"><Mail size={17} /></span><div><small>Email address</small><strong>{user.email || 'Not provided'}</strong></div></article>
          {(user.location || user.phone) && <article><span className="profile-detail-icon"><MapPin size={17} /></span><div><small>{user.location ? 'Port or location' : 'Phone number'}</small><strong>{user.location || user.phone}</strong></div></article>}
          <article><span className="profile-detail-icon"><UserRound size={17} /></span><div><small>Account type</small><strong>{admin ? 'Admin account' : fisherman ? 'Fisherman account' : 'Buyer account'}</strong></div></article>
        </div>
        <div className="profile-features">
          <p className="profile-section-label">{admin ? 'YOUR ADMIN TOOLS' : fisherman ? 'YOUR FISHERMAN TOOLS' : 'YOUR BUYER SHORTCUTS'}</p>
          <p className="profile-features-note">{admin ? 'Control the marketplace, review buyer requests, and keep the coastal network moving.' : fisherman ? 'These shortcuts open your inventory, buyer orders, auction history, or payment records.' : 'These shortcuts take you straight to the marketplace, your bids and orders, or payment records.'}</p>
          {admin
            ? <div className="profile-feature-grid">
              <button type="button" onClick={onClose}><Users size={17} /><span><strong>Manage fishermen</strong><small>Open the network view for partner accounts</small></span></button>
              <button type="button" onClick={onClose}><Store size={17} /><span><strong>Marketplace listings</strong><small>Review live catches and remove listings</small></span></button>
              <button type="button" onClick={onClose}><ClipboardList size={17} /><span><strong>Buyer requests</strong><small>Approve or reject new buyer signups</small></span></button>
              <button type="button" onClick={onClose}><Gavel size={17} /><span><strong>Bid review</strong><small>Check auction activity and bidding patterns</small></span></button>
            </div>
            : fisherman
              ? <div className="profile-feature-grid">
                <button onClick={() => onNavigate('inventory')}><Fish size={17} /><span><strong>Catch inventory</strong><small>Manage sale and bidding listings</small></span></button>
                <button onClick={() => onNavigate('orders')}><ShoppingBag size={17} /><span><strong>Buyer orders</strong><small>Review orders and fulfillment</small></span></button>
                <button onClick={() => onNavigate('bids')}><Gavel size={17} /><span><strong>Auction activity</strong><small>Follow bids and auction history</small></span></button>
                <button onClick={() => onNavigate('transactions')}><ReceiptText size={17} /><span><strong>Transactions</strong><small>Review payment activity</small></span></button>
              </div>
              : <div className="profile-feature-grid">
                <a href="#market" onClick={onClose}><Fish size={17} /><span><strong>Explore seafood</strong><small>Browse catches and live auctions</small></span></a>
                <a href="#history" onClick={onClose}><Gavel size={17} /><span><strong>Bids &amp; orders</strong><small>Review your marketplace activity</small></span></a>
                <a href="#transactions" onClick={onClose}><ReceiptText size={17} /><span><strong>Transactions</strong><small>Check your payment status</small></span></a>
              </div>}
        </div>
        <button className="profile-logout" onClick={onLogout}><LogOut size={16} /> Log out of TideMarket</button>
      </div>
    </section>
  </div>;
}
function AuthModal({ mode, onClose, onSwitch, onSubmit, onAuthenticated }) {
  const [form, setForm] = useState({});
  const [error, setError] = useState('');
  const [pending, setPending] = useState(null);
  const [otp, setOtp] = useState('');
  const [seconds, setSeconds] = useState(0);
  const [submittingOtp, setSubmittingOtp] = useState(false);
  const [resending, setResending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const change = event => setForm({ ...form, [event.target.name]: event.target.value });
  useEffect(() => {
    if (!seconds) return undefined;
    const timer = window.setInterval(() => setSeconds(value => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [seconds]);
  const submit = async event => {
    event.preventDefault();
    setError('');
    try {
      const result = await onSubmit(form);
      if (result?.status === 'pending') {
        setPending(result);
        setSeconds(60);
      }
    } catch (err) {
      setError(err.message);
    }
  };
  const verifyOtp = async event => {
    event.preventDefault();
    setError('');
    if (!/^\d{6}$/.test(otp)) {
      setError('Enter the 6-digit verification code.');
      return;
    }
    setSubmittingOtp(true);
    try {
      const result = await api.verifyOtp({ email: pending.email, otp });
      if (result.status === 'pending') {
        setPending(null);
        setOtp('');
        setError(result.message);
        return;
      }
      onAuthenticated(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmittingOtp(false);
    }
  };
  const resendOtp = async () => {
    setError('');
    setResending(true);
    try {
      const result = await api.resendOtp({ email: pending.email });
      setSeconds(60);
      setOtp('');
    } catch (err) {
      setError(err.message);
    } finally {
      setResending(false);
    }
  };

  return <div className="modal-backdrop" onClick={onClose}>
    <div className="modal auth-modal" onClick={event => event.stopPropagation()}>
      <button className="close" onClick={onClose}>×</button>
      <p className="kicker">TIDEMARKET ACCOUNT</p>
      {pending ? <>
        <h2>Verify your email.</h2>
        <p>Enter the 6-digit code sent to {pending.email.replace(/(^.).*(@.*$)/, '$1•••$2')}.</p>
        <form onSubmit={verifyOtp} autoComplete="one-time-code">
          <input name="otp" inputMode="numeric" pattern="[0-9]*" maxLength={6} placeholder="6-digit code" value={otp} onChange={event => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))} required />
          {error && <p className="form-error">{error}</p>}
          {seconds <= 0 ? <button className="switch-auth" type="button" onClick={resendOtp} disabled={resending}>{resending ? 'Sending…' : 'Resend OTP'}</button> : <p>Resend available in {seconds}s</p>}
          <button className="button primary full" type="submit" disabled={submittingOtp}>{submittingOtp ? 'Verifying…' : 'Verify email'}</button>
        </form>
      </> : <>
        <h2>{mode === 'login' ? 'Welcome back to the water.' : 'Create your account.'}</h2>
        <form onSubmit={submit} autoComplete="on">
          {mode === 'register' && <>
            <input name="name" placeholder="Full name" autoComplete="name" onChange={change} required />
            <input name="phone" placeholder="Mobile number" autoComplete="tel" onChange={change} />
            <select name="role" value={form.role || ''} onChange={change} required>
              <option value="" disabled>Select account role</option>
              <option value="buyer">Buyer</option>
              <option value="fisherman">Fisherman</option>
            </select>
          </>}
          <input name="email" type="email" placeholder="Email address" autoComplete="username" onChange={change} required />
          <div className="password-field">
            <input name="password" type={showPassword ? 'text' : 'password'} placeholder="Password" onChange={change} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={mode === 'register' ? 8 : undefined} />
            <button className="password-toggle" type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} onClick={() => setShowPassword(visible => !visible)}>
              {showPassword ? <EyeOff size={19} aria-hidden="true" /> : <Eye size={19} aria-hidden="true" />}
            </button>
          </div>
          {error && <p className="form-error">{error}</p>}
          <button className="button primary full" type="submit">{mode === 'login' ? 'Log in' : 'Create account'}</button>
        </form>
      </>}
      <p className="switch-auth-prompt">
        {mode === 'login' ? 'New to TideMarket?' : 'Already have an account?'}
        <button className="switch-auth" onClick={onSwitch}>{mode === 'login' ? 'Sign up' : 'Log in'}</button>
      </p>
    </div>
  </div>;
}
