# CommandLayer Repository Instructions

This repository is part of the CommandLayer protocol stack.

## Repo role

`commandlayer/commandlayer-org` is the public website, documentation, registry, and demo surface for CommandLayer.

This repository owns:

- public website pages
- protocol documentation presentation
- registry and claim flows where present
- verifier/demo pages where hosted on the site
- public examples and onboarding copy
- integration documentation
- site metadata and public trust messaging

This repository does not own CLAS schema truth, core cryptographic semantics, runtime execution policy, SDK internals, MCP transport behavior, governance policy, or commercial runtime internals.

## Hard rules

- Do not guess.
- Do not publish packages.
- Do not merge pull requests.
- Do not document unsupported behavior as supported.
- Do not claim package publication status unless verified from package metadata and registry evidence.
- Do not claim verification guarantees that the verifier implementation does not provide.
- Do not confuse sample/demo data with live verification output.
- Do not redefine receipt semantics in website copy.
- Do not introduce placeholders, TODOs, broken links, skipped tests, or hardcoded secrets.
- Do not change public protocol claims without checking the CLAS stack contract.

## Protocol requirements

Website and documentation behavior MUST align with the canonical stack contract in `commandlayer/clas`:

- canonicalization ID: `json.sorted_keys.v1`
- hash algorithm: SHA-256
- signature algorithm: Ed25519
- verifier responses preserve `ok`, `status`, `checks`, and `errors` semantics
- `VERIFIED` means schema, hash, signature, and signer checks passed
- invalid or demo-only flows must be labeled accurately

## Before editing

1. Inspect `README.md`, public pages, docs, API routes, registry files, examples, tests, config, and deployment files where present.
2. Identify whether the change affects public claims, docs, verifier/demo behavior, registry data, API behavior, SEO metadata, or deployment.
3. Compare protocol claims against the CLAS stack contract and implementation repos.
4. Make the smallest safe change.
5. Run build, test, typecheck, lint, and site checks if available.
6. Report changed files, commands run, results, and remaining risks.

## Documentation rules

- Public docs MUST distinguish specification, implementation, demo, sample, and planned behavior.
- Public docs MUST NOT say `coming soon`, `TBD`, or similar placeholders.
- Public docs MUST link to canonical repos when making protocol claims.
- Package install commands MUST match actual package names and publication status.
- Verifier demos MUST clearly label sample receipts and tampered receipts.
- Public registry entries MUST not imply verification or endorsement beyond implemented behavior.
- Marketing copy MUST not override protocol truth.

## Site/API rules

- API routes MUST validate inputs.
- API routes MUST handle async errors explicitly.
- Public endpoints SHOULD be rate-limited where appropriate.
- Secrets MUST not be exposed in client-side code or generated output.
- Demo pages MUST not rely on hidden hardcoded production keys as the only verification path.
- SEO changes MUST not create false protocol claims.

## Test requirements

Changes to docs, verifier pages, API routes, registry pages, or demos SHOULD include checks for:

- build success
- broken links
- route availability
- sample vs live labeling
- verifier status accuracy
- API invalid input handling
- no exposed secrets
- no unsupported package claims

## Review focus

When reviewing changes, focus on:

- unsupported claims
- schema or verification drift
- false VERIFIED language
- sample/live ambiguity
- broken documentation links
- stale package install instructions
- hardcoded secrets or keys
- API input validation gaps
- public pages getting ahead of implementation
- inconsistencies with governance, CLAS, runtime-core, runtime, agent-sdk, verifyagent, or mcp-server

## Output format

For every task, report:

1. Summary
2. Files changed
3. Checks run
4. Results
5. Risks remaining
6. Follow-up recommendations
