// Helpers for turning page markup into plain text. The two directories have
// no API, so their pages are read for a few labelled parts only, not as a
// whole, and a change elsewhere on a page does not affect what is read.

const NAMED: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  hellip: '…',
  ldquo: '“',
  lsquo: '‘',
  lt: '<',
  mdash: '—',
  nbsp: ' ',
  ndash: '–',
  pound: '£',
  quot: '"',
  rdquo: '”',
  rsquo: '’'
}

export function decode (text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, name: string) => {
    if (name.startsWith('#')) {
      const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10)
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
    }
    return NAMED[name.toLowerCase()] ?? whole
  })
}

// Plain text from markup, keeping paragraph and list breaks as new lines.
export function textOf (html: string): string {
  return decode(html
    .replace(/<(script|style|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|li|h[1-6]|div|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// Pages name contact people with their email addresses. The spike keeps no
// one's contact details, so addresses are removed from any text it saves.
const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi

export function withoutEmails (text: string): string {
  return text.replace(EMAIL, '[email address removed]')
}

// A comma-separated value, such as "Darlington, Hartlepool", as a list.
export function listOf (text: string): string[] {
  return text.split(',').map((one) => one.trim()).filter((one) => one !== '')
}

// The first match's first group as plain text, or null.
export function first (html: string, pattern: RegExp): string | null {
  const match = pattern.exec(html)
  return match?.[1] === undefined ? null : textOf(match[1])
}

// A field name from a label, such as "Grant Size" to "grant_size".
export function fieldName (label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}
