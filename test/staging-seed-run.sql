-- Local proof runner. The hosted steps set these values in the SQL editor instead.
select set_config('connectify.staging_project', 'connectify-staging', false);
select set_config('connectify.project_ref', 'localstagingref1', false);
select set_config('connectify.staging_staff_email', 'staging-staff@example.com', false);
select set_config('connectify.staging_viewer_email', 'staging-viewer@example.com', false);
\ir ../supabase/staging/07-synthetic-seed.sql
