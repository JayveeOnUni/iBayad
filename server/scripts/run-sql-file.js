const fs = require('fs')
const path = require('path')
const dotenv = require('dotenv')
const { createPgClient } = require('./db-config')

const serverRoot = path.resolve(__dirname, '..')
dotenv.config({ path: path.join(serverRoot, '.env') })

const relativeFile = process.argv[2]

if (!relativeFile) {
  console.error('Usage: node scripts/run-sql-file.js <relative-sql-file>')
  process.exit(1)
}

const sqlFile = path.resolve(serverRoot, relativeFile)
const relativeSqlFile = path.relative(serverRoot, sqlFile)

if (relativeSqlFile.startsWith('..') || path.isAbsolute(relativeSqlFile)) {
  console.error('SQL file must be inside the server directory.')
  process.exit(1)
}

if (!fs.existsSync(sqlFile)) {
  console.error(`SQL file not found: ${sqlFile}`)
  process.exit(1)
}

const client = createPgClient()

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
