import jwt from 'jsonwebtoken';
import { get, getLatestFishermanRegistrationRequest, sanitizeUser } from './db.js';

function jwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET is required in production');
  return 'dev-only-secret-change-before-production';
}

export function signUser(user) {
  return jwt.sign({
    id: user.id,
    role: user.role,
    tokenVersion: Number(user.tokenVersion || 0)
  }, jwtSecret(), { expiresIn: '7d' });
}
export async function requireAuth(req, res, next) {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ message: 'Authentication required' });
    const payload = jwt.verify(token, jwtSecret());
    const user = await get('users', payload.id);
    if (!user) return res.status(401).json({ message: 'User not found' });
    if (user.role === 'fisherman') {
      const request = await getLatestFishermanRegistrationRequest(user.email);
      if (request?.status === 'pending') {
        return res.status(403).json({ message: 'Your fisherman registration is awaiting admin approval.' });
      }
      if (request?.status === 'rejected') {
        return res.status(403).json({ message: 'Your fisherman registration was rejected. Submit a new registration to try again.' });
      }
      if (['pending', 'rejected'].includes(String(user.verificationStatus || '').toLowerCase())) {
        return res.status(403).json({ message: 'Your fisherman account is not approved.' });
      }
    }
    const tokenVersion = Number(user.tokenVersion || 0);
    if ((payload.tokenVersion === undefined && tokenVersion !== 0)
      || (payload.tokenVersion !== undefined && Number(payload.tokenVersion) !== tokenVersion)) {
      return res.status(401).json({ message: 'Invalid or expired session' });
    }
    req.user = sanitizeUser(user);
    next();
  } catch { res.status(401).json({ message: 'Invalid or expired session' }); }
}
export function allow(...roles) { return (req, res, next) => roles.includes(req.user.role) ? next() : res.status(403).json({ message: 'You do not have permission for this action' }); }
