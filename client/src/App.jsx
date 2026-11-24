import { useEffect, useRef, useState } from 'react';
import { Activity, ClipboardList, Eye, EyeOff, Fish, Gavel, LogIn, LogOut, Mail, MapPin, Menu, ReceiptText, ShipWheel, ShoppingBag, Store, UserRound, Users, X } from 'lucide-react';
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api } from './api.js';
import useDialogAccessibility from './useDialogAccessibility.js';
import UserApp from './user/UserApp.jsx';
import AdminDashboard from './admin/AdminDashboard.jsx';
import FishermanDashboard from './fisherman/FishermanDashboard.jsx';

export default function App() {
  const [user, setUser] = useState(() => localStorage.getItem('tide_token')
    ? JSON.parse(localStorage.getItem('tide_user') || 'null')
    : null);
  const [authMode, setAuthMode] = useState(null);
  const [sessionLoading, setSessionLoading] = useState(() => Boolean(localStorage.getItem('tide_token')));
  const [menu, setMenu] = useState(false);
  const menuButtonRef = useRef(null);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (location.pathname === '/login') setAuthMode('login');
    else if (location.pathname === '/register') setAuthMode('register');
    else setAuthMode(null);
  }, [location.pathname]);
  useEffect(() => setMenu(false), [location.pathname]);
  useEffect(() => {
    if (!menu) return undefined;
    const closeOnEscape = event => {
      if (event.key !== 'Escape') return;
      setMenu(false);
      menuButtonRef.current?.focus();
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [menu]);

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
    navigate('/dashboard', { replace: true });
  };
  useEffect(() => {
    const token = localStorage.getItem('tide_token');
    if (!token) {
      localStorage.removeItem('tide_user');
      setUser(null);
      setSessionLoading(false);
      return;
    }
    api.me()
      .then(result => {
        localStorage.setItem('tide_user', JSON.stringify(result.user));
        setUser(result.user);
      })
      .catch(error => {
        if (error.status === 401) {
          localStorage.removeItem('tide_token');
          localStorage.removeItem('tide_user');
          setUser(null);
        }
      })
      .finally(() => setSessionLoading(false));
  }, []);
  const logout = () => {
    localStorage.removeItem('tide_token');
    localStorage.removeItem('tide_user');
    setUser(null);
    navigate('/login', { replace: true });
  };
  const openAuth = mode => navigate(mode === 'register' ? '/register' : '/login');
  const homeForUser = user?.role === 'admin' ? '/admin' : '/dashboard';
  const routeView = view => <RouteGuard user={user} loading={sessionLoading}>
    {user?.role === 'buyer'
      ? <UserApp user={user} onAuth={openAuth} view={view} />
      : user?.role === 'fisherman'
        ? <FishermanDashboard initialView={view} onViewChange={nextView => navigate(fishermanPath(nextView))} />
        : <AdminDashboard initialView={view} />}
  </RouteGuard>;
  const buyerRoute = view => <RouteGuard user={user} loading={sessionLoading} roles={['buyer']}>
    <UserApp user={user} onAuth={openAuth} view={view} />
  </RouteGuard>;
  const fishermanRoute = view => <RouteGuard user={user} loading={sessionLoading} roles={['fisherman']}>
    <FishermanDashboard initialView={view} onViewChange={nextView => navigate(fishermanPath(nextView))} />
  </RouteGuard>;
  const adminRoute = view => <RouteGuard user={user} loading={sessionLoading} roles={['admin']}>
    <AdminDashboard initialView={view} />
  </RouteGuard>;
  const guestOrBuyerRoute = view => user && user.role !== 'buyer'
    ? <Navigate to={homeForUser} replace />
    : <UserApp user={user?.role === 'buyer' ? user : null} onAuth={openAuth} view={view} />;

  return <>
    <header className="topbar">
      <Link className="brand" to="/"><span className="brand-mark"><ShipWheel size={20} /></span>Tide<span>Market</span></Link>
      <button ref={menuButtonRef} className="mobile-menu" onClick={() => setMenu(!menu)} aria-label={menu ? 'Close navigation' : 'Open navigation'} aria-expanded={menu} aria-controls="site-navigation">{menu ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}</button>
      <nav id="site-navigation" className={menu ? 'open' : ''} aria-label="Primary navigation">
        {!user && <><NavLink to="/" onClick={() => setMenu(false)}>Home</NavLink><NavLink to="/auctions" onClick={() => setMenu(false)}>Auctions</NavLink><button className="button dark" onClick={() => { setMenu(false); openAuth('login'); }}><LogIn size={16} /> Log in</button><button className="text-button" onClick={() => { setMenu(false); openAuth('register'); }}>Sign up</button></>}
        {user && <><button className="user-name profile-trigger" onClick={() => { setMenu(false); navigate('/profile'); }} aria-label={`Open ${user.role} profile for ${user.name}`}><UserRound size={15} /> {user.name}</button><button className="text-button" onClick={() => { setMenu(false); logout(); }}>Log out</button></>}
      </nav>
    </header>
    <Routes>
      <Route path="/" element={user ? <Navigate to={homeForUser} replace /> : <UserApp user={null} onAuth={openAuth} view="home" />} />
      <Route path="/login" element={user ? <Navigate to={homeForUser} replace /> : <UserApp user={null} onAuth={openAuth} view="home" />} />
      <Route path="/register" element={user ? <Navigate to={homeForUser} replace /> : <UserApp user={null} onAuth={openAuth} view="home" />} />
      <Route path="/dashboard" element={routeView(user?.role === 'fisherman' ? 'inventory' : user?.role === 'admin' ? 'fishermen' : 'dashboard')} />
      <Route path="/auctions" element={guestOrBuyerRoute('market')} />
      <Route path="/auctions/:id" element={guestOrBuyerRoute('market')} />
      <Route path="/profile" element={<RouteGuard user={user} loading={sessionLoading}><ProfilePage user={user} onLogout={logout} /></RouteGuard>} />
      <Route path="/bids" element={user?.role === 'fisherman' ? fishermanRoute('bids') : user?.role === 'admin' ? adminRoute('bids') : buyerRoute('history')} />
      <Route path="/transactions" element={user?.role === 'fisherman' ? fishermanRoute('transactions') : user?.role === 'admin' ? adminRoute('transactions') : buyerRoute('transactions')} />
      <Route path="/prices" element={user?.role === 'admin' ? adminRoute('trust') : user?.role === 'fisherman' ? fishermanRoute('inventory') : buyerRoute('prices')} />
      <Route path="/demand" element={user?.role === 'admin' ? adminRoute('demand') : user?.role === 'fisherman' ? fishermanRoute('demand') : buyerRoute('demand')} />
      <Route path="/notifications" element={buyerRoute('notifications')} />
      <Route path="/my-auctions" element={fishermanRoute('inventory')} />
      <Route path="/create-auction" element={fishermanRoute('create-auction')} />
      <Route path="/create-listing" element={fishermanRoute('create-listing')} />
      <Route path="/orders" element={fishermanRoute('orders')} />
      <Route path="/sales" element={fishermanRoute('sales')} />
      <Route path="/reputation" element={fishermanRoute('reputation')} />
      <Route path="/fisherman/bids" element={fishermanRoute('bids')} />
      <Route path="/fisherman/transactions" element={fishermanRoute('transactions')} />
      <Route path="/fisherman/demand" element={fishermanRoute('demand')} />
      <Route path="/admin" element={adminRoute('fishermen')} />
      <Route path="/admin/fishermen" element={adminRoute('fishermen')} />
      <Route path="/admin/fishermen/:id" element={adminRoute('fishermen')} />
      <Route path="/admin/listings" element={adminRoute('listings')} />
      <Route path="/admin/requests" element={adminRoute('requests')} />
      <Route path="/admin/bids" element={adminRoute('bids')} />
      <Route path="/admin/transactions" element={adminRoute('transactions')} />
      <Route path="/admin/trust" element={adminRoute('trust')} />
      <Route path="/admin/demand" element={adminRoute('demand')} />
      <Route path="/admin/auctions" element={adminRoute('auctions')} />
      <Route path="*" element={<NotFound user={user} />} />
    </Routes>
    {authMode && <AuthModal mode={authMode} onClose={() => navigate(user ? homeForUser : '/')} onSwitch={() => openAuth(authMode === 'login' ? 'register' : 'login')} onSubmit={auth} onAuthenticated={completeAuthentication} />}
  </>;
}

function RouteGuard({ user, loading, roles, children }) {
  const location = useLocation();
  if (loading) return <main className="dashboard route-loading" role="status">Restoring your session…</main>;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  if (roles && !roles.includes(user.role)) {
    return <Navigate to={user.role === 'admin' ? '/admin' : '/dashboard'} replace />;
  }
  return children;
}

function fishermanPath(view) {
  return ({
    inventory: '/my-auctions',
    'create-auction': '/create-auction',
    'create-listing': '/create-listing',
    orders: '/orders',
    sales: '/sales',
    reputation: '/reputation',
    demand: '/fisherman/demand',
    bids: '/fisherman/bids',
    transactions: '/fisherman/transactions'
  })[view] || '/my-auctions';
}

function ProfilePage({ user, onLogout }) {
  const admin = user.role === 'admin';
  const fisherman = user.role === 'fisherman';
  const name = user.name || 'TideMarket member';
  const initials = name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
  const shortcuts = admin
    ? [
      ['/admin/fishermen', <Users size={17} />, 'Manage fishermen', 'Review partner accounts'],
      ['/admin/listings', <Store size={17} />, 'Marketplace listings', 'Review published catches'],
      ['/admin/requests', <ClipboardList size={17} />, 'Fisherman approvals', 'Approve fisherman registrations'],
      ['/admin/bids', <Gavel size={17} />, 'Bid review', 'Review auction activity']
    ]
    : fisherman
      ? [
        ['/my-auctions', <Fish size={17} />, 'Catch inventory', 'Manage sale and bidding listings'],
        ['/orders', <ShoppingBag size={17} />, 'Buyer orders', 'Review orders and fulfillment'],
        ['/fisherman/bids', <Gavel size={17} />, 'Auction activity', 'Follow bids and auction history'],
        ['/fisherman/transactions', <ReceiptText size={17} />, 'Transactions', 'Review payment activity']
      ]
      : [
        ['/auctions', <Fish size={17} />, 'Explore seafood', 'Browse catches and live auctions'],
        ['/bids', <Gavel size={17} />, 'Bids & orders', 'Review marketplace activity'],
        ['/transactions', <ReceiptText size={17} />, 'Transactions', 'Check your payment status']
      ];

  return <main className={`dashboard profile-page profile-page-${admin ? 'admin' : fisherman ? 'fisherman' : 'buyer'}`}>
    <section className="profile-banner">
      <span className="profile-avatar">{initials || <UserRound size={28} />}</span>
      <div className="profile-identity">
        <p className="profile-eyebrow">{admin ? 'ADMIN PROFILE' : fisherman ? 'FISHERMAN PROFILE' : 'BUYER PROFILE'}</p>
        <h1>{name}</h1>
        <span className="profile-role-badge">{admin ? <ShipWheel size={14} /> : fisherman ? <Fish size={14} /> : <ShoppingBag size={14} />}{admin ? 'Marketplace admin' : fisherman ? 'Coastal seller' : 'Seafood buyer'}</span>
      </div>
      <span className="profile-wave-mark" aria-hidden="true"><Activity size={33} /></span>
    </section>
    <section className="panel profile-content">
      <div className="profile-details">
        <article><span className="profile-detail-icon"><Mail size={17} /></span><div><small>Email address</small><strong>{user.email || 'Not provided'}</strong></div></article>
        {(user.location || user.phone) && <article><span className="profile-detail-icon"><MapPin size={17} /></span><div><small>{user.location ? 'Port or location' : 'Phone number'}</small><strong>{user.location || user.phone}</strong></div></article>}
        <article><span className="profile-detail-icon"><UserRound size={17} /></span><div><small>Account type</small><strong>{admin ? 'Admin account' : fisherman ? 'Fisherman account' : 'Buyer account'}</strong></div></article>
      </div>
      <div className="profile-features">
        <p className="profile-section-label">{admin ? 'YOUR ADMIN TOOLS' : fisherman ? 'YOUR FISHERMAN TOOLS' : 'YOUR BUYER SHORTCUTS'}</p>
        <div className="profile-feature-grid">
          {shortcuts.map(([to, icon, title, description]) => <Link key={to} to={to}>
            {icon}<span><strong>{title}</strong><small>{description}</small></span>
          </Link>)}
        </div>
      </div>
      <button className="profile-logout" onClick={onLogout}><LogOut size={16} /> Log out of TideMarket</button>
    </section>
  </main>;
}

function NotFound({ user }) {
  return <main className="dashboard not-found-page">
    <p className="kicker">PAGE NOT FOUND</p>
    <h1>This page is off the map.</h1>
    <p>The address may have changed, or the page may no longer be available.</p>
    <Link className="button primary" to={user ? (user.role === 'admin' ? '/admin' : '/dashboard') : '/'}>Return to TideMarket</Link>
  </main>;
}

function AuthModal({ mode, onClose, onSwitch, onSubmit, onAuthenticated }) {
  const dialogRef = useRef(null);
  const [form, setForm] = useState({});
  const [error, setError] = useState('');
  const [pending, setPending] = useState(null);
  const [registrationComplete, setRegistrationComplete] = useState('');
  const [otp, setOtp] = useState('');
  const [seconds, setSeconds] = useState(0);
  const [submittingOtp, setSubmittingOtp] = useState(false);
  const [resending, setResending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [resetStep, setResetStep] = useState(null);
  const [resetEmail, setResetEmail] = useState('');
  const [resetOtp, setResetOtp] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [resetSeconds, setResetSeconds] = useState(0);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetMessage, setResetMessage] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  useDialogAccessibility({
    open: true,
    dialogRef,
    onClose,
    focusKey: `${mode}:${resetStep || (registrationComplete ? 'registration-complete' : pending ? 'registration-otp' : 'form')}`
  });
  const change = event => setForm({ ...form, [event.target.name]: event.target.value });
  useEffect(() => {
    if (!seconds) return undefined;
    const timer = window.setInterval(() => setSeconds(value => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [seconds]);
  useEffect(() => {
    if (!resetSeconds) return undefined;
    const timer = window.setInterval(() => setResetSeconds(value => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [resetSeconds]);
  useEffect(() => {
    setPending(null);
    setRegistrationComplete('');
    setOtp('');
    setSeconds(0);
    setError('');
    setResetStep(null);
    setResetOtp('');
    setResetToken('');
    setResetSeconds(0);
    setResetMessage('');
    setNewPassword('');
    setConfirmNewPassword('');
  }, [mode]);
  const backToLogin = () => {
    setResetStep(null);
    setResetOtp('');
    setResetToken('');
    setResetSeconds(0);
    setResetMessage('');
    setNewPassword('');
    setConfirmNewPassword('');
    setError('');
  };
  const requestResetOtp = async event => {
    event.preventDefault();
    setError('');
    const email = resetEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Enter a valid email address.');
      return;
    }
    setResetBusy(true);
    try {
      const result = await api.forgotPassword({ email });
      setResetEmail(email);
      setResetMessage(result.message);
      setResetSeconds(result.resendAfter || 60);
      setResetStep('otp');
    } catch (err) {
      setError(err.message);
    } finally {
      setResetBusy(false);
    }
  };
  const verifyResetOtp = async event => {
    event.preventDefault();
    setError('');
    if (!/^\d{6}$/.test(resetOtp)) {
      setError('Enter the 6-digit verification code.');
      return;
    }
    setResetBusy(true);
    try {
      const result = await api.verifyResetOtp({ email: resetEmail, otp: resetOtp });
      setResetToken(result.resetToken);
      setResetStep('password');
      setResetMessage('');
    } catch (err) {
      setError(err.message);
    } finally {
      setResetBusy(false);
    }
  };
  const resendResetOtp = async () => {
    setError('');
    setResetBusy(true);
    try {
      const result = await api.resendResetOtp({ email: resetEmail });
      setResetOtp('');
      setResetMessage(result.message);
      setResetSeconds(result.resendAfter || 60);
    } catch (err) {
      setError(err.message);
    } finally {
      setResetBusy(false);
    }
  };
  const updatePassword = async event => {
    event.preventDefault();
    setError('');
    if (newPassword.length < 8 || newPassword.length > 128) {
      setError('Password must be between 8 and 128 characters.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setError('The passwords do not match.');
      return;
    }
    setResetBusy(true);
    try {
      const result = await api.resetPassword({
        resetToken,
        newPassword,
        confirmNewPassword
      });
      setResetToken('');
      setNewPassword('');
      setConfirmNewPassword('');
      setResetMessage(result.message);
      setResetStep('success');
    } catch (err) {
      setError(err.message);
    } finally {
      setResetBusy(false);
    }
  };
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
      if (result.status === 'pending_admin') {
        setPending(null);
        setOtp('');
        setRegistrationComplete(result.message);
        return;
      }
      if (!result.token || !result.user) throw new Error('Email verification could not complete account activation.');
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
    <div ref={dialogRef} className="modal auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-modal-title" onClick={event => event.stopPropagation()}>
      <button className="close" type="button" aria-label="Close dialog" onClick={onClose}>×</button>
      <p className="kicker">TIDEMARKET ACCOUNT</p>
      {resetStep ? <>
        {resetStep === 'email' && <>
          <h2 id="auth-modal-title">Reset your password.</h2>
          <p>Enter your account email to receive a verification code.</p>
          <form onSubmit={requestResetOtp} autoComplete="on">
            <input
              name="resetEmail"
              type="email"
              aria-label="Email address"
              data-dialog-autofocus="true"
              placeholder="Email address"
              autoComplete="email"
              value={resetEmail}
              onChange={event => setResetEmail(event.target.value)}
              required
            />
            {error && <p className="form-error">{error}</p>}
            <button className="button primary full" type="submit" disabled={resetBusy}>
              {resetBusy ? 'Sending…' : 'Proceed'}
            </button>
            <button className="switch-auth" type="button" onClick={backToLogin}>Back to Login</button>
          </form>
        </>}
        {resetStep === 'otp' && <>
          <h2 id="auth-modal-title">Verify your email.</h2>
          <p>{resetMessage}</p>
          <p>Enter the 6-digit code sent to {resetEmail.replace(/(^.).*(@.*$)/, '$1•••$2')}.</p>
          <form onSubmit={verifyResetOtp} autoComplete="one-time-code">
            <input
              name="resetOtp"
              aria-label="Six-digit password reset code"
              data-dialog-autofocus="true"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              placeholder="6-digit code"
              value={resetOtp}
              onChange={event => setResetOtp(event.target.value.replace(/\D/g, '').slice(0, 6))}
              required
            />
            {error && <p className="form-error">{error}</p>}
            {resetSeconds <= 0
              ? <button className="switch-auth" type="button" onClick={resendResetOtp} disabled={resetBusy}>{resetBusy ? 'Sending…' : 'Resend OTP'}</button>
              : <p>Resend available in {resetSeconds}s</p>}
            <button className="button primary full" type="submit" disabled={resetBusy}>{resetBusy ? 'Verifying…' : 'Verify OTP'}</button>
            <button className="switch-auth" type="button" onClick={backToLogin}>Back to Login</button>
          </form>
        </>}
        {resetStep === 'password' && <>
          <h2 id="auth-modal-title">Choose a new password.</h2>
          <form onSubmit={updatePassword} autoComplete="on">
            <input
              name="newPassword"
              type="password"
              aria-label="New password"
              data-dialog-autofocus="true"
              placeholder="New password"
              autoComplete="new-password"
              minLength={8}
              maxLength={128}
              value={newPassword}
              onChange={event => setNewPassword(event.target.value)}
              required
            />
            <input
              name="confirmNewPassword"
              type="password"
              aria-label="Confirm new password"
              placeholder="Confirm new password"
              autoComplete="new-password"
              minLength={8}
              maxLength={128}
              value={confirmNewPassword}
              onChange={event => setConfirmNewPassword(event.target.value)}
              required
            />
            {error && <p className="form-error">{error}</p>}
            <button className="button primary full" type="submit" disabled={resetBusy}>{resetBusy ? 'Updating…' : 'Update Password'}</button>
            <button className="switch-auth" type="button" onClick={backToLogin}>Back to Login</button>
          </form>
        </>}
        {resetStep === 'success' && <>
          <h2 id="auth-modal-title">Password updated.</h2>
          <p>{resetMessage}</p>
          <button className="button primary full" type="button" onClick={backToLogin}>Back to Login</button>
        </>}
      </> : registrationComplete ? <>
        <h2 id="auth-modal-title">Email verified.</h2>
        <p>{registrationComplete}</p>
        <button className="button primary full" type="button" onClick={() => {
          setRegistrationComplete('');
          onSwitch();
        }}>Go to login</button>
      </> : pending ? <>
        <h2 id="auth-modal-title">Verify your email.</h2>
        <p>Enter the 6-digit code sent to {pending.email.replace(/(^.).*(@.*$)/, '$1•••$2')}.</p>
        <form onSubmit={verifyOtp} autoComplete="one-time-code">
          <input name="otp" aria-label="Six-digit registration code" data-dialog-autofocus="true" inputMode="numeric" pattern="[0-9]*" maxLength={6} placeholder="6-digit code" value={otp} onChange={event => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))} required />
          {error && <p className="form-error">{error}</p>}
          {seconds <= 0 ? <button className="switch-auth" type="button" onClick={resendOtp} disabled={resending}>{resending ? 'Sending…' : 'Resend OTP'}</button> : <p>Resend available in {seconds}s</p>}
          <button className="button primary full" type="submit" disabled={submittingOtp}>{submittingOtp ? 'Verifying…' : 'Verify email'}</button>
        </form>
      </> : <>
        <h2 id="auth-modal-title">{mode === 'login' ? 'Welcome back to the water.' : 'Create your account.'}</h2>
        <form onSubmit={submit} autoComplete="on">
          {mode === 'register' && <>
            <input name="name" aria-label="Full name" data-dialog-autofocus="true" placeholder="Full name" autoComplete="name" onChange={change} required />
            <input name="phone" aria-label="Mobile number, optional" placeholder="Mobile number" autoComplete="tel" onChange={change} />
            <select name="role" aria-label="Account role" value={form.role || ''} onChange={change} required>
              <option value="" disabled>Select account role</option>
              <option value="buyer">Buyer</option>
              <option value="fisherman">Fisherman</option>
            </select>
          </>}
          <input name="email" aria-label="Email address" data-dialog-autofocus={mode === 'login' ? 'true' : undefined} type="email" placeholder="Email address" autoComplete="username" onChange={change} required />
          <div className="password-field">
            <input name="password" aria-label="Password" data-dialog-autofocus={mode === 'register' ? 'true' : undefined} type={showPassword ? 'text' : 'password'} placeholder="Password" onChange={change} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={mode === 'register' ? 8 : undefined} />
            <button className="password-toggle" type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} onClick={() => setShowPassword(visible => !visible)}>
              {showPassword ? <EyeOff size={19} aria-hidden="true" /> : <Eye size={19} aria-hidden="true" />}
            </button>
          </div>
          {mode === 'login' && <button className="switch-auth forgot-password-link" type="button" onClick={() => {
            setResetEmail(form.email || '');
            setResetStep('email');
            setError('');
          }}>Forgot Password?</button>}
          {error && <p className="form-error">{error}</p>}
          <button className="button primary full" type="submit">{mode === 'login' ? 'Log in' : 'Create account'}</button>
        </form>
      </>}
      {!resetStep && !registrationComplete && <p className="switch-auth-prompt">
        {mode === 'login' ? 'New to TideMarket?' : 'Already have an account?'}
        <button className="switch-auth" onClick={onSwitch}>{mode === 'login' ? 'Sign up' : 'Log in'}</button>
      </p>}
    </div>
  </div>;
}
