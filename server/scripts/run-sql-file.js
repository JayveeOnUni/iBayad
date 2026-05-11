const fs = require('fs')
const path = require('path')
const { Client } = require('pg')
const dotenv = require('dotenv')

const serverRoot = path.resolve(__dirname, '..')
dotenv.config({ path: path.join(serverRoot, '.env') })

const relativeFile = process.argv[2]

if (!relativeFile) {
  console.error('Usage: node scripts/run-sql-file.js <relative-sql-file>')
  process.exit(1)
}

const sqlFile = path.resolve(serverRoot, relativeFile)

if (!sqlFile.startsWith(serverRoot)) {
  console.error('SQL file must be inside the server directory.')
  process.exit(1)
}

if (!fs.existsSync(sqlFile)) {
  console.error(`SQL file not found: ${sqlFile}`)
  process.exit(1)
}

const client = new Client({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'ibayad_payroll',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
})

async function main() {
  const sql = fs.readFileSync(sqlFile, 'utf8')
  await client.connect()
  await client.query(sql)
  console.log(`Executed ${path.relative(serverRoot, sqlFile)}`)
}

main()
  .catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
  .finally(async () => {
    await client.end().catch(() => undefined)
  })
