# FF-121 spike: funding data from structured sources

This folder is a spike, kept on its own branch and not merged. It tests how much of the North East grant data can be taken from structured sources with no AI, as planned in Jira FF-121.

Day 1 reads four sources and saves every North East entry as each source gives it, before any mapping to this API's model.

| Source | How it is read | What it gives |
|---|---|---|
| GOV.UK business finance support finder | GOV.UK Search API, every scheme tagged with the North East, then the Content API for each | Coded regions, business sizes, stages, industries and types of support, the publishing organisation, the link to the running body's page, and the text |
| Find a Grant | The data its listing and grant pages carry for their own script, filtered to North East England | Funder, location, who can apply, smallest, largest and total award, opening and closing dates, the application link, and the eligibility and other text |
| North East Growth Hub | Its pages, as it has no API: the resource list, the business support list, and the own page of each finance entry | Provider and link, open or closed, area, categories, grant size, deadline, who it is open to, when the page was last updated, and the text |
| Tees Valley Combined Authority business support directory | Its sitemap for the entries, then each entry's page | Location, business stage, sector, help category, the provider's and application links, and the text |

## Running it

```sh
npm run spike:collect
npm run spike:collect -- --only govuk-finder,tees-valley
npm run spike:test
```

The sources are `govuk-finder`, `find-a-grant`, `north-east-growth-hub` and `tees-valley`. A full run makes about 300 requests and takes about 5 minutes.

## How it behaves

- It makes public requests only, needs no key and signs in nowhere.
- It makes one request at a time, at most one a second, with a User-Agent that names the spike and this repository.
- It does not save directory pages whole, and it removes email addresses from all the text it saves.
- A page that times out or gives a server error is tried once more, 5 seconds later.
- A page that still cannot be read, or that has lost the parts the spike reads, is listed under `problems` in its source's file, and the run carries on.
- Directory pages name contact people, with their email addresses and telephone numbers. The spike does not keep these.
- The Growth Hub's resource list ends with careers and schools resources that have no page of their own (from page 13 or 14 of 21 on 20 November 2026). Every list page is read, and these are passed over.
- Some Growth Hub entries still on the list show the resource list instead of their own page, so they seem to have been removed. They are listed under `problems`.

## Mapping

`npm run spike:map` maps the latest collection to the funding data API's fields and makes no requests. For each entry and field it records whether the value is **coded** (from a coded value or labelled field, mapped by the draft tables in `mapping.ts`), only possibly in the **text**, or not given at all (**none**). It writes `mapped/<source>.json` and `coverage.md` in the collection's folder.

The tables in `mapping.ts` are draft decisions, for someone who knows the content to check. A value with no mapping is reported, never guessed.

## What it saves

Files go to `spike/ff-121/output/<date>/`, which git ignores. This repository is public, and the files are working copies for the spike.

- `<source>.json`: every entry, with the source's own name, page, provider, links, last updated date, fields and text, and a fingerprint of the page it came from.
- `raw/govuk-finder/` and `raw/find-a-grant/`: the data replies as they came, without email addresses, so the results can be checked.

Entries the Growth Hub lists but that are not about finance are kept from the list only, with `read` set to `listing only`.
