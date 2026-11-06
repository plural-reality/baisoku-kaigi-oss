-- Change default value of is_public from true to false
-- New sessions will be private by default
ALTER TABLE "public"."sessions"
  ALTER COLUMN "is_public" SET DEFAULT false;
