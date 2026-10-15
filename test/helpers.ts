import type { AddressInfo } from 'node:net'
import { createApiApp } from '../src/app'
import type { Config } from '../src/config'
import { loadFunding, type FundingData } from '../src/schemes'

export interface TestServer {
  baseUrl: string
  close: () => void
}

// Starts the API on a free port, with the example funding schemes unless
// others are given.
export async function startApi (config: Partial<Config> = {}, funding: FundingData = loadFunding()): Promise<TestServer> {
  const server = createApiApp({ port: 0, production: false, ...config }, funding).listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  const { port } = server.address() as AddressInfo

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => server.close()
  }
}
