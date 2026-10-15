# Funding data API (business-finding-funding-api)

A read-only JSON API over the funding schemes that UK businesses can apply for: loans, grants and equity investment. It is owned by the GOV.UK Business team (`@alphagov/gov-uk-business-team`).

It is a proof of concept. The aim is for [Find funding for your business](https://github.com/alphagov/business-finding-funding), other GOV.UK Business services and AI assistants to read one source of funding data, rather than each keeping their own copy. See Jira [FF-89](https://gov-uk.atlassian.net/browse/FF-89).

It is written in [TypeScript](https://www.typescriptlang.org/) and built with [Express](https://expressjs.com/). It reads the schemes from a [Postgres](https://www.postgresql.org/) database, and runs on Heroku.

The funding schemes are made-up examples until the real data is ready. See [Funding data](#funding-data).

## What it includes

| Path | Purpose |
| ---- | ------- |
| `/v1/schemes` | Lists the schemes. Filter with `type`, `sector` and `purpose`, repeating a filter to match any of its values, for example `?type=loan&type=grant` |
| `/v1/schemes/{id}` | One scheme |
| `/openapi.json` | The OpenAPI 3.1 specification |
| `/docs` | Documentation, using Swagger UI |
| `/` | Redirects to `/docs` |
| `/health` | Health check that returns `{"status":"ok"}`, or `{"status":"error"}` with status 503 if the database cannot be reached |
| `/robots.txt` | Stops search engines crawling the API |

- The data is public, so the API needs no password or API key, and any website can read it. There is no way to change data through the API: changes are made to the data file by pull request, and loaded into the database when the API is deployed.
- Errors use the [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) problem format. Filters that are not recognised are errors, not ignored.
- Responses can be cached for 5 minutes.
- In production, plain HTTP requests are redirected to HTTPS.
- Every response sends an `X-Robots-Tag: noindex, nofollow` header, so the API is not listed in search results, and a `Content-Security-Policy` header that allows nothing to load except on the documentation page.

## How the code is organised

| File | Purpose |
| ---- | ------- |
| `src/config.ts` | Reads all settings from environment variables, in one place |
| `src/app.ts` | Creates the Express application: the API routes, documentation and security headers |
| `src/server.ts` | Starts the application on a port. The only file tied to running as a long-lived server |
| `src/openapi.ts` | The OpenAPI specification, including the published scheme format |
| `src/schemes.ts` | The format of the funding data file, and the checks run on it |
| `src/db.ts` | Connects to the database |
| `src/store.ts` | Reads the schemes from the database, in the format the API publishes |
| `src/migrate.ts` | Brings the database up to date by running the files in `migrations/` |
| `src/load.ts` | Loads the data file into the database |
| `migrations/` | The SQL that creates the database tables and fills the fixed lists |
| `data/funding-schemes.json` | The funding schemes |
| `compose.yaml` | A local database for running the API and its tests |
| `test/` | Tests, written in TypeScript |

The API keeps nothing on local disk between requests and takes all its settings from environment variables, so it can move from Heroku to another platform by replacing `src/server.ts` rather than rewriting the app.

## Funding data

For now, the master copy of the funding schemes is `data/funding-schemes.json`. Each deploy loads it into the database, so the database matches the file: schemes are added or updated, and schemes no longer in the file are removed. While `example` is `true` in that file, the API says so in every list of schemes, and services using it should say the schemes are not real.

Each scheme has:

| Field | Required | What it is |
| ----- | -------- | ---------- |
| `id` | Yes | A unique name using lower case letters, numbers and hyphens, for example `growth-guarantee-scheme`. Services store this, for example in shortlists, so do not change it once published |
| `type` | Yes | `loan`, `grant` or `equity` |
| `name`, `provider`, `summary` | Yes | The scheme's name, who runs it, and what it offers in a sentence |
| `url` | Yes | The provider's page about the scheme, starting `https://` |
| `checkedOn` | Yes | When the details were last checked with the provider, like `2026-10-08` |
| `eligibility` | Yes | A list of who can apply |
| `areas` | No | Where the scheme is available: lists of `countries` (for example `England`), `regions` (for example `North West`) and `localAuthorities` (ONS codes, for example `E08000003` for Manchester). Leave out for the whole of the UK |
| `amount` | No | `min` and `max` in pounds. Leave out either if there is no limit |
| `sectors`, `purposes` | No | The sector and purpose values used by Find funding's questions. Leave out if the scheme is for all |
| `closesOn` | No | The last day to apply |
| `matchFundingRequired` | No | `true` if the business must pay part of the costs |
| `interestRate`, `repaymentTerm`, `fees` | No | For loans |
| `contribution`, `decisionTime` | No | For grants |
| `investmentType` | No | For equity |

The file is checked before it is loaded, and the database checks every value again as it is saved. The whole file is loaded in one transaction, so if anything is wrong nothing changes and the deploy stops. `npm test` checks the file and every response against the scheme format in the specification, and checks that the API publishes every scheme exactly as it is in the file, so the data, the database, the API and the specification cannot drift apart.

## Database

The database is designed to hold everything in TPX's One Platform schema workbook (version 1.3), as well as the data in `data/funding-schemes.json`. The aim is to load the workbook's schemes into it next.

| Table | What it holds |
| ----- | ------------- |
| `schemes` | What every scheme has, whatever its type: name, provider, summary, who can apply, web addresses, status and replacement scheme, amounts, match funding, closing date, how soon the money comes, when the details were checked and by whom, and when they must next be checked |
| `loan_details`, `grant_details`, `equity_details` | Details for each type of funding, for example interest rates for loans. Each type has its own table, so a new type, such as business advice, can be added without changing the `schemes` table |
| `scheme_sectors`, `scheme_purposes`, `scheme_areas`, `scheme_business_stages`, `scheme_legal_structures` | The lists on each scheme. A list is left empty when the scheme is open to all |
| `scheme_eligibility` | Who can apply, as short statements, in order |
| `funding_types`, `scheme_statuses`, `source_types`, `support_speeds`, `spend_types`, `sectors`, `purposes`, `business_stages`, `legal_structures` | The fixed lists of values. Sectors and purposes are the same as Find funding's questions. The others come from the One Platform data dictionary |
| `areas` | Countries, English regions and all 361 local authorities, with their ONS codes, from the ONS Open Geography Portal |
| `schema_migrations` | Which files in `migrations/` have been run |

The database enforces these rules, however data is added:

- values that come from a fixed list, such as a sector or a local authority, must be on the list
- details for one type of funding cannot be added to a scheme of another type, for example an interest rate on a grant
- identifiers use lower case letters and numbers joined by hyphens or underscores, so both the current identifiers and TPX's can be held
- web addresses start with `https://`, the minimum amount is no more than the maximum, percentages are between 0 and 100, and the review date is not before the checked date
- removing a scheme removes its details and lists

These rules would have caught most of the problems found in the TPX files, such as sectors and goals that are not on the lists, and the old area code for Durham County Council.

The API does not publish everything the database can hold yet, for example the status, who can apply and business stages. These will be added to the API when the workbook's schemes are loaded.

### Changing the database

To change the tables or a fixed list, add a new numbered SQL file to `migrations/`, for example `004-add-business-advice.sql`. Never change a file that has been merged. Each file runs once, in a transaction, when the API is deployed. Heroku does not undo a migration when it rolls back a release, so a migration must still work with the code that was live before it: add tables and columns rather than renaming or removing them.

## Swagger UI

The documentation page loads Swagger UI from jsDelivr, pinned to one version and checked against integrity hashes. It is not installed from npm, because the `swagger-ui-dist` package depends on `@scarf/scarf`, which runs an install script that sends usage data to a third party. Swagger UI's online validator is turned off for the same reason.

To upgrade Swagger UI, change the version in `src/app.ts` and replace both integrity hashes. To work out a hash:

```sh
curl -s https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.33.0/swagger-ui-bundle.js | openssl dgst -sha384 -binary | openssl base64 -A
```

## Settings

| Environment variable | Purpose |
| -------------------- | ------- |
| `PORT` | The port to listen on. Heroku sets it. Locally it is 3001, so the API can run alongside Find funding on port 3000 |
| `NODE_ENV` | `production` turns on the HTTPS redirect and an encrypted database connection. Heroku sets it to `production` unless it is set under **Settings > Config Vars** |
| `DATABASE_URL` | The database. Heroku Postgres sets it. Locally it is the database in `compose.yaml` |
| `TEST_DATABASE_URL` | The database the tests use. It is `funding_test` in the database in `compose.yaml` unless this is set. The tests refuse to use a database that is not on the same computer, so they cannot change a real one |

## Run it locally

Requires Node.js 24 and Docker. If you use `nvm` or `fnm`, run `nvm use` or `fnm use` in this folder to pick it up from `.nvmrc`.

```sh
npm install
npm run db:start
npm run db:update
npm run dev
```

Then go to http://localhost:3001/docs.

- `npm run db:start` starts a local Postgres database in Docker, using `compose.yaml`. It keeps its data when it is stopped.
- `npm run db:update` runs any new migrations, then loads `data/funding-schemes.json`. Run it again after changing either.
- `npm run dev` runs the TypeScript directly and restarts when you save a file.

To stop the database, run `docker compose stop`. To delete it and start again, run `docker compose down --volumes`.

To have Find funding read its schemes from the API, run this in the Find funding folder at the same time:

```sh
FUNDING_API_URL=http://localhost:3001 npm run dev
```

To run the compiled version, as Heroku does:

```sh
npm run build
npm start
```

## Checks

| Command | What it does |
| ------- | ------------ |
| `npm run typecheck` | Checks the TypeScript types in `src/` and `test/` |
| `npm run build` | Compiles `src/` into JavaScript in `dist/` |
| `npm test` | Runs the tests. They need the local database, so run `npm run db:start` first |

Each test file uses its own empty copy of the tables, which it removes when it finishes, so the tests never change the database you use with `npm run dev`.

GitHub Actions runs all three, with its own database, on every pull request and on each change to `main` (see `.github/workflows/test.yml`). The check is called `test`, and must pass before a pull request can be merged.

## Logs

The API writes to standard output: a line when it starts, and the details of any unexpected error. Heroku also logs every request, with its path, status and response time. To see the logs:

```sh
heroku logs --tail -a govuk-business-funding-api
```

## Deploy to Heroku

Heroku:

- installs all dependencies, runs `npm run build` to compile the TypeScript, then removes the development-only packages
- runs the release phase in `Procfile` before the new release goes live: `npm run release` runs any new migrations, then loads `data/funding-schemes.json` into the database. If it fails, the live release is not changed
- uses `Procfile` to start the web process (`npm start`, which runs `node dist/server.js`)
- uses `engines.node` in `package.json` to choose the Node.js version
- sets the `PORT` environment variable automatically
- sets `DATABASE_URL` to the app's Heroku Postgres database

The compiled `dist/` folder is not committed to the repository.

The API is deployed to the `govuk-business-funding-api` app in the `government-digital-service` team, at https://govuk-business-funding-api-701ff32e2a83.herokuapp.com/docs. Its database is a Heroku Postgres Essential 0 database (Postgres 18, up to 1 GB). The Essential plans only have one database user, so the API reads the data with the same user that the release phase uses to change it. A Standard plan would let the API use a user that can only read.

### How deployment works

Every change merged to `main` is deployed automatically by the `deploy` job in `.github/workflows/test.yml`, once the `test` job has passed. The job runs `scripts/deploy-heroku.sh`, which:

1. packages the commit and uploads it to Heroku
2. builds it, showing Heroku's build log in the GitHub Actions log
3. waits for the release phase to update the database, showing its log
4. waits for the new release to start, then checks it is still running after Heroku's 60 second start-up limit
5. requests `/health`, which also checks the database, and checks it returns `{"status":"ok"}`

If the build or the release phase fails, the job fails and the previous release keeps running. If the new release does not start, crashes, or does not answer `/health`, the job rolls the app back to the release that was live before, then fails. If the rollback itself fails, the job log says so and shows the command to run by hand: `heroku rollback -a govuk-business-funding-api`.

To redeploy without a code change, run the **Test and deploy** workflow by hand on `main` from the Actions tab.

### Setting up deployment

This only needs doing once, by someone with access to the Heroku app:

1. Create a Heroku API key for this repository only. In Heroku, go to **Account settings > Applications > Authorizations > Create authorization** and give it a description such as "alphagov/business-finding-funding-api deploys". Do not use your personal API key.
2. In this repository, go to **Settings > Environments > heroku** and add an environment secret called `HEROKU_API_KEY` containing the key from step 1. The `heroku` environment only allows deployments from `main`.

To revoke deploy access, delete the authorisation in Heroku. To rotate the key, create a new authorisation, update the secret, then delete the old authorisation.

## Repository settings

- `main` is protected: changes go through a pull request, the `test` check must pass on the latest code, review comments must be resolved, and the branch cannot be force-pushed or deleted
- branches are deleted once their pull request is merged
- Dependabot raises pull requests for security fixes, and weekly for npm and GitHub Actions updates (see `.github/dependabot.yml`)
- secret scanning and push protection are on, and CodeQL scans the code

## Licence

[MIT](LICENCE), Crown Copyright (Government Digital Service).
