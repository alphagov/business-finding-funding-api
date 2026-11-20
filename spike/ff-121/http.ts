import { createHash } from 'node:crypto'

// Reads public pages and data for the spike. Nothing here needs a key or
// signs in. Requests go one at a time, at most one a second, with a
// User-Agent that says who is asking, so the sites see a slow, named reader.

export const USER_AGENT = 'GOV.UK Business funding data spike FF-121 (GDS; https://github.com/alphagov/business-finding-funding-api)'

const GAP_MS = 1000
const TIMEOUT_MS = 30_000

export interface Reply {
  url: string
  status: number
  text: string
}

export type Get = (url: string) => Promise<Reply>

export interface Reader {
  get: Get
  requests: () => number
}

export function politeReader (gapMs = GAP_MS, request: typeof fetch = fetch): Reader {
  let queue: Promise<unknown> = Promise.resolve()
  let last = 0
  let requests = 0

  const get: Get = (url) => {
    const turn = queue.then(async () => {
      const wait = last + gapMs - Date.now()
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
      last = Date.now()
      requests += 1
      const response = await request(url, {
        headers: { 'user-agent': USER_AGENT },
        redirect: 'follow',
        signal: AbortSignal.timeout(TIMEOUT_MS)
      })
      return { url: response.url || url, status: response.status, text: await response.text() }
    })
    queue = turn.catch(() => undefined)
    return turn
  }

  return { get, requests: () => requests }
}

const RETRY_AFTER_MS = 5000

// The reply's text, or an error that names the address and the status. A
// timeout or server error is tried once more after a pause, as both were
// seen on the first run.
export async function getText (get: Get, url: string, retryAfterMs = RETRY_AFTER_MS): Promise<string> {
  try {
    const reply = await get(url)
    if (reply.status < 500) return okText(url, reply)
  } catch (error) {
    if ((error as Error).name !== 'TimeoutError') throw error
  }
  await new Promise((resolve) => setTimeout(resolve, retryAfterMs))
  return okText(url, await get(url))
}

function okText (url: string, reply: Reply): string {
  if (reply.status !== 200) throw new Error(`${url} gave ${reply.status}`)
  return reply.text
}

export function fingerprint (text: string): string {
  return createHash('sha256').update(text).digest('hex')
}
