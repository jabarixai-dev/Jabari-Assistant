CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Jabari Assistant application schema.
-- IDs remain TEXT so Convex identifiers can be migrated without forcing
-- an immediate frontend-wide identifier rewrite. JSON-capable fields use JSONB.

CREATE TABLE IF NOT EXISTS anonymous_sessions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  capability TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  remaining_messages INTEGER NOT NULL,
  revoked_at BIGINT
);
CREATE INDEX IF NOT EXISTS anonymous_sessions_capability_idx ON anonymous_sessions(capability);

CREATE TABLE IF NOT EXISTS chat_threads (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  session_id TEXT NOT NULL REFERENCES anonymous_sessions(id),
  title TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  next_order INTEGER,
  active_run_id TEXT
);
CREATE INDEX IF NOT EXISTS chat_threads_session_updated_idx ON chat_threads(session_id, updated_at);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  thread_id TEXT NOT NULL REFERENCES chat_threads(id),
  message_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  message JSONB NOT NULL,
  "order" INTEGER NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS chat_messages_thread_order_idx ON chat_messages(thread_id, "order");
CREATE UNIQUE INDEX IF NOT EXISTS chat_messages_thread_message_idx ON chat_messages(thread_id, message_id);

CREATE TABLE IF NOT EXISTS chat_runs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  thread_id TEXT NOT NULL REFERENCES chat_threads(id),
  user_message_id TEXT NOT NULL,
  assistant_message_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('scheduled','streaming','completed','failed')),
  attempt_id TEXT,
  next_seq INTEGER NOT NULL,
  error TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS chat_runs_thread_message_idx ON chat_runs(thread_id, user_message_id);

CREATE TABLE IF NOT EXISTS chat_stream_chunks (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  run_id TEXT NOT NULL REFERENCES chat_runs(id),
  start_seq INTEGER NOT NULL,
  end_seq INTEGER NOT NULL,
  chunks JSONB NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS chat_stream_chunks_run_start_idx ON chat_stream_chunks(run_id, start_seq);

CREATE TABLE IF NOT EXISTS agent_settings (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  identity TEXT NOT NULL,
  services TEXT NOT NULL,
  tone TEXT NOT NULL,
  qualification TEXT NOT NULL,
  boundaries TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name TEXT NOT NULL,
  website TEXT,
  industry TEXT,
  notes TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS companies_name_idx ON companies(name);
CREATE INDEX IF NOT EXISTS companies_updated_idx ON companies(updated_at);

CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  thread_id TEXT NOT NULL REFERENCES chat_threads(id),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  company TEXT NOT NULL,
  request TEXT NOT NULL,
  budget TEXT NOT NULL,
  timeline TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('new','contacted','qualified','won','lost')),
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS leads_thread_idx ON leads(thread_id);
CREATE INDEX IF NOT EXISTS leads_status_updated_idx ON leads(status, updated_at);

CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  company TEXT NOT NULL,
  phone TEXT,
  source TEXT NOT NULL,
  lead_id TEXT REFERENCES leads(id),
  company_id TEXT REFERENCES companies(id),
  job_title TEXT,
  website TEXT,
  notes TEXT,
  tags JSONB,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS contacts_email_idx ON contacts(email);
CREATE INDEX IF NOT EXISTS contacts_updated_idx ON contacts(updated_at);

CREATE TABLE IF NOT EXISTS crm_activities (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  contact_id TEXT REFERENCES contacts(id),
  lead_id TEXT REFERENCES leads(id),
  type TEXT NOT NULL CHECK (type IN ('lead_created','status_changed','email_sent','note','appointment','workflow')),
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS crm_activities_contact_created_idx ON crm_activities(contact_id, created_at);
CREATE INDEX IF NOT EXISTS crm_activities_lead_created_idx ON crm_activities(lead_id, created_at);

CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  contact_id TEXT REFERENCES contacts(id),
  lead_id TEXT REFERENCES leads(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  start_at BIGINT NOT NULL,
  end_at BIGINT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('scheduled','confirmed','completed','cancelled')),
  location TEXT NOT NULL,
  meeting_url TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS appointments_start_idx ON appointments(start_at);
CREATE INDEX IF NOT EXISTS appointments_status_start_idx ON appointments(status, start_at);

CREATE TABLE IF NOT EXISTS opportunities (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  lead_id TEXT NOT NULL REFERENCES leads(id),
  contact_id TEXT REFERENCES contacts(id),
  company_id TEXT REFERENCES companies(id),
  name TEXT NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN ('new','contacted','qualified','proposal','negotiation','won','lost')),
  value NUMERIC(18,2) NOT NULL,
  probability NUMERIC(5,2) NOT NULL,
  expected_close_at BIGINT,
  owner TEXT NOT NULL,
  notes TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS opportunities_stage_updated_idx ON opportunities(stage, updated_at);
CREATE INDEX IF NOT EXISTS opportunities_lead_idx ON opportunities(lead_id);
CREATE INDEX IF NOT EXISTS opportunities_expected_close_idx ON opportunities(expected_close_at);

CREATE TABLE IF NOT EXISTS workflow_tasks (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  lead_id TEXT NOT NULL REFERENCES leads(id),
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open','done')),
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS workflow_tasks_lead_created_idx ON workflow_tasks(lead_id, created_at);
CREATE INDEX IF NOT EXISTS workflow_tasks_status_updated_idx ON workflow_tasks(status, updated_at);

CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name TEXT NOT NULL,
  trigger TEXT NOT NULL CHECK (trigger IN ('lead_created','stage_changed','appointment_booked','invoice_paid','form_submitted','review_completed')),
  condition TEXT NOT NULL CHECK (condition IN ('any','new','contacted','qualified','won','lost')),
  action TEXT NOT NULL CHECK (action IN ('create_task','add_note','create_email_draft')),
  action_value TEXT NOT NULL,
  steps JSONB,
  goal TEXT,
  enabled BOOLEAN NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS workflows_updated_idx ON workflows(updated_at);

CREATE TABLE IF NOT EXISTS workflow_executions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  workflow_id TEXT NOT NULL REFERENCES workflows(id),
  lead_id TEXT NOT NULL REFERENCES leads(id),
  current_step INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','completed','stopped','failed')),
  scheduled_at BIGINT,
  started_at BIGINT NOT NULL,
  completed_at BIGINT,
  last_error TEXT,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS workflow_executions_workflow_lead_idx ON workflow_executions(workflow_id, lead_id);
CREATE INDEX IF NOT EXISTS workflow_executions_status_scheduled_idx ON workflow_executions(status, scheduled_at);

CREATE TABLE IF NOT EXISTS outreach_drafts (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  lead_id TEXT NOT NULL REFERENCES leads(id),
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','approved','sent','cancelled')),
  sent_at BIGINT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS outreach_drafts_lead_updated_idx ON outreach_drafts(lead_id, updated_at);
CREATE INDEX IF NOT EXISTS outreach_drafts_status_updated_idx ON outreach_drafts(status, updated_at);

CREATE TABLE IF NOT EXISTS prospects (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  query TEXT NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  snippet TEXT NOT NULL,
  source TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('research','saved','discarded')),
  target_service TEXT NOT NULL,
  target_niche TEXT NOT NULL,
  target_location TEXT NOT NULL,
  target_condition TEXT NOT NULL,
  avoid_terms TEXT NOT NULL,
  qualification_status TEXT NOT NULL CHECK (qualification_status IN ('unknown','qualified','review','rejected')),
  qualification_reason TEXT NOT NULL,
  website_status TEXT NOT NULL CHECK (website_status IN ('unknown','no_website','weak_or_broken','has_website','social_only')),
  contact_email TEXT,
  contact_phone TEXT,
  contact_name TEXT,
  fit_reason TEXT,
  pain_point TEXT,
  outreach_subject TEXT,
  outreach_body TEXT,
  analysis_status TEXT NOT NULL CHECK (analysis_status IN ('pending','ready','complete','failed')),
  contact_status TEXT NOT NULL CHECK (contact_status IN ('not_checked','verified','not_found','no_contact','needs_review')),
  contact_source TEXT,
  contact_evidence TEXT,
  contact_checked_at BIGINT,
  website_evidence JSONB,
  website_found BOOLEAN,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS prospects_status_updated_idx ON prospects(status, updated_at);
CREATE INDEX IF NOT EXISTS prospects_url_idx ON prospects(url);
CREATE INDEX IF NOT EXISTS prospects_qualification_updated_idx ON prospects(qualification_status, updated_at);

CREATE TABLE IF NOT EXISTS prospect_outreach_drafts (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  prospect_id TEXT NOT NULL REFERENCES prospects(id),
  recipient_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','approved','sent','cancelled')),
  approved_at BIGINT,
  scheduled_send_at BIGINT,
  delivery_status TEXT CHECK (delivery_status IN ('unknown','undeliverable')),
  delivery_error TEXT,
  last_delivery_check_at BIGINT,
  sent_at BIGINT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS prospect_outreach_prospect_updated_idx ON prospect_outreach_drafts(prospect_id, updated_at);
CREATE INDEX IF NOT EXISTS prospect_outreach_status_updated_idx ON prospect_outreach_drafts(status, updated_at);

CREATE TABLE IF NOT EXISTS outreach_events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  kind TEXT NOT NULL,
  lead_id TEXT REFERENCES leads(id),
  prospect_id TEXT REFERENCES prospects(id),
  draft_id TEXT,
  metadata JSONB,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS outreach_events_created_idx ON outreach_events(created_at);

CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','active','paused')),
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS campaigns_updated_idx ON campaigns(updated_at);

CREATE TABLE IF NOT EXISTS campaign_steps (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  step_order INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('email','create_task','add_note','update_stage')),
  delay_minutes INTEGER NOT NULL,
  subject TEXT,
  body TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS campaign_steps_campaign_order_idx ON campaign_steps(campaign_id, step_order);

CREATE TABLE IF NOT EXISTS campaign_enrollments (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  lead_id TEXT NOT NULL REFERENCES leads(id),
  status TEXT NOT NULL CHECK (status IN ('active','completed','stopped')),
  current_step INTEGER NOT NULL,
  next_run_at BIGINT,
  enrolled_at BIGINT NOT NULL,
  completed_at BIGINT,
  stopped_at BIGINT
);
CREATE INDEX IF NOT EXISTS campaign_enrollments_campaign_status_idx ON campaign_enrollments(campaign_id, status);
CREATE INDEX IF NOT EXISTS campaign_enrollments_lead_campaign_idx ON campaign_enrollments(lead_id, campaign_id);

CREATE TABLE IF NOT EXISTS campaign_events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  enrollment_id TEXT NOT NULL REFERENCES campaign_enrollments(id),
  lead_id TEXT NOT NULL REFERENCES leads(id),
  step_index INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('enrolled','step_scheduled','email_sent','task_created','note_added','stage_updated','completed','stopped','failed')),
  detail TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS campaign_events_campaign_created_idx ON campaign_events(campaign_id, created_at);
CREATE INDEX IF NOT EXISTS campaign_events_enrollment_created_idx ON campaign_events(enrollment_id, created_at);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  price NUMERIC(18,2) NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','archived')),
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS products_status_updated_idx ON products(status, updated_at);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  number TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  contact_id TEXT REFERENCES contacts(id),
  lead_id TEXT REFERENCES leads(id),
  opportunity_id TEXT REFERENCES opportunities(id),
  status TEXT NOT NULL CHECK (status IN ('draft','sent','paid','void')),
  currency TEXT NOT NULL,
  subtotal NUMERIC(18,2) NOT NULL,
  total NUMERIC(18,2) NOT NULL,
  due_at BIGINT,
  paid_at BIGINT,
  notes TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS invoices_status_updated_idx ON invoices(status, updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS invoices_number_idx ON invoices(number);

CREATE TABLE IF NOT EXISTS invoice_items (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  invoice_id TEXT NOT NULL REFERENCES invoices(id),
  product_id TEXT REFERENCES products(id),
  description TEXT NOT NULL,
  quantity NUMERIC(18,4) NOT NULL,
  unit_price NUMERIC(18,2) NOT NULL,
  amount NUMERIC(18,2) NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS invoice_items_invoice_idx ON invoice_items(invoice_id);

CREATE TABLE IF NOT EXISTS paystack_payments (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  invoice_id TEXT NOT NULL REFERENCES invoices(id),
  reference TEXT NOT NULL,
  amount NUMERIC(18,2) NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('initialized','success','failed','abandoned','pending','reversed')),
  access_code TEXT,
  authorization_url TEXT,
  transaction_id BIGINT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS paystack_payments_reference_idx ON paystack_payments(reference);
CREATE INDEX IF NOT EXISTS paystack_payments_invoice_created_idx ON paystack_payments(invoice_id, created_at);

CREATE TABLE IF NOT EXISTS review_requests (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  contact_id TEXT REFERENCES contacts(id),
  lead_id TEXT REFERENCES leads(id),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','sent','completed','cancelled')),
  rating INTEGER CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  feedback TEXT,
  sent_at BIGINT,
  completed_at BIGINT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS review_requests_status_created_idx ON review_requests(status, created_at);
CREATE INDEX IF NOT EXISTS review_requests_lead_idx ON review_requests(lead_id);
CREATE INDEX IF NOT EXISTS review_requests_contact_idx ON review_requests(contact_id);

CREATE TABLE IF NOT EXISTS booking_types (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL,
  location TEXT NOT NULL,
  meeting_url TEXT,
  timezone TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','published','paused')),
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS booking_types_updated_idx ON booking_types(updated_at);

CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  booking_type_id TEXT NOT NULL REFERENCES booking_types(id),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  company TEXT,
  notes TEXT,
  start_at BIGINT NOT NULL,
  end_at BIGINT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('scheduled','confirmed','cancelled','completed')),
  lead_id TEXT REFERENCES leads(id),
  contact_id TEXT REFERENCES contacts(id),
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS bookings_start_idx ON bookings(start_at);
CREATE INDEX IF NOT EXISTS bookings_type_start_idx ON bookings(booking_type_id, start_at);

CREATE TABLE IF NOT EXISTS lead_forms (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','published','paused')),
  fields JSONB NOT NULL,
  source TEXT NOT NULL,
  campaign_id TEXT REFERENCES campaigns(id),
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS lead_forms_updated_idx ON lead_forms(updated_at);

CREATE TABLE IF NOT EXISTS form_submissions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  form_id TEXT NOT NULL REFERENCES lead_forms(id),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  company TEXT NOT NULL,
  message TEXT NOT NULL,
  raw_fields JSONB NOT NULL,
  lead_id TEXT REFERENCES leads(id),
  status TEXT NOT NULL CHECK (status IN ('new','processed','spam')),
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS form_submissions_form_created_idx ON form_submissions(form_id, created_at);
CREATE INDEX IF NOT EXISTS form_submissions_status_created_idx ON form_submissions(status, created_at);

CREATE TABLE IF NOT EXISTS landing_pages (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','published','paused')),
  headline TEXT NOT NULL,
  subheadline TEXT NOT NULL,
  cta_text TEXT NOT NULL,
  theme TEXT NOT NULL,
  form_id TEXT REFERENCES lead_forms(id),
  booking_type_id TEXT REFERENCES booking_types(id),
  sections JSONB NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS landing_pages_slug_idx ON landing_pages(slug);
CREATE INDEX IF NOT EXISTS landing_pages_updated_idx ON landing_pages(updated_at);

CREATE TABLE IF NOT EXISTS agent_actions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  lead_id TEXT NOT NULL REFERENCES leads(id),
  type TEXT NOT NULL CHECK (type IN ('create_task','create_email_draft','update_stage','add_note')),
  payload JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','approved','rejected','executed','failed')),
  rationale TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  executed_at BIGINT,
  error TEXT
);
CREATE INDEX IF NOT EXISTS agent_actions_lead_created_idx ON agent_actions(lead_id, created_at);
CREATE INDEX IF NOT EXISTS agent_actions_status_created_idx ON agent_actions(status, created_at);
