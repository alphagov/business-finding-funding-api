import { createApiApp } from './app'
import { loadConfig } from './config'
import { createPool } from './db'
import { postgresStore } from './store'

const config = loadConfig()

createApiApp(config, postgresStore(createPool(config))).listen(config.port, () => {
  console.log(`Funding data API listening on port ${config.port}`)
})
