-- What the public site may do with reader reactions, and nothing more.
--
-- drpbuildlab.com's edge function (drp_compro: netlify/edge-functions/blog.js) connects as
-- `blog_site`. That connection string sits in a public website's environment, so the role
-- is limited to:
--   blog_likes     read, add and remove likes
--   blog_comments  add a comment (always pending) and read approved comments
-- It cannot read posts, media, drafts, pending comments or the Neon Auth schema, and it
-- cannot approve anything. Approval happens in the CMS, which connects as the owner.
--
-- The role itself is created outside migrations so its password never lands in git. Create it
-- with SQL as the owner, NOT with `neon roles create` or the Console: those roles join
-- neon_superuser, which bypasses row-level security and can read every table.
--   CREATE ROLE blog_site LOGIN PASSWORD '<random>' NOBYPASSRLS CONNECTION LIMIT 20;
-- If it doesn't exist yet, this migration only sets up the row-level security; run it again
-- (or copy the GRANTs) after creating the role.

ALTER TABLE "blog_comments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'blog_site') THEN
    GRANT USAGE ON SCHEMA public TO blog_site;
    GRANT USAGE ON TYPE comment_status TO blog_site;
    GRANT SELECT, INSERT, DELETE ON blog_likes TO blog_site;
    GRANT SELECT (id, slug, name, body, status, created_at) ON blog_comments TO blog_site;
    GRANT INSERT (slug, name, body, lang) ON blog_comments TO blog_site;

    DROP POLICY IF EXISTS blog_site_read ON blog_comments;
    CREATE POLICY blog_site_read ON blog_comments FOR SELECT TO blog_site USING (status = 'approved');
    DROP POLICY IF EXISTS blog_site_insert ON blog_comments;
    CREATE POLICY blog_site_insert ON blog_comments FOR INSERT TO blog_site WITH CHECK (status = 'pending');
  ELSE
    RAISE NOTICE 'Role blog_site does not exist yet; create it, then re-run the GRANTs in 0003_blog_site_role.sql';
  END IF;
END $$;
