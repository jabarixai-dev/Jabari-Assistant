Jabari Assistant — Gmail/Gemini migration

Replace these files:
- convex/outreach.ts
- convex/agentTools.ts
- convex/gmail.ts
- package.json

Required production Convex environment variables:
- GEMINI_API_KEY
- GOOGLE_CLIENT_ID
- GOOGLE_CLIENT_SECRET
- GMAIL_REFRESH_TOKEN

Sender:
jabari.xai@gmail.com

After replacing:
pnpm install
npx tsc --noEmit

Do not delete convex/macaly.ts or convex/macalyModel.ts until a repository-wide
search confirms there are no remaining imports/references.
