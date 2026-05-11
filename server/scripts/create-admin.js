const path = require('path')
const bcrypt = require('bcryptjs')
const dotenv = require('dotenv')
const { createPgClient } = require('./db-config')

const serverRoot = path.resolve(__dirname, '..')
dotenv.config({ path: path.join(serverRoot, '.env') })

const email = process.env.ADMIN_EMAIL?.trim().toLowerCase()
const password = process.env.ADMIN_PASSWORD

if (!email || !password) {
  console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD before running this script.')
  process.exit(1)
}

if (password.length < 12) {
  console.error('ADMIN_PASSWORD must be at least 12 characters.')
  process.exit(1)
}

async function main() {
  const client = createPgClient()

  try {
    await client.connect()
    const passwordHash = await bcrypt.hash(password, 12)
    const result = await client.query(
      `INSERT INTO users (email, password_hash, role, is_active, activated_at)
       VALUES ($1, $2, 'admin', true, NOW())
       ON CONFLICT (email) DO UPDATE
       SET password_hash = EXCLUDED.password_hash,
           role = 'admin',
           is_active = true,
           activated_at = COALESCE(users.activated_at, NOW()),
           updated_at = NOW()
       RETURNING id, email, role`,
      [email, passwordHash]
    )

    const admin = result.rows[0]
    console.log(`Admin account ready: ${admin.email} (${admin.id})`)
  } finally {
    await client.end().catch(() => undefined)
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
