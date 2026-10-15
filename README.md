# Funding data API (business-finding-funding-api)

A read-only JSON API over the funding schemes that UK businesses can apply for: loans, grants and equity investment. It is owned by the GOV.UK Business team (`@alphagov/gov-uk-business-team`).

It is a proof of concept. The aim is for [Find funding for your business](https://github.com/alphagov/business-finding-funding), other GOV.UK Business services and AI assistants to read one source of funding data, rather than each keeping their own copy. See Jira [FF-89](https://gov-uk.atlassian.net/browse/FF-89).

It is written in [TypeScript](https://www.typescriptlang.org/) and built with [Express](https://expressjs.com/). It reads the schemes from a [Postgres](https://www.postgresql.org/) database, and runs on Heroku.

It publishes the schemes from TPX's One Platform schema workbook, which is pilot data still being checked. See [Funding data](#funding-data).

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

- The data is public, so the API needs no password or API key, and any website can read it. There is no way to change data through the API: changes are made in the One Platform schema workbook, copied into this repository by pull request, and imported when the API is deployed.
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
| `src/schemes.ts` | The format of the schemes the API publishes, and of the example data file, with the checks run on it |
| `src/db.ts` | Connects to the database |
| `src/store.ts` | Reads the schemes from the database, in the format the API publishes |
| `src/migrate.ts` | Brings the database up to date by running the files in `migrations/` |
| `src/load.ts` | Loads the example data file into the database |
| `src/records.ts` | Saves schemes to the database, with every field the tables hold |
| `src/tpx/` | Imports the One Platform schema workbook. See [Importing the One Platform workbook](#importing-the-one-platform-workbook) |
| `migrations/` | The SQL that creates the database tables and fills the fixed lists |
| `data/one-platform-schemes.json` | The extract of the One Platform schema workbook that each deploy imports |
| `data/example-schemes.json` | Made-up schemes, for the tests and for running locally |
| `compose.yaml` | A local database for running the API and its tests |
| `test/` | Tests, written in TypeScript. `test/fixtures/tpx-workbook.xlsx` holds made-up schemes in the workbook's format |

The API keeps nothing on local disk between requests and takes all its settings from environment variables, so it can move from Heroku to another platform by replacing `src/server.ts` rather than rewriting the app.

## Funding data

The API publishes the schemes from TPX's One Platform schema workbook (version 1.3). It is pilot data, still being checked, so services should tell people to check the details with the provider before applying.

The workbook is the master copy. It is kept by TPX and DBT, not in this repository. The repository holds `data/one-platform-schemes.json`, an extract of the workbook's scheme rows, and each deploy imports it into the database, replacing the schemes there.

The extract leaves out:

- the workbook's comments, the names of the people who made them, links to internal documents and the document's properties, because this repository is public
- the `verified_by` column, which will hold the names of the people who checked each scheme. That stays in the workbook

### How the schemes are imported

For each row of the Loans, Grants and Equities sheets, the import:

- turns the workbook's values into the values on our lists, using the decisions in `src/tpx/mapping.ts`, for example the support goal `WORKING_CAPITAL` into Find funding's purpose `cash-flow`
- checks every value
- imports the scheme only if it has no problems. Guessing could change what a scheme is for, so nothing is guessed

It lists the rows that were not imported and why, in a form that can be sent to TPX to fix in the workbook. The list is in the release phase log of every deploy. If no row can be imported, the import stops and nothing changes, so a broken file cannot remove every published scheme.

With the workbook from 12 October 2026, 45 of the 62 rows are imported.

### Updating the funding data

When TPX send a new version of the workbook:

1. Check it, without changing anything:

   ```sh
   npm run tpx:import -- "path/to/One platform schema v1.3.xlsx" --check
   ```

2. Update the extract:

   ```sh
   npm run tpx:extract -- "path/to/One platform schema v1.3.xlsx"
   ```

3. Open a pull request. Its changes to `data/one-platform-schemes.json` show exactly what has changed in the workbook. Merging it deploys the new schemes.

Do not edit `data/one-platform-schemes.json` by hand. Changes to the data are made in the workbook, so there is only one master copy.

### The mapping

`src/tpx/mapping.ts` holds every decision about how a workbook value maps to ours, with the reason for each. A value that is on our list already needs no entry. A value that is neither on our list nor in the mapping stops its scheme being imported, and is reported. To change a decision, change the mapping and open a pull request.

### Example data

`data/example-schemes.json` holds made-up schemes in a simpler format. The tests use it, and `npm run db:examples` loads it into the local database in place of the workbook's schemes. While `example` is `true` in that file, the API says so in every list of schemes.

## Database

The database holds everything in the One Platform schema workbook (version 1.3).

| Table | What it holds |
| ----- | ------------- |
| `schemes` | What every scheme has, whatever its type: name, provider, summary, who can apply, web addresses, status and replacement scheme, amounts, match funding, closing date, how soon the money comes, when the details were checked and by whom, and when they must next be checked |
| `loan_details`, `grant_details`, `equity_details` | Details for each type of funding, for example interest rates for loans. Each type has its own table, so a new type, such as business advice, can be added without changing the `schemes` table |
| `scheme_sectors`, `scheme_purposes`, `scheme_areas`, `scheme_business_stages`, `scheme_legal_structures`, `scheme_spend_types` | The lists on each scheme. A list is left empty when the scheme is open to all |
| `scheme_eligibility` | Who can apply, as short statements, in order |
| `funding_types`, `scheme_statuses`, `source_types`, `support_speeds`, `spend_types`, `sectors`, `purposes`, `business_stages`, `legal_structures` | The fixed lists of values. Sectors and purposes are the same as Find funding's questions. The others come from the One Platform data dictionary |
| `areas` | Countries, English regions, the 21 county councils and all 361 local authorities, with their ONS codes, from the ONS Open Geography Portal |
| `county_districts` | The districts in each county council. The API publishes a county as its districts, so a business in any of them is covered |
| `schema_migrations` | Which files in `migrations/` have been run |

The database enforces these rules, however data is added:

- values that come from a fixed list, such as a sector or a local authority, must be on the list
- details for one type of funding cannot be added to a scheme of another type, for example an interest rate on a grant
- identifiers use lower case letters and numbers joined by hyphens or underscores, so both the current identifiers and TPX's can be held
- web addresses start with `https://`, the minimum amount is no more than the maximum, percentages are between 0 and 100, and the review date is not before the checked date
- removing a scheme removes its details and lists

These rules would have caught most of the problems found in the TPX files, such as sectors, business stages and statuses that are not on the lists, and closing dates written as text.

The API publishes everything the database holds about each scheme except who checked it and how it was found. See `/docs` for the fields. A county is published as the districts in it.

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
- `npm run db:update` runs any new migrations, then imports `data/one-platform-schemes.json`, as a deploy does. Run it again after changing either. `npm run db:examples` loads the made-up schemes instead.
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
- runs the release phase in `Procfile` before the new release goes live: `npm run release` runs any new migrations, then imports `data/one-platform-schemes.json` into the database. If it fails, the live release is not changed
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
