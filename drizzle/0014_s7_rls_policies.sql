-- Sprint 7, step 1 of tenant isolation in the database (CTO finding S1, ADR-012 → ADR-019).
--
-- Adds the policies and a role for them, and changes nothing for the running app: the app
-- still connects as the table owner, which bypasses row-level security. Step 2 (a separate,
-- reviewed change) points the app at a login in role chairside_app and sets app.org_id in
-- every transaction; until then these policies are proven only by the two-org test
-- (src/services/rls.db.test.ts), which runs every table under this role.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'chairside_app') THEN
    CREATE ROLE chairside_app NOLOGIN NOBYPASSRLS;
  END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO chairside_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO chairside_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO chairside_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO chairside_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO chairside_app;
--> statement-breakpoint
-- The tenant for this transaction (SET LOCAL app.org_id = '<uuid>'); NULL when unset, which matches nothing.
CREATE OR REPLACE FUNCTION public.app_org_id() RETURNS uuid
  LANGUAGE sql STABLE SET search_path = pg_catalog
  AS $fn$ SELECT nullif(current_setting('app.org_id', true), '')::uuid $fn$;
--> statement-breakpoint
-- Sign-in and sign-up look people up before the tenant is known (SET LOCAL app.auth_lookup = 'on').
CREATE OR REPLACE FUNCTION public.app_auth_lookup() RETURNS boolean
  LANGUAGE sql STABLE SET search_path = pg_catalog
  AS $fn$ SELECT coalesce(current_setting('app.auth_lookup', true), '') = 'on' $fn$;
--> statement-breakpoint
-- One rule for every table that carries org_id: you see and write only your clinic's rows.
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables tb ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name AND tb.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public' AND c.column_name = 'org_id'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON public.%I TO chairside_app USING (org_id = public.app_org_id()) WITH CHECK (org_id = public.app_org_id())', t);
  END LOOP;
END
$$;
--> statement-breakpoint
-- The clinic row itself.
DROP POLICY IF EXISTS tenant_isolation ON public.organisations;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON public.organisations TO chairside_app USING (id = public.app_org_id()) WITH CHECK (id = public.app_org_id());
--> statement-breakpoint
-- Auth lookups (sign-in, session check, invite and reset links, sign-up) before the tenant is known.
DROP POLICY IF EXISTS auth_lookup ON public.organisations;
--> statement-breakpoint
CREATE POLICY auth_lookup ON public.organisations TO chairside_app USING (public.app_auth_lookup()) WITH CHECK (public.app_auth_lookup());
--> statement-breakpoint
DROP POLICY IF EXISTS auth_lookup ON public.users;
--> statement-breakpoint
CREATE POLICY auth_lookup ON public.users TO chairside_app USING (public.app_auth_lookup()) WITH CHECK (public.app_auth_lookup());
--> statement-breakpoint
DROP POLICY IF EXISTS auth_lookup ON public.sessions;
--> statement-breakpoint
CREATE POLICY auth_lookup ON public.sessions TO chairside_app USING (public.app_auth_lookup()) WITH CHECK (public.app_auth_lookup());
--> statement-breakpoint
DROP POLICY IF EXISTS auth_lookup ON public.memberships;
--> statement-breakpoint
CREATE POLICY auth_lookup ON public.memberships TO chairside_app USING (public.app_auth_lookup()) WITH CHECK (public.app_auth_lookup());
--> statement-breakpoint
DROP POLICY IF EXISTS auth_lookup ON public.password_setup_tokens;
--> statement-breakpoint
CREATE POLICY auth_lookup ON public.password_setup_tokens TO chairside_app USING (public.app_auth_lookup()) WITH CHECK (public.app_auth_lookup());
--> statement-breakpoint
-- Failed sign-in attempts hold no clinic data (an email and a time); the app role may use them freely.
DROP POLICY IF EXISTS app_all ON public.login_failures;
--> statement-breakpoint
CREATE POLICY app_all ON public.login_failures TO chairside_app USING (true) WITH CHECK (true);
