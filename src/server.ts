import { createApiApp } from './app'
import { loadConfig } from './config'
import { loadFunding } from './schemes'

const config = loadConfig()

createApiApp(config, loadFunding()).listen(config.port, () => {
  console.log(`Funding data API listening on port ${config.port}`)
})
