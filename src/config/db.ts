import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

function parseSsl() {
  const sslMode = (process.env.DB_SSL_MODE || '').toLowerCase();
  const useSsl =
    sslMode === 'require' ||
    process.env.DB_SSL === 'true' ||
    process.env.NODE_ENV === 'production' ||
    Boolean(process.env.DATABASE_URL);

  if (!useSsl) return undefined;

  const rejectUnauthorized = process.env.DB_SSL_REJECT_UNAUTHORIZED === 'true';
  return { rejectUnauthorized };
}

const ssl = parseSsl();

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl,
    })
  : new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT) || 5432,
      database: process.env.DB_NAME || 'creatorlab',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || '',
      ssl,
    });

pool.on('connect', () => {
  console.log('✅ Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  console.error('❌ PostgreSQL connection error:', err.message);
});

export default pool;
