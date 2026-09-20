# Publishing the repository

Publishing source code and deploying a running website are separate operations. This scaffold prepares the source repository; it has not created a GitHub remote or deployed cloud services.

## Included locally

- README with current implementation status, setup and repository map.
- Documented workspace ownership, dependency boundaries and database workflow.
- Separate application manifests, pinned dependencies and a root npm lockfile.
- Local checks, production builds, browser tests and a GitHub Actions workflow with read-only repository permissions.
- Dependabot configuration for npm workspaces and GitHub Actions. It takes effect only after GitHub is configured; updates are not automatically merged.
- Contribution guidelines, a pull request template and a security policy identifying the still-unconfigured private reporting channel.
- Git exclusions for credentials, generated output, local state and database backups.

These choices follow [GitHub's repository guidance](https://docs.github.com/en/repositories/creating-and-managing-repositories/best-practices-for-repositories) and [security setup guidance](https://docs.github.com/en/code-security/getting-started/quickstart-for-securing-your-repository).

## Before the first public push

1. Review the complete set of files and any Git history for credentials, local-only information and data. `.gitignore` does not remove files already committed. Use secret scanning, and rotate any exposed credential instead of only deleting the file.
2. Verify a fresh `npm ci`, `npm run check`, `npm run build` and `npm run test:e2e`. Keep real provider API calls out of CI. Once schema work begins, add database rebuild and RLS tests on an isolated database.
3. Confirm the README distinguishes implemented functionality from the roadmap and contains no broken project-specific links or unverified badges.
4. Create the intended remote repository, configure access and push the reviewed source. No remote owner/name or publication permission is assumed by this scaffold.
5. Configure branch protection or a ruleset requiring the CI check on `main`. Configure dependency alerts, secret scanning, push protection, appropriate code scanning and private vulnerability reporting. These are GitHub settings, not features activated by a local Markdown file. Add CODEOWNERS only after actual maintainer accounts are known.

## License decision

The owner has deferred choosing a license. No project LICENSE file is included, and the project must not be described as MIT-licensed or open source until that choice is made. Review and add the chosen license separately. GitHub explains how a repository license communicates reuse permissions in [its licensing documentation](https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/adding-a-license-to-a-repository).

`private: true` in npm manifests prevents accidental npm publication and is independent of GitHub visibility. Third-party dependencies and fonts retain their own licenses.

## Website publication

Cloudflare and hosted Supabase will have separate local, staging and production configuration. Before deploying the application, complete the functional milestones, verify account limits and provider terms, configure secrets outside Git and test deployment plus schema recovery in staging. Repository readiness is not a claim that the current application is production-ready.
