// How each source's coded values and labelled fields map to the values on the
// funding data API's fixed lists (migrations/002-add-list-values.sql) and to
// ONS area codes (migrations/003-add-ons-areas.sql).
//
// These are draft decisions for the spike, to be checked by someone who knows
// the content, as src/tpx/mapping.ts is for the workbook. A value with no
// entry here is reported as unmapped, never guessed. Where a source lists
// every value it has, the scheme is open to all, which the API holds as an
// empty list.

// ONS codes for the UK, its countries and the English regions.
export const UK_WIDE: string[] = []
export const ENGLAND = 'E92000001'
export const REGIONS: Record<string, string> = {
  'north-east': 'E12000001',
  'north-west': 'E12000002',
  'yorkshire-and-the-humber': 'E12000003',
  'east-midlands': 'E12000004',
  'west-midlands': 'E12000005',
  eastern: 'E12000006',
  london: 'E12000007',
  'south-east': 'E12000008',
  'south-west': 'E12000009',
  scotland: 'S92000003',
  wales: 'W92000004',
  'northern-ireland': 'N92000002'
}

// The twelve council areas in the North East region, by the names both
// directories use.
export const NORTH_EAST_COUNCILS: Record<string, string> = {
  'County Durham': 'E06000047',
  Darlington: 'E06000005',
  Gateshead: 'E08000037',
  Hartlepool: 'E06000001',
  Middlesbrough: 'E06000002',
  'Newcastle upon Tyne': 'E08000021',
  'North Tyneside': 'E08000022',
  Northumberland: 'E06000057',
  'Redcar and Cleveland': 'E06000003',
  'South Tyneside': 'E08000023',
  'Stockton-on-Tees': 'E06000004',
  Sunderland: 'E08000024'
}

// Find a Grant's location choices. It has no separate choice for London, the
// East of England or Yorkshire and the Humber, so its broader choices are
// read as covering them. "National" is the whole UK.
export const FIND_A_GRANT_LOCATIONS: Record<string, string[]> = {
  National: UK_WIDE,
  England: [ENGLAND],
  'North East England': ['E12000001'],
  'North West England': ['E12000002', 'E12000003'],
  Midlands: ['E12000004', 'E12000005'],
  'South East England': ['E12000006', 'E12000007', 'E12000008'],
  'South West England': ['E12000009'],
  Scotland: ['S92000003'],
  Wales: ['W92000004'],
  'Northern Ireland': ['N92000002']
}

// Kinds of help that are funding types in the API. Other kinds, such as
// GOV.UK's "finance" or "expertise-and-advice", are not.
export const FUNDING_TYPES: Record<string, string> = {
  grant: 'grant',
  loan: 'loan',
  equity: 'equity'
}

// Business stages. The sources have fewer stages than the API: "start-up" is
// read as a business in its first year, and "established" or "trading" as
// one trading for longer.
export const GOVUK_STAGES: Record<string, string[]> = {
  'not-yet-trading': ['pre-start'],
  'start-up': ['first-year'],
  established: ['trading', 'established']
}
export const GROWTH_HUB_STAGES: Record<string, string[]> = {
  'Start-up': ['pre-start', 'first-year'],
  'Trading business': ['trading', 'established']
}
export const TEES_VALLEY_STAGES: Record<string, string[]> = {
  'Start-Up': ['pre-start', 'first-year'],
  'Established Business': ['trading', 'established']
}
// Tees Valley lists "Social Enterprise" as a stage. It is a kind of
// organisation, not a stage, so it is left out of stages.
export const NOT_STAGES = new Set(['Social Enterprise'])

// GOV.UK finder industries to the API's sectors. Its 17 industries are
// broader than the API's 30 sectors, so most map to several.
export const GOVUK_INDUSTRIES: Record<string, string[]> = {
  'agriculture-and-food': ['agriculture'],
  'business-and-finance': ['advisory-financial', 'financial-insurance', 'professional-scientific', 'administrative-support'],
  construction: ['construction'],
  education: ['education'],
  health: ['health-social-care', 'human-health'],
  'hospitality-and-catering': ['hospitality'],
  'information-technology-digital-and-creative': ['technology', 'arts-leisure'],
  'life-sciences': ['life-sciences'],
  manufacturing: ['manufacturing', 'engineering', 'plastics', 'specialist-engineering'],
  mining: ['mining-quarrying', 'extractives'],
  'real-estate-and-property': ['real-estate'],
  'science-and-technology': ['professional-scientific', 'technology'],
  'service-industries': ['consumer-goods', 'administrative-support'],
  'transport-and-distribution': ['transport-storage', 'haulage-logistics'],
  'travel-and-leisure': ['arts-leisure', 'hospitality'],
  'utilities-providers': ['utilities', 'energy-supply', 'waste'],
  'wholesale-and-retail': ['wholesale-retail', 'online-retail']
}

// Tees Valley directory sectors to the API's sectors. "Export" is a kind of
// help, not a sector, so it is left out.
export const TEES_VALLEY_SECTORS: Record<string, string[]> = {
  'Advanced Manufacturing & Engineering': ['manufacturing', 'engineering'],
  'Business & Professional Services': ['professional-scientific', 'advisory-financial', 'administrative-support'],
  'Chemical & Process': ['manufacturing'],
  Construction: ['construction'],
  'Creative & Cultural Industries': ['arts-leisure'],
  'Digital & Tech': ['technology'],
  Education: ['education'],
  'Energy & Renewables': ['energy-supply', 'utilities'],
  'Health & Social Care': ['health-social-care', 'human-health'],
  Hospitality: ['hospitality'],
  'Life Sciences': ['life-sciences'],
  Logistics: ['haulage-logistics', 'transport-storage'],
  Retail: ['wholesale-retail', 'online-retail'],
  'Tourism & Leisure': ['arts-leisure', 'hospitality']
}
export const NOT_SECTORS = new Set(['Export'])

// Find a Grant's "who can apply" choices to the API's legal structures.
// "Private Sector" covers every kind of business, so it means open to all.
// The others are not businesses, apart from non-profits, which may be
// charities or community interest companies.
export const FIND_A_GRANT_APPLICANTS: Record<string, string[] | 'all' | 'not a business'> = {
  'Private Sector': 'all',
  'Non-profit': ['charity', 'cic'],
  'Personal / Individual': 'not a business',
  'Public Sector': 'not a business',
  'Local authority': 'not a business'
}
