const fs = require('fs')
const path = require('path')
const dotenv = require('dotenv')
const { createPgClient } = require('./db-config')

const serverRoot = path.resolve(__dirname, '..')
dotenv.config({ path: path.join(serverRoot, '.env') })

const migrations = [
  {
    name: '001_schema',
    file: 'src/db/schema.sql',
  },
  {
    name: '002_account_activation_fields',
    file: 'src/db/add-account-activation-fields.sql',
  },
  {
    name: '003_payroll_operations_workflow',
    file: 'src/db/add-payroll-operations-workflow.sql',
  },
  {
    name: '004_offset_credit_system',
    file: 'src/db/add-offset-credit-system.sql',
  },
  {
    name: '005_leave_management_policy_2022',
    file: 'src/db/add-leave-management-policy-2022.sql',
  },
  {
    name: '006_password_reset_email_fields',
    file: 'src/db/add-password-reset-email-fields.sql',
  },
  {
    name: '007_employee_government_id_fields',
    file: 'src/db/add-employee-government-id-fields.sql',
  },
  {
    name: '008_activation_email_tracking_fields',
    file: 'src/db/add-activation-email-tracking-fields.sql',
  },
]

function resolveSqlFile(relativeFile) {
  const sqlFile = path.resolve(serverRoot, relativeFile)
  const relativePath = path.relative(serverRoot, sqlFile)

  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error('SQL file must be inside the server directory.')
  }

  if (!fs.existsSync(sqlFile)) {
    throw new Error(`SQL file not found: ${sqlFile}`)
  }

  return sqlFile
}

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
}

async function isApplied(client, name) {
  const result = await client.query(
    'SELECT 1 FROM schema_migrations WHERE name = $1',
    [name]
  )
  return result.rowCount > 0
}

async function markApplied(client, name) {
  await client.query(
    'INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING',
    [name]
  )
}

async function baseSchemaExists(client) {
  const result = await client.query(`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'users'
    ) AS exists
  `)
  return Boolean(result.rows[0]?.exists)
}

async function applyMigration(client, migration) {
  if (await isApplied(client, migration.name)) {
    console.log(`Skipping ${migration.name}`)
    return
  }

  if (migration.name === '001_schema' && await baseSchemaExists(client)) {
    console.log('Baselining 001_schema because an existing users table was found')
    await markApplied(client, migration.name)
    return
  }

  const sqlFile = resolveSqlFile(migration.file)
  const sql = fs.readFileSync(sqlFile, 'utf8')

  console.log(`Applying ${migration.name}: ${migration.file}`)
  await client.query('BEGIN')
  try {
    await client.query(sql)
    await markApplied(client, migration.name)
    await client.query('COMMIT')
    console.log(`Applied ${migration.name}`)
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}

async function main() {
  const client = createPgClient()

  try {
    await client.connect()
    await ensureMigrationsTable(client)

    for (const migration of migrations) {
      await applyMigration(client, migration)
    }

    console.log('Database migrations complete.')
  } finally {
    await client.end().catch(() => undefined)
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
