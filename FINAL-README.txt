JABARI ASSISTANT — FINAL AUTOMATION PASS

This package is based on the current GitHub campaigns.ts and contains the final automation migration file.

REPLACE:
  convex/campaigns.ts

Macaly runtime adapters have been removed.
      
WHY:
- Campaign email steps now use the same direct Gmail OAuth path as the main outreach system.
- Campaign emails use the existing Jabari Tech branded email template and sender identity.
- A stale scheduled campaign job cannot execute a step before its nextRunAt.
- Campaign stop/pause state continues to prevent scheduled jobs from executing.

IMPORTANT:
GitHub write access is currently returning HTTP 403 for this connected integration, so I could not commit these changes directly to your repository. Deploy the updated repository after reviewing the environment variables below.

After that, the final verification should be:
1. Build/deploy succeeds.
2. Create a test campaign with an email step.
3. Enroll a test lead.
4. Confirm the scheduled step executes through Gmail.
5. Confirm the campaign event is recorded.
6. Stop an enrollment and confirm its scheduled job no longer sends.

Required environment variables now include GEMINI_API_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, and DATABASE_URL. Netlify Auth may be overridden with NEON_AUTH_URL and OWNER_EMAIL.
