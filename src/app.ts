import express, { type Express, type NextFunction, type Request, type Response } from 'express'
import type { Config } from './config'
import { TYPES, type FundingType } from './schemes'
import type { SchemeStore } from './store'
import { openApi } from './openapi'

// The funding data API: a read-only JSON API over the funding schemes, with
// its OpenAPI specification and documentation.

// Swagger UI is loaded from a CDN, pinned to one version and checked against
// these hashes, rather than installed from npm, because the npm package runs
// an install script that sends usage data to a third party.
const SWAGGER_UI = {
  css: {
    url: 'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.33.0/swagger-ui.css',
    integrity: 'sha384-Ov4/wv3j2bmct8cDc5X4ngJZohVPzEmc6uDPH8WeljUxO5vtoykvMEfbu9Vh6RaW'
  },
  js: {
    url: 'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.33.0/swagger-ui-bundle.js',
    integrity: 'sha384-YDALVcy8kj8yltLBVi1vBiBAUqdxvus673gM8XKwiy6aDUJFXivF/KCufekjYbVf'
  }
}

const DOCS_PAGE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${openApi.info.title}</title>
  <link rel="stylesheet" href="${SWAGGER_UI.css.url}" integrity="${SWAGGER_UI.css.integrity}" crossorigin="anonymous">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="${SWAGGER_UI.js.url}" integrity="${SWAGGER_UI.js.integrity}" crossorigin="anonymous"></script>
  <script src="/docs/start.js"></script>
</body>
</html>
`

// validatorUrl is turned off, because Swagger UI would otherwise send the
// specification's address to validator.swagger.io.
const DOCS_SCRIPT = "window.ui = SwaggerUIBundle({ url: '/openapi.json', dom_id: '#swagger-ui', validatorUrl: null })\n"

const JSON_POLICY = "default-src 'none'; frame-ancestors 'none'"

const DOCS_POLICY = [
  "default-src 'none'",
  "script-src 'self' https://cdn.jsdelivr.net",
  // Swagger UI sets styles on elements as it draws the page.
  "style-src https://cdn.jsdelivr.net 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join('; ')

// Responses can be cached by browsers, Find funding and any CDN in front.
const CACHE_CONTROL = 'public, max-age=300'

const FILTERS = ['type', 'sector', 'purpose']

// Sends an error in the RFC 9457 format.
function problem (res: Response, status: number, title: string, detail?: string): void {
  res.status(status).type('application/problem+json').json({ type: 'about:blank', title, status, ...(detail ? { detail } : {}) })
}

// A query parameter as a list, whether it was given once or repeated.
function values (value: unknown): string[] {
  return (Array.isArray(value) ? value : [value]).filter((item): item is string => typeof item === 'string' && item !== '')
}

export function createApiApp (config: Config, store: SchemeStore): Express {
  const app = express()

  app.disable('x-powered-by')
  app.set('query parser', 'simple')

  app.use((req, res, next) => {
    res.set({
      'X-Robots-Tag': 'noindex, nofollow',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': JSON_POLICY,
      // The data is public, so any website can read it.
      'Access-Control-Allow-Origin': '*'
    })
    next()
  })

  // Heroku ends HTTPS at its router, so trust its X-Forwarded-Proto header
  // and send any plain HTTP requests to HTTPS.
  if (config.production) {
    app.set('trust proxy', 1)
    app.use((req, res, next) => {
      if (req.secure) return next()
      res.redirect(301, `https://${req.headers.host}${req.originalUrl}`)
    })
  }

  app.get('/robots.txt', (req, res) => {
    res.type('text/plain').send('User-agent: *\nDisallow: /\n')
  })

  // Also checks the database, so a deploy fails if the API cannot reach it.
  app.get('/health', async (req, res) => {
    try {
      await store.check()
      res.json({ status: 'ok' })
    } catch (err) {
      console.error('Health check failed, because the database could not be reached:', (err as Error).message)
      res.status(503).json({ status: 'error' })
    }
  })

  app.get('/', (req, res) => {
    res.redirect('/docs')
  })

  app.get('/openapi.json', (req, res) => {
    res.set('Cache-Control', CACHE_CONTROL).json(openApi)
  })

  app.get('/docs', (req, res) => {
    res.set('Content-Security-Policy', DOCS_POLICY).type('html').send(DOCS_PAGE)
  })

  app.get('/docs/start.js', (req, res) => {
    res.type('js').send(DOCS_SCRIPT)
  })

  app.get('/v1/schemes', async (req, res) => {
    const unknown = Object.keys(req.query).filter((name) => !FILTERS.includes(name))
    if (unknown.length) {
      return problem(res, 400, 'Unknown filter', `Filter by ${FILTERS.join(', ')}. Not recognised: ${unknown.join(', ')}`)
    }

    const types = values(req.query.type)
    const badTypes = types.filter((type) => !TYPES.includes(type as FundingType))
    if (badTypes.length) {
      return problem(res, 400, 'Invalid type', `type must be one of ${TYPES.join(', ')}. Not recognised: ${badTypes.join(', ')}`)
    }

    const { example, schemes } = await store.list({
      types: types as FundingType[],
      sectors: values(req.query.sector),
      purposes: values(req.query.purpose)
    })

    res.set('Cache-Control', CACHE_CONTROL).json({ example, count: schemes.length, schemes })
  })

  app.get('/v1/schemes/:id', async (req, res) => {
    const scheme = await store.get(String(req.params.id))
    if (!scheme) return problem(res, 404, 'Scheme not found', `There is no scheme with the identifier ${String(req.params.id)}`)
    res.set('Cache-Control', CACHE_CONTROL).json(scheme)
  })

  app.use((req, res) => {
    problem(res, 404, 'Not found')
  })

  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    console.error(err)
    problem(res, 500, 'Sorry, there is a problem with the API')
  })

  return app
}
