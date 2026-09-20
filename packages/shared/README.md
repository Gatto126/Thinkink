# Shared contracts

`@thinkink/shared` contains the small public interface between frontend and backend:

- `@thinkink/shared/contracts`: Zod API schemas and inferred TypeScript types.
- `@thinkink/shared/timing`: production timing constants used by both sides.

Both applications consume the same workspace package. Its exports point to TypeScript source, compiled by each application's bundler; no separate package build or registry publication is needed.

Keep authentication, database access, refresh scheduling, provider clients and UI components in their owning application. This package must not depend on either application, React, Node.js or Cloudflare runtime modules. ESLint checks those boundaries.

Run `npm run typecheck --workspace @thinkink/shared` from the repository root to check this package independently.
