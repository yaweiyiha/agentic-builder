# M-tier optional scaffold modules

Each subdirectory of `_optional/` is a **selectable feature** that gets copied
into the generated project only when the user's PRD declared a matching
`ResourceRequirement` (e.g. `VITE_PRIVY_APP_ID`).

## How it works

1. `scaffolds/m-tier/_optional/manifest.json` lists every feature with:
   - `triggerEnvKeys` — the env vars whose presence in
     `.blueprint/resource-requirements.json` activates the feature.
     Presence of the declaration is enough; the user does **not** need to
     have filled in the value yet.
   - `extraDeps` — npm packages added to `frontend/package.json` and/or
     `backend/package.json` when the feature is applied.
2. `src/lib/pipeline/scaffold-optional.ts → copyOptionalScaffolds()` is called
   right after `copyScaffold()` (see `src/lib/pipeline/scaffold-copy.ts`).
3. For each triggered feature, every file under
   `_optional/<feature>/<rest-of-path>` is copied to
   `<outputDir>/<rest-of-path>` (i.e. the directory mirrors the final layout).
4. `extraDeps` are merged into the existing `frontend/package.json` and
   `backend/package.json` `dependencies` map (existing entries are preserved).

## Adding a new optional feature

1. Create `_optional/<feature-name>/` with the same directory layout you want
   inside the generated project (e.g.
   `_optional/auth-clerk/backend/src/middlewares/clerkAuth.ts`).
2. Add an entry to `manifest.json` with `triggerEnvKeys` and `extraDeps`.
3. Make sure the **base scaffold** does NOT reference any of the feature's
   files. Optional modules must be self-contained — base code may not
   `import "../privy/client"` because that import would dangle when Privy
   isn't applied.

## Why move things out of the base scaffold

- Cleaner base scaffold for projects that don't need OAuth / payments.
- No leaked default values for secret env vars (`PRIVY_APP_ID`,
  `STRIPE_SECRET_KEY`, etc.) sitting in the base `.env`.
- Worker prompts can stop saying "rewrite the LoginModal stub to use the
  real SDK" — the SDK is already on disk in the right place when the
  feature is applied.

See `CODEGEN_HARDENING_PLAN.md` §4.1 + §4.10 for the design rationale.
