const { Client } = require('pg')

function getSslConfig() {
  if (process.env.DB_SSL === 'false') return undefined
  if (
    process.env.DB_SSL === 'true' ||
    (process.env.NODE_ENV === 'production' && process.env.DATABASE_URL)
  ) {
    return { rejectUnauthorized: false }
  }
  return undefined
}

function createPgClient() {
  const config = process.env.DATABASE_URL
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
    config.ssl = ssl
  }

  return new Client(config)
}

module.exports = { createPgClient }
