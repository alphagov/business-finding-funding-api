// What the spike keeps from each source: every entry as the source gives it,
// before any mapping to the funding data API's model. Mapping comes later in
// the spike, so these files show exactly what each source says.

export type SourceName = 'govuk-finder' | 'find-a-grant' | 'north-east-growth-hub' | 'tees-valley'

export type Value = string | number | boolean | string[] | null

export interface Entry {
  source: SourceName
  // The source's own identifier, such as a slug.
  id: string
  name: string
  // The entry's page on the source.
  page: string
  // Whether the source's page for this entry was read, or only its listing.
  read: 'page' | 'listing only'
  // The body that runs the scheme, where the source names it.
  provider: string | null
  // The running body's own page for the scheme, where the source links to it.
  providerPage: string | null
  applyPage: string | null
  // When the source says the entry was last changed.
  updated: string | null
  // Coded values and labelled fields, as the source gives them.
  fields: Record<string, Value>
  // The entry's description as plain text, with email addresses removed.
  text: string
  // A SHA-256 of the reply the entry was read from, to see when it changes.
  fingerprint: string | null
}

export interface Collection {
  source: SourceName
  label: string
  readOn: string
  requests: number
  entries: Entry[]
  // Pages that could not be read or did not have the expected parts.
  problems: string[]
}

// Saves a reply as it came, for the national sources' data. Directory pages
// are not saved whole, because they name contact people.
export type Keep = (name: string, text: string) => void
