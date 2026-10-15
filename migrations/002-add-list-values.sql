-- The values on each fixed list. To add a value, add a new migration.

-- The types of funding.
insert into funding_types (code, name) values
  ('loan', 'Loan'),
  ('grant', 'Grant'),
  ('equity', 'Equity investment');

-- From the status list in the One Platform data dictionary.
insert into scheme_statuses (code, name) values
  ('open', 'Open'),
  ('open-paused', 'Open, but paused'),
  ('open-exhausted', 'Open, but the money has been used up'),
  ('closed-cyclical', 'Closed until the next round'),
  ('closed-permanent', 'Closed permanently'),
  ('pre-launch', 'Not open yet');

-- From the source type list in the One Platform data dictionary.
insert into source_types (code, name) values
  ('flagship-national', 'Flagship national scheme'),
  ('council-signpost', 'Council signpost');

-- The same choices as Find funding's "When do you need the funding?" question.
insert into support_speeds (code, name) values
  ('less-than-1-month', 'In less than 1 month'),
  ('1-to-3-months', 'In 1 to 3 months'),
  ('4-to-6-months', 'In 4 to 6 months'),
  ('over-6-months', 'More than 6 months');

-- From the spend type list in the One Platform data dictionary.
insert into spend_types (code, name) values
  ('capital', 'Capital'),
  ('revenue', 'Revenue'),
  ('r-and-d', 'Research and development'),
  ('training', 'Training');

-- The same list as Find funding's sector question, which is also the
-- sector list in the One Platform data dictionary.
insert into sectors (code, name) values
  ('administrative-support', 'Administrative and Support Service Activities'),
  ('advisory-financial', 'Advisory and Financial Services'),
  ('agriculture', 'Agriculture, Forestry and Fishing'),
  ('arts-leisure', 'Arts, Entertainment and Leisure'),
  ('franchises', 'Business Franchises'),
  ('construction', 'Construction'),
  ('consumer-goods', 'Consumer Goods and Services'),
  ('education', 'Education'),
  ('energy-supply', 'Electricity, Gas, Steam and Air Conditioning Supply'),
  ('engineering', 'Engineering'),
  ('extractives', 'Extractives and Mining'),
  ('financial-insurance', 'Financial and Insurance Services'),
  ('haulage-logistics', 'Haulage and Logistics'),
  ('health-social-care', 'Health and Social Care'),
  ('hospitality', 'Hospitality, Accommodation and Food Service Activities'),
  ('human-health', 'Human Health and Social Work Activities'),
  ('life-sciences', 'Life Sciences'),
  ('manufacturing', 'Manufacturing'),
  ('mining-quarrying', 'Mining and Quarrying'),
  ('online-retail', 'Online retail'),
  ('plastics', 'Plastics Manufacturing'),
  ('professional-scientific', 'Professional, Scientific and Technical Activities'),
  ('real-estate', 'Real Estate Activities'),
  ('specialist-engineering', 'Specialist Engineering, Infrastructure'),
  ('technology', 'Technology'),
  ('transport-storage', 'Transportation and Storage'),
  ('utilities', 'Utilities'),
  ('waste', 'Waste Management'),
  ('wholesale-retail', 'Wholesale and Retail Trade'),
  ('other', 'Other');

-- The same choices as Find funding's "What best describes what you're
-- trying to achieve?" question.
insert into purposes (code, name) values
  ('digital-ai', 'Adopt digital technology or AI'),
  ('research-innovation', 'Carry out research and innovation'),
  ('new-product', 'Develop a new product or service'),
  ('export', 'Enter new markets or export overseas'),
  ('grow-sales', 'Grow sales'),
  ('hire-staff', 'Hire staff'),
  ('cash-flow', 'Improve cash flow'),
  ('productivity', 'Improve productivity'),
  ('equipment', 'Invest in equipment'),
  ('premises', 'Move or expand premises'),
  ('energy', 'Reduce energy costs or become more sustainable'),
  ('start-business', 'Start a business'),
  ('train-staff', 'Train staff and develop skills');

-- From the stage list in the One Platform data dictionary.
insert into business_stages (code, name) values
  ('pre-start', 'Pre-start'),
  ('first-year', 'First year of trading'),
  ('trading', 'Trading'),
  ('established', 'Established');

-- From the entity type list in the One Platform data dictionary.
insert into legal_structures (code, name) values
  ('limited-company', 'Limited company'),
  ('sole-trader', 'Sole trader'),
  ('partnership', 'Partnership'),
  ('cic', 'Community interest company'),
  ('charity', 'Charity');
