import { Pool, type PoolConfig } from 'pg'
import dotenv from 'dotenv'

dotenv.config()

function getSslConfig(): PoolConfig['ssl'] | undefined {
  if (process.env.DB_SSL === 'false') return undefined
  if (
    process.env.DB_SSL === 'true' ||
    (process.env.NODE_ENV === 'production' && process.env.DATABASE_URL)
  ) {
    return { rejectUnauthorized: false }
  }
  return undefined
}

const poolConfig: PoolConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
    }
  : {
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT) || 5432,
      database: process.env.DB_NAME || 'ibayad_payroll',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD,
    }

const ssl = getSslConfig()
if (ssl) {
  poolConfig.ssl = ssl
}

const pool = new Pool({
  ...poolConfig,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 2_000,
})

pool.on('error', (err: Error) => {
  console.error('Unexpected DB pool error:', err)
})

export default pool
