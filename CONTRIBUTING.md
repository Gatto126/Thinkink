# Contributing

Thinkink is in the foundation milestone. Read the [implementation plan](docs/implementation-plan.md) and [architecture](docs/architecture.md) before changing product scope or boundaries.

Use the Node version in `.node-version`. Run `npm ci` at the repository root, then `npm run dev`. Keep changes focused and explain the problem and resulting behavior in your pull request. Write source code, documentation, tests and commit messages in English.

Before submitting:

```sh
npm run check
npm run build
npm run test:e2e
```

The browser tests need Google Chrome locally. CI installs Playwright Chromium. Stop any manual preview using port 4173 before running them. Real news/AI API calls must not be part of automated tests.

Add a dependency to its owning workspace, for example `npm install package-name --save-exact --workspace @thinkink/frontend`. Commit the owning manifest and root lockfile together. Keep shared code limited to public contracts and constants; ESLint enforces application import boundaries.

Database schema, grants and policies belong in `supabase/migrations/`, with relevant SQL tests in `supabase/tests/`. Keep Docker data, credentials, generated files and production dumps out of Git. Do not rewrite migrations already used by a shared environment.

Review dependency updates through pull requests and keep discussions respectful and specific. Report security concerns using [the security policy](SECURITY.md). License selection is pending and must be resolved before representing this project as open source or establishing a contribution licensing policy.
