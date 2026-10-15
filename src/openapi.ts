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
      'A proof of concept for GOV.UK Business. It holds pilot data from the One Platform schema workbook, which is still being checked, so check the details with the provider before relying on them.',
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
      Status: {
        type: 'string',
        enum: ['open', 'open-paused', 'open-exhausted', 'closed-cyclical', 'closed-permanent', 'pre-launch'],
        description: 'open: taking applications. open-paused: open, but not taking applications for now. open-exhausted: open, but the money has been used up. closed-cyclical: closed until the next round. closed-permanent: closed for good. pre-launch: not open yet. Services should only offer open schemes to businesses.'
      },
      SchemeList: {
        type: 'object',
        required: ['example', 'count', 'schemes'],
        properties: {
          example: { type: 'boolean', description: 'True if any scheme in the list is made up for testing.' },
          count: { type: 'integer', minimum: 0, description: 'How many schemes are in the list.' },
          schemes: { type: 'array', items: { $ref: '#/components/schemas/Scheme' } }
        }
      },
      Scheme: {
        type: 'object',
        required: ['id', 'type', 'name', 'provider', 'summary', 'url', 'status', 'checkedOn', 'eligibility'],
        properties: {
          id: { type: 'string', pattern: '^[a-z0-9]+([_-][a-z0-9]+)*$', description: 'A permanent identifier for the scheme: lower case letters and numbers, joined by hyphens or underscores.', example: 'start_up_loans_uk' },
          type: { $ref: '#/components/schemas/FundingType' },
          name: { type: 'string', minLength: 1, example: 'Example Growth Loan' },
          provider: { type: 'string', minLength: 1, description: 'The organisation that runs the scheme.' },
          summary: { type: 'string', minLength: 1, description: 'What the scheme offers, in a sentence.' },
          whoCanApply: { type: 'string', minLength: 1, description: 'Who the scheme is for, in a sentence.' },
          url: { type: 'string', format: 'uri', pattern: '^https://', description: 'The provider\'s page about the scheme.' },
          applicationUrl: { type: 'string', format: 'uri', pattern: '^https://', description: 'Where to apply, if it is not the provider\'s page.' },
          status: { $ref: '#/components/schemas/Status' },
          statusCheckedOn: { ...DATE, description: 'When the status was last checked, if separately from the other details.' },
          replacedBy: { type: 'string', description: 'The identifier of the scheme that replaces this one.' },
          nextRound: { type: 'string', description: 'What is known about the next funding round, for example "Future funding rounds may be announced".' },
          checkedOn: { ...DATE, description: 'When the details were last checked with the provider.' },
          reviewBy: { ...DATE, description: 'When the details must next be checked.' },
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
          businessStages: { ...TEXT_LIST, description: 'How long a business must have been trading: pre-start, first-year, trading or established. Left out if it is open to businesses at any stage.', example: ['trading', 'established'] },
          legalStructures: { ...TEXT_LIST, description: 'The types of organisation that can apply, for example limited-company or charity. Left out if it is open to all.', example: ['limited-company', 'sole-trader'] },
          spendTypes: { ...TEXT_LIST, description: 'What the money can be spent on: capital, revenue, r-and-d or training.', example: ['capital'] },
          closesOn: { ...DATE, description: 'The last day to apply. Left out if there is no deadline.' },
          supportSpeed: { type: 'string', enum: ['less-than-1-month', '1-to-3-months', '4-to-6-months', 'over-6-months'], description: 'How soon a business can expect the money.' },
          decisionTime: { type: 'string', description: 'How long a decision usually takes.' },
          matchFundingRequired: { type: 'boolean', description: 'Whether the business must pay part of the cost itself.' },
          matchFundingPercent: { type: 'integer', minimum: 0, maximum: 100, description: 'The share of the cost the business must pay itself.' },
          premisesRequired: { type: 'boolean', description: 'Whether the business must have premises.' },
          premisesTenure: { type: 'string', enum: ['own', 'rent', 'either'], description: 'Whether the business must own or rent its premises.' },
          interestRate: { type: 'string', description: 'For loans.' },
          repaymentTerm: { type: 'string', description: 'For loans.' },
          fees: { type: 'string', description: 'For loans.' },
          contribution: { type: 'string', description: 'How much of the cost a grant pays.' },
          paidInArrears: { type: 'boolean', description: 'For grants: whether the money is paid after the business has spent it.' },
          subsidyControlApplies: { type: 'boolean', description: 'For grants: whether subsidy control rules apply.' },
          investmentType: { type: 'string', description: 'For equity investment, for example "Venture capital".' },
          ownershipExchangeRequired: { type: 'boolean', description: 'For equity investment: whether the business must give investors a share of the business.' },
          followOnInvestmentAvailable: { type: 'boolean', description: 'For equity investment: whether more investment may follow.' },
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
