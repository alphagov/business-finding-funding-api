// How values in TPX's One Platform schema workbook (version 1.3) map to the
// values on our fixed lists (see migrations/002-add-list-values.sql).
//
// These are decisions, not facts, so they are kept here where they can be
// reviewed and changed. A value that is on our list already does not need
// an entry. A value that is neither on our list nor here is reported, and
// its scheme is not imported, because guessing could change what the
// scheme is for: leaving out a sector, for example, would make the scheme
// look open to every sector.
//
// Keys are the workbook's values in lower case, with underscores.

// Support goals mapped to Find funding's purposes ("What best describes what
// you're trying to achieve?"). A goal can map to more than one purpose. An
// empty list means the goal has no matching purpose and is left out, which
// is safe as long as the scheme has another goal: a scheme whose goals are
// all left out is reported, because it would look open to every purpose.
export const GOALS: Record<string, string[]> = {
  start_up: ['start-business'],
  growth: ['grow-sales'],
  // Capital spending is on equipment or property.
  capital: ['equipment', 'premises'],
  working_capital: ['cash-flow'],
  cash_flow: ['cash-flow'],
  // Revenue funding pays running costs.
  revenue: ['cash-flow'],
  innovation: ['research-innovation', 'new-product'],
  digital: ['digital-ai'],
  property: ['premises'],
  equipment: ['equipment'],
  recruitment: ['hire-staff'],
  training: ['train-staff'],
  productivity: ['productivity'],
  marketing: ['grow-sales'],
  exporting: ['export'],
  net_zero: ['energy'],
  sustainability: ['energy'],
  // Find funding has no purpose for these yet.
  social_impact: []
}

// Sector names in the workbook that are not on the sector list, mapped to
// the nearest sectors on it. "Any" means open to every sector.
export const SECTORS: Record<string, string[]> = {
  digital: ['technology'],
  information_and_communication: ['technology'],
  // Energy technology and supply.
  energy: ['energy-supply'],
  creative_industries: ['arts-leisure'],
  health: ['health-social-care', 'human-health'],
  // Community organisations would choose "Other" in Find funding.
  community_development: ['other']
}

// Business stages. In the workbook, start_up always comes between pre_start
// and trading, so it means a business in its first year.
export const BUSINESS_STAGES: Record<string, string> = {
  start_up: 'first-year'
}

// Statuses. "planned" is a scheme that has not opened yet.
export const STATUSES: Record<string, string> = {
  planned: 'pre-launch'
}

// Spend types. "Both" means capital and revenue.
export const SPEND_TYPES: Record<string, string[]> = {
  both: ['capital', 'revenue']
}

// "Speed to support" is written in two ways in the workbook: as text, like
// "In 1 to 3 months", and as codes, like 1_TO_3_MONTHS.
export const SUPPORT_SPEEDS: Record<string, string> = {
  less_than_1_month: 'less-than-1-month',
  in_1_to_3_months: '1-to-3-months',
  '1_to_3_months': '1-to-3-months',
  in_4_to_6_months: '4-to-6-months',
  '4_to_6_months': '4-to-6-months',
  more_than_6_months: 'over-6-months',
  // Overlaps two choices, so the longer one is used, to avoid raising
  // expectations.
  in_3_to_6_months: '4-to-6-months'
}

// Investment types, which the data dictionary does not describe, as text to
// show to businesses.
export const INVESTMENT_TYPES: Record<string, string> = {
  venture_capital: 'Venture capital',
  growth_capital: 'Growth capital',
  early_stage: 'Early-stage investment',
  spinout: 'Investment in university spin-out companies'
}

// UK-wide area codes, which the database does not hold, because a scheme
// with no areas covers the whole UK. Great Britain, and England and Wales,
// are held as their countries.
export const UK_WIDE_AREAS: Record<string, string[]> = {
  K02000001: [],
  K03000001: ['E92000001', 'S92000003', 'W92000004'],
  K04000001: ['E92000001', 'W92000004']
}
