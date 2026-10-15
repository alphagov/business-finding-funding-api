-- The funding data: the schemes, the lists of values they use, and the
-- areas they are available in.
--
-- It is designed to hold everything in the One Platform schema workbook
-- (TPX, version 1.3), as well as the data Find funding uses today.
--
-- Values that come from a fixed list, such as types of funding and
-- sectors, are kept in their own tables and schemes refer to them, so a
-- value that is not on the list cannot be saved. List codes use lower case
-- letters, numbers and hyphens.
--
-- A scheme's lists of sectors, purposes, areas, business stages and legal
-- structures are left empty when it is open to all.

-- The fixed lists

create table funding_types (
  code text primary key check (code ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null unique
);

create table scheme_statuses (
  code text primary key check (code ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null unique
);

-- How the scheme was found, for example a national scheme or one a council
-- points businesses to.
create table source_types (
  code text primary key check (code ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null unique
);

-- How soon a business can expect the money. The same choices as Find
-- funding's "When do you need the funding?" question.
create table support_speeds (
  code text primary key check (code ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null unique
);

-- What the money can be spent on, for example capital or revenue costs.
create table spend_types (
  code text primary key check (code ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null unique
);

create table sectors (
  code text primary key check (code ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null unique
);

-- What a business wants the funding for.
create table purposes (
  code text primary key check (code ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null unique
);

create table business_stages (
  code text primary key check (code ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null unique
);

create table legal_structures (
  code text primary key check (code ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null unique
);

-- Countries, English regions and local authorities, with their Office for
-- National Statistics (GSS) codes. A scheme for the whole of the UK has no
-- areas, so there are no UK, Great Britain or England and Wales codes.
create table areas (
  code text primary key,
  name text not null,
  level text not null check (level in ('country', 'region', 'local-authority')),
  unique (level, name),
  constraint areas_ons_code check (
    (level = 'country' and code ~ '^[ENSW]92000[0-9]{3}$') or
    (level = 'region' and code ~ '^E12[0-9]{6}$') or
    (level = 'local-authority' and code ~ '^(E0[6-9]|W06|S12|N09)[0-9]{6}$')
  )
);

-- The schemes

-- What every scheme has, whatever its type.
create table schemes (
  -- Permanent: services store it, for example in shortlists. Lower case
  -- letters and numbers, joined by hyphens or underscores.
  id text primary key check (id ~ '^[a-z0-9]+([_-][a-z0-9]+)*$'),
  type text not null references funding_types (code),
  name text not null check (name <> ''),
  provider text not null check (provider <> ''),
  -- What the scheme offers, in a sentence.
  summary text not null check (summary <> ''),
  -- Who the scheme is for, in a sentence.
  who_can_apply text check (who_can_apply <> ''),
  -- The provider's page about the scheme.
  url text not null check (url ~ '^https://[^\s]+$'),
  application_url text check (application_url ~ '^https://[^\s]+$'),
  status text not null default 'open' references scheme_statuses (code),
  replaced_by text references schemes (id) on update cascade on delete set null,
  check (replaced_by <> id),
  -- For example "Future funding rounds may be announced".
  next_round text check (next_round <> ''),
  source_type text references source_types (code),

  -- In pounds. Either end is left empty if there is no limit.
  amount_min integer check (amount_min >= 0),
  amount_max integer check (amount_max >= 0),
  check (amount_min <= amount_max),
  match_funding_required boolean,
  -- The share of the costs the business must pay itself.
  match_funding_percent smallint check (match_funding_percent between 0 and 100),

  -- The last day to apply. Empty if there is no deadline.
  closes_on date,
  support_speed text references support_speeds (code),
  decision_time text check (decision_time <> ''),
  spend_type text references spend_types (code),
  premises_required boolean,
  premises_tenure text check (premises_tenure in ('own', 'rent', 'either')),

  -- When the details were last checked with the provider, and by whom.
  checked_on date not null,
  checked_by text check (checked_by <> ''),
  -- When the status was last checked, if separately from the details.
  status_checked_on date,
  -- When the details must next be checked.
  review_by date,
  check (review_by >= checked_on),

  -- True for made-up schemes used for testing.
  example boolean not null default false,

  -- Lets the details tables below check they belong to the right type.
  unique (id, type)
);

-- Details for each type of funding. Each type has its own table, so a new
-- type can be added without changing the schemes table. The type column
-- and the foreign key mean, for example, that loan details can only belong
-- to a loan.

create table loan_details (
  scheme_id text primary key,
  type text not null default 'loan' check (type = 'loan'),
  interest_rate text check (interest_rate <> ''),
  repayment_term text check (repayment_term <> ''),
  fees text check (fees <> ''),
  foreign key (scheme_id, type) references schemes (id, type) on update cascade on delete cascade
);

create table grant_details (
  scheme_id text primary key,
  type text not null default 'grant' check (type = 'grant'),
  -- How much of the cost the grant pays, for example "70% of eligible
  -- project costs".
  contribution text check (contribution <> ''),
  paid_in_arrears boolean,
  subsidy_control_applies boolean,
  foreign key (scheme_id, type) references schemes (id, type) on update cascade on delete cascade
);

create table equity_details (
  scheme_id text primary key,
  type text not null default 'equity' check (type = 'equity'),
  investment_type text check (investment_type <> ''),
  ownership_exchange_required boolean,
  follow_on_investment_available boolean,
  foreign key (scheme_id, type) references schemes (id, type) on update cascade on delete cascade
);

-- The lists on each scheme. Empty when the scheme is open to all.

create table scheme_sectors (
  scheme_id text references schemes (id) on update cascade on delete cascade,
  sector text references sectors (code),
  primary key (scheme_id, sector)
);

create table scheme_purposes (
  scheme_id text references schemes (id) on update cascade on delete cascade,
  purpose text references purposes (code),
  primary key (scheme_id, purpose)
);

-- A business is covered if its area matches any of these. Empty for the
-- whole of the UK.
create table scheme_areas (
  scheme_id text references schemes (id) on update cascade on delete cascade,
  area_code text references areas (code),
  primary key (scheme_id, area_code)
);

create table scheme_business_stages (
  scheme_id text references schemes (id) on update cascade on delete cascade,
  business_stage text references business_stages (code),
  primary key (scheme_id, business_stage)
);

create table scheme_legal_structures (
  scheme_id text references schemes (id) on update cascade on delete cascade,
  legal_structure text references legal_structures (code),
  primary key (scheme_id, legal_structure)
);

-- Who can apply, as short statements, in the order they are shown.
create table scheme_eligibility (
  scheme_id text references schemes (id) on update cascade on delete cascade,
  position smallint check (position > 0),
  criterion text not null check (criterion <> ''),
  primary key (scheme_id, position)
);
