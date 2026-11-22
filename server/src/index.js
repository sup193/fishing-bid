import dotenv from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import bcrypt from 'bcryptjs';
import userRoutes from './routes/user.js';
import adminRoutes from './routes/admin.js';
import { initSupabase, insert, list } from './db.js';
import { refreshAuction } from './utils.js';

const backendDirectory = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(backendDirectory, '../.env'), override: false });
dotenv.config({ path: resolve(backendDirectory, '../../.env'), override: false });

export const app = express();
app.use(helmet({ contentSecurityPolicy: { directives: {
  defaultSrc: ["'self'"],
  baseUri: ["'self'"],
  connectSrc: ["'self'", 'https://api.razorpay.com', 'https://checkout.razorpay.com'],
  fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
  formAction: ["'self'"],
  frameAncestors: ["'self'"],
  frameSrc: ["'self'", 'https://api.razorpay.com', 'https://*.razorpay.com'],
  imgSrc: ["'self'", 'data:', 'https:'],
  objectSrc: ["'none'"],
  scriptSrc: ["'self'", 'https://checkout.razorpay.com'],
  scriptSrcAttr: ["'none'"],
  styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
  upgradeInsecureRequests: null
} } }));
app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:5173' }));
app.use('/api/payments/razorpay/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '2mb' })); app.use(morgan('dev'));
app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'smart-fishing-api' }));
app.use('/api', userRoutes); app.use('/api/admin', adminRoutes);
app.use((error, req, res, next) => {
  if (error.type === 'entity.parse.failed') {
    console.warn('Rejected malformed JSON request body');
    return res.status(400).json({ message: 'Invalid JSON request body' });
  }
  if (error.type === 'entity.too.large') {
    console.warn('Rejected oversized request body');
    return res.status(413).json({ message: 'Request body is too large' });
  }
  console.error('Unhandled API error:', error);
  res.status(500).json({ message: 'Unexpected server error' });
});
async function seed() {
  const users = await list('users');
  const adminEmail = String(process.env.ADMIN_EMAIL || 'tide@gmail.com').trim().toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD || 'Tide@123';
  const admin = users.find(user => user.email === adminEmail);
  const adminData = {
    name: 'Tide Admin',
    email: adminEmail,
    passwordHash: await bcrypt.hash(adminPassword, 12),
    role: 'admin'
  };
  if (admin) await (await import('./db.js')).update('users', admin.id, adminData);
  else await insert('users', adminData);
}
let auctionSettlementRunning = false;
async function settleAuctions() {
  if (auctionSettlementRunning) return;
  auctionSettlementRunning = true;
  try {
    const auctions = await list('auctions');
    const pending = auctions.filter(auction => !['completed', 'cancelled'].includes(auction.status));
    for (const auction of pending) {
      try {
        await refreshAuction(auction);
      } catch (error) {
        console.error(`Auction settlement failed for ${auction.id}:`, error);
      }
    }
  } catch (error) {
    console.error('Auction settlement sweep failed:', error);
  } finally {
    auctionSettlementRunning = false;
  }
}
export async function startServer({ port = process.env.PORT || 5000, sweepIntervalMs = 15_000 } = {}) {
  validateProductionConfig();
  const database = initSupabase();
  if (database) console.log('Supabase PostgreSQL: checking database connection and schema...');
  await seed();
  console.log(database ? 'Supabase PostgreSQL: ready' : 'Local database: ready');
  await settleAuctions();
  const sweep = setInterval(settleAuctions, sweepIntervalMs);
  const server = await new Promise((resolveServer, reject) => {
    const listener = app.listen(port, () => resolveServer(listener));
    listener.once('error', reject);
  });
  const address = server.address();
  console.log(`API listening on http://localhost:${typeof address === 'object' ? address.port : port}`);
  return {
    server,
    close: async () => {
      clearInterval(sweep);
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      await new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
    }
  };
}

export function validateProductionConfig(env = process.env) {
  if (env.NODE_ENV !== 'production') return;
  if (!env.JWT_SECRET) throw new Error('JWT_SECRET is required in production');
  if (!env.ADMIN_PASSWORD) throw new Error('ADMIN_PASSWORD is required in production');
  if (!env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is required in production');
  if (!env.OTP_FROM_EMAIL) throw new Error('OTP_FROM_EMAIL is required in production');
  if (!env.OTP_HASH_SECRET) throw new Error('OTP_HASH_SECRET is required in production');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await startServer();
  } catch (error) {
    console.error('Database startup failed:', error.message);
    process.exitCode = 1;
  }
}
