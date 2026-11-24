
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
import {
  initSupabase,
  insert,
  list,
  checkSupabaseConnection
} from './db.js';
import { refreshAuction } from './utils.js';

const backendDirectory = dirname(fileURLToPath(import.meta.url));

dotenv.config({
  path: resolve(backendDirectory, '../.env'),
  override: false
});

dotenv.config({
  path: resolve(backendDirectory, '../../.env'),
  override: false
});

const app = express();

// Vercel serverless environment detection
const isVercel = Boolean(process.env.VERCEL);

// Middleware
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        connectSrc: [
          "'self'",
          'https://api.razorpay.com',
          'https://checkout.razorpay.com'
        ],
        fontSrc: [
          "'self'",
          'https://fonts.gstatic.com',
          'data:'
        ],
        formAction: ["'self'"],
        frameAncestors: ["'self'"],
        frameSrc: [
          "'self'",
          'https://api.razorpay.com',
          'https://*.razorpay.com'
        ],
        imgSrc: ["'self'", 'data:', 'https:'],
        objectSrc: ["'none'"],
        scriptSrc: [
          "'self'",
          'https://checkout.razorpay.com'
        ],
        scriptSrcAttr: ["'none'"],
        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          'https://fonts.googleapis.com'
        ],
        upgradeInsecureRequests: null
      }
    }
  })
);

app.use(
  cors({
    origin: process.env.CLIENT_URL || 'http://localhost:5173'
  })
);

// Razorpay webhook must receive the raw request body
app.use(
  '/api/payments/razorpay/webhook',
  express.raw({ type: 'application/json' })
);

app.use(express.json({ limit: '2mb' }));
app.use(morgan(isVercel ? 'combined' : 'dev'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'smart-fishing-api',
    environment: isVercel ? 'vercel' : 'node'
  });
});

// API routes
app.use('/api', userRoutes);
app.use('/api/admin', adminRoutes);

// Error handling
app.use((error, req, res, next) => {
  if (error.type === 'entity.parse.failed') {
    console.warn('Rejected malformed JSON request body');

    return res.status(400).json({
      message: 'Invalid JSON request body'
    });
  }

  if (error.type === 'entity.too.large') {
    console.warn('Rejected oversized request body');

    return res.status(413).json({
      message: 'Request body is too large'
    });
  }

  console.error('Unhandled API error:', error);

  if (res.headersSent) {
    return next(error);
  }

  res.status(500).json({
    message: 'Unexpected server error'
  });
});

// Admin seeding
async function seed() {
  const users = await list('users');

  const adminEmail = String(
    process.env.ADMIN_EMAIL || 'tide@gmail.com'
  ).trim().toLowerCase();

  const adminPassword = process.env.ADMIN_PASSWORD || 'Tide@123';

  const admin = users.find(user => user.email === adminEmail);

  const adminData = {
    name: 'Tide Admin',
    email: adminEmail,
    passwordHash: await bcrypt.hash(adminPassword, 12),
    role: 'admin'
  };

  if (admin) {
    const { update } = await import('./db.js');
    await update('users', admin.id, adminData);
  } else {
    await insert('users', adminData);
  }
}

// Auction settlement
let auctionSettlementRunning = false;

async function settleAuctions() {
  if (auctionSettlementRunning) return;

  auctionSettlementRunning = true;

  try {
    const auctions = await list('auctions');

    const pending = auctions.filter(
      auction =>
        !['completed', 'cancelled'].includes(auction.status)
    );

    for (const auction of pending) {
      try {
        await refreshAuction(auction);
      } catch (error) {
        console.error(
          `Auction settlement failed for ${auction.id}:`,
          error
        );
      }
    }
  } catch (error) {
    console.error('Auction settlement sweep failed:', error);
  } finally {
    auctionSettlementRunning = false;
  }
}

// Production configuration validation
export function validateProductionConfig(env = process.env) {
  if (env.NODE_ENV !== 'production') return;

  if (!env.JWT_SECRET) {
    throw new Error('JWT_SECRET is required in production');
  }

  if (!env.ADMIN_PASSWORD) {
    throw new Error('ADMIN_PASSWORD is required in production');
  }

  for (const key of [
    'SMTP_HOST',
    'SMTP_PORT',
    'SMTP_SECURE',
    'SMTP_USER',
    'SMTP_PASS',
    'EMAIL_FROM'
  ]) {
    if (!env[key]) {
      throw new Error(`${key} is required in production`);
    }
  }

  const smtpPort = Number(env.SMTP_PORT);

  if (
    !Number.isInteger(smtpPort) ||
    smtpPort < 1 ||
    smtpPort > 65535
  ) {
    throw new Error('SMTP_PORT must be a valid port in production');
  }

  if (
    !['true', 'false'].includes(
      String(env.SMTP_SECURE).toLowerCase()
    )
  ) {
    throw new Error('SMTP_SECURE must be true or false in production');
  }

  if (!env.OTP_HASH_SECRET) {
    throw new Error('OTP_HASH_SECRET is required in production');
  }
}

// Listener address description
export function describeListenerAddress(address, configuredPort) {
  if (address === null) {
    return `configured port ${configuredPort} (bound address unavailable)`;
  }

  if (typeof address === 'string') {
    return `socket ${address}`;
  }

  return `http://localhost:${address.port}`;
}

// Local server startup
export async function startServer({
  port = process.env.PORT || 5000,
  sweepIntervalMs = 15_000
} = {}) {
  validateProductionConfig();

  const database = initSupabase();

  if (database) {
    console.log(
      'Supabase PostgreSQL: checking database connection and schema...'
    );

    await checkSupabaseConnection();
  }

  await seed();

  console.log(
    database
      ? 'Supabase PostgreSQL: ready'
      : 'Local database: ready'
  );

  await settleAuctions();

  // Recurring settlement is for a persistent Node server only.
  const sweep = setInterval(settleAuctions, sweepIntervalMs);

  const server = await new Promise((resolveServer, reject) => {
    const listener = app.listen(port, () => {
      resolveServer(listener);
    });

    listener.once('error', reject);
  });

  const address = server.address();

  console.log(
    `API listening on ${describeListenerAddress(address, port)}`
  );

  return {
    server,

    close: async () => {
      clearInterval(sweep);

      if (typeof server.closeAllConnections === 'function') {
        server.closeAllConnections();
      }

      await new Promise((resolveClose, reject) => {
        server.close(error =>
          error ? reject(error) : resolveClose()
        );
      });
    }
  };
}

// Serverless initialization.
// Each warm serverless instance initializes once.
let initializationPromise;

async function initializeServerless() {
  validateProductionConfig();

  const database = initSupabase();

  if (database) {
    console.log('Initializing Supabase connection...');

    await checkSupabaseConnection();
  }

  await seed();

  console.log(
    database
      ? 'Supabase PostgreSQL: ready'
      : 'Local database: ready'
  );
}

// Vercel initialization middleware
if (isVercel) {
  app.use(async (req, res, next) => {
    try {
      if (!initializationPromise) {
        initializationPromise = initializeServerless().catch(error => {
          initializationPromise = undefined;
          throw error;
        });
      }

      await initializationPromise;

      next();
    } catch (error) {
      console.error('Serverless initialization failed:', error);

      res.status(500).json({
        message: 'Server initialization failed'
      });
    }
  });
}

// Local execution
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    await startServer();
  } catch (error) {
    console.error('API startup failed:', {
      message: error.message,
      cause: error.cause || null
    });

    process.exitCode = 1;
  }
}

// IMPORTANT: Vercel requires a default export.
export default app;
