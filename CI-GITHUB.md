# GitHub Actions CI

This project includes `.github/workflows/ci.yml`.

GitHub will automatically run the following checks on every push to `main`/`master` and on every pull request:

1. Install npm dependencies
2. Run the TypeScript check
3. Run the Vitest test suite
4. Run the production Vite build

No application secrets are required by the CI workflow itself. Runtime secrets such as Gemini, Paystack, Convex, Neon, and Gmail credentials should remain in the repository's GitHub/Netlify/Convex secret configuration and should not be committed to source control.

Because the repository currently does not include a `package-lock.json`, CI intentionally uses `npm install` rather than `npm ci`.
