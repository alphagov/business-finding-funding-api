// The OpenAPI specification for the funding data API, published at
// /openapi.json and shown at /docs.
//
// The Scheme schema here is the contract for the data. The tests check the
// data file and every response against it, so the data, the API and this
// document cannot drift apart.

const DATE = { type: 'string', format: 'date', pattern: '^\\d{4}-\\d{2}-\\d{2}$', example: '2026-10-08' }

const TEXT_LIST = { type: 'array', items: { type: 'string', minLength: 1 } }

const problem = (description: string): object => ({
  description,
  content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } }
})

export const openApi = {
  openapi: '3.1.0',
  info: {
    title: 'Funding data API',
    version: '0.1.0',
    summary: 'Funding schemes that businesses can apply for: loans, grants and equity investment.',
    description: [
      'A proof of concept for GOV.UK Business. It holds made-up example schemes, so do not rely on the data.',
      '',
      'The data is public, so you do not need to sign in or use an API key. You can only read data. Responses can be cached for 5 minutes.',
      '',
      'New optional fields may be added to version 1 without notice, so ignore any field you do not recognise. Changes that would break existing clients will be made in a new version.'
    ].join('\n')
  },
  tags: [{ name: 'Schemes' }],
  paths: {
    '/v1/schemes': {
      get: {
        tags: ['Schemes'],
        operationId: 'listSchemes',
        summary: 'List funding schemes',
        description: 'Returns every scheme, or only those matching the filters. Repeat a filter to match any of its values, for example `?type=loan&type=grant`.',
        parameters: [
          {
            name: 'type',
            in: 'query',
            description: 'The type of funding.',
            schema: { type: 'array', items: { $ref: '#/components/schemas/FundingType' } },
            style: 'form',
            explode: true
          },
          {
            name: 'sector',
            in: 'query',
            description: 'A sector the business is in. Schemes open to every sector are included.',
            schema: TEXT_LIST,
            style: 'form',
            explode: true,
            example: ['manufacturing']
          },
          {
            name: 'purpose',
            in: 'query',
            description: 'Something the business wants the funding for. Schemes for any purpose are included.',
            schema: TEXT_LIST,
            style: 'form',
            explode: true,
            example: ['equipment']
          }
        ],
        responses: {
          200: {
            description: 'The schemes.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/SchemeList' } } }
          },
          400: problem('A filter is not recognised or has a value that is not allowed.')
        }
      }
    },
    '/v1/schemes/{id}': {
      get: {
        tags: ['Schemes'],
        operationId: 'getScheme',
        summary: 'Get one funding scheme',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            description: 'The scheme\'s identifier. It does not change.',
            schema: { type: 'string' },
            example: 'example-growth-loan'
          }
        ],
        responses: {
          200: {
            description: 'The scheme.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Scheme' } } }
          },
          404: problem('There is no scheme with this identifier.')
        }
      }
    }
  },
  components: {
    schemas: {
      FundingType: { type: 'string', enum: ['loan', 'grant', 'equity'] },
      SchemeList: {
        type: 'object',
        required: ['example', 'count', 'schemes'],
        properties: {
          example: { type: 'boolean', description: 'True while the data holds made-up schemes for testing.' },
          count: { type: 'integer', minimum: 0, description: 'How many schemes are in the list.' },
          schemes: { type: 'array', items: { $ref: '#/components/schemas/Scheme' } }
        }
      },
      Scheme: {
        type: 'object',
        required: ['id', 'type', 'name', 'provider', 'summary', 'url', 'checkedOn', 'eligibility'],
        properties: {
          id: { type: 'string', pattern: '^[a-z0-9-]+$', description: 'A permanent identifier for the scheme.', example: 'example-growth-loan' },
          type: { $ref: '#/components/schemas/FundingType' },
          name: { type: 'string', minLength: 1, example: 'Example Growth Loan' },
          provider: { type: 'string', minLength: 1, description: 'The organisation that runs the scheme.' },
          summary: { type: 'string', minLength: 1, description: 'What the scheme offers, in a sentence.' },
          url: { type: 'string', format: 'uri', pattern: '^https://', description: 'The provider\'s page about the scheme.' },
          checkedOn: { ...DATE, description: 'When the details were last checked with the provider.' },
          areas: {
            type: 'object',
            description: 'Where the scheme is available. Left out if it covers the whole of the UK. A business is covered if its area matches any of these.',
            properties: {
              countries: { ...TEXT_LIST, example: ['England', 'Scotland', 'Wales'] },
              regions: { ...TEXT_LIST, example: ['North West'] },
              localAuthorities: {
                type: 'array',
                description: 'Office for National Statistics (GSS) codes.',
                items: { type: 'string', pattern: '^[EWSN]\\d{8}$' },
                example: ['E08000003']
              }
            }
          },
          amount: {
            type: 'object',
            description: 'How much a business can get, in pounds. Either end is left out if there is no limit.',
            properties: {
              min: { type: 'number', minimum: 0 },
              max: { type: 'number', minimum: 0 }
            }
          },
          sectors: { ...TEXT_LIST, description: 'The sectors the scheme is for. Left out if it is open to every sector.' },
          purposes: { ...TEXT_LIST, description: 'What the funding can be used for. Left out if it can be used for anything.' },
          closesOn: { ...DATE, description: 'The last day to apply. Left out if there is no deadline.' },
          matchFundingRequired: { type: 'boolean', description: 'Whether the business must pay part of the cost itself.' },
          interestRate: { type: 'string' },
          repaymentTerm: { type: 'string' },
          fees: { type: 'string' },
          contribution: { type: 'string', description: 'How much of the cost a grant pays.' },
          decisionTime: { type: 'string' },
          investmentType: { type: 'string' },
          eligibility: { ...TEXT_LIST, description: 'Who can apply, as short statements.' }
        }
      },
      Problem: {
        type: 'object',
        description: 'An error, in the format set out in RFC 9457.',
        required: ['type', 'title', 'status'],
        properties: {
          type: { type: 'string' },
          title: { type: 'string' },
          status: { type: 'integer' },
          detail: { type: 'string' }
        }
      }
    }
  }
}
