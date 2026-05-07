# `auth-privy` — Privy OAuth (server + client)

This optional feature wires up Privy authentication on both the backend (Koa
middleware) and the frontend (apps install `@privy-io/react-auth` and use
`<PrivyProvider>` / `usePrivy()`).

## Triggers

The codegen pipeline copies this feature into the generated project when ANY
of these env vars appears in `.blueprint/resource-requirements.json`:

- `VITE_PRIVY_APP_ID` (frontend bundle)
- `NEXT_PUBLIC_PRIVY_APP_ID` (Next.js variant)
- `PRIVY_APP_ID` (server)
- `PRIVY_APP_SECRET` (server)

## Files copied (when applied)

### Backend

| Path | Purpose |
|------|---------|
| `backend/src/config/privy-env.ts`             | Reads `PRIVY_APP_ID` / `PRIVY_APP_SECRET` from env. NEVER hardcoded. |
| `backend/src/privy/client.ts`                 | Lazy-init `PrivyClient` (server SDK). |
| `backend/src/middlewares/privyAuth.ts`        | Token-verification middleware **plus** `requirePrivyAuth(ctx)` guard, `requirePrivyAuthMiddleware` (Koa middleware form), and `resolveOrCreateDbUser(ctx)` upsert helper. |
| `backend/src/app.ts`                          | **Overwrites** base — registers `privyAuthMiddleware`. |
| `backend/src/api/modules/auth/auth.routes.ts` | **Overwrites** base — registers `GET /auth/me` and `POST /auth/verify`. |

### Frontend

| Path | Purpose |
|------|---------|
| `frontend/src/providers/PrivyProvider.tsx`         | Generic wrapper around `<PrivyProvider>`; reads `VITE_PRIVY_APP_ID`. Worker should narrow `loginMethods` per PRD. |
| `frontend/src/providers/AppProviders.tsx`          | **Overwrites** base — mounts `<PrivyAuthProvider>` around `<AuthProvider>` so `main.tsx` is unchanged. |
| `frontend/src/components/auth/LoginModal.tsx`      | **Overwrites** base — `usePrivy().login()` flow, forwards Privy access token via `onLogin?.(privyToken)`. |
| `frontend/src/hooks/usePrivyAuthBridge.ts`         | Optional helper hook — auto-syncs Privy access token into `AuthContext` so `apiClient` picks it up as `Bearer`. Mount once near root. |

## Deps appended (via manifest)

- `frontend`: `@privy-io/react-auth` `^3.22.0`
- `backend`: `@privy-io/node` `^0.16.0`

## Hard rules for workers (READ THIS FIRST)

These four rules eliminate the entire class of "OAuth succeeds but every
authenticated `/api/*` returns 404 / 401" failures observed in earlier
generator runs:

1. **`requirePrivyAuth` is a guard, NOT a middleware.** It returns claims
   and throws 401 internally — but it does NOT call `next()`. Passing it
   directly to `router.get(path, requirePrivyAuth, handler)` stalls the
   chain and Koa surfaces a misleading **404**. To protect a route, use
   the middleware form:
   ```ts
   router.get("/users/me", requirePrivyAuthMiddleware, handler);
   ```
   To assert auth from inside a handler/service:
   ```ts
   const claims = requirePrivyAuth(ctx); // throws 401 if not authed
   ```

2. **Never `User.findOne(...) + ctx.throw(404, "User not found")` for the
   current Privy session.** Use `resolveOrCreateDbUser(ctx)` instead — it
   returns a `User` instance and silently upserts on the first hit. A
   legitimately authenticated client MUST never see a 404 just because
   the row hasn't been created yet:
   ```ts
   async function handler(ctx) {
     const user = await resolveOrCreateDbUser(ctx);
     // use user.id (UUID) for FK queries below
   }
   ```

3. **`POST /auth/verify` is registered by this scaffold by default.** The
   route lives in `backend/src/api/modules/auth/auth.routes.ts` and
   returns `{ user, is_new_user }`. Frontends should call it exactly once
   after the Privy OAuth flow completes (see `LoginModal.tsx`). Do NOT
   delete this route or move its implementation to a controller without
   re-registering it — orphan controllers are the second-most-common
   cause of "404 from a route I implemented".

4. **Both `PRIVY_APP_ID` and `PRIVY_APP_SECRET` must be set in `backend/.env`.**
   The ID must match `VITE_PRIVY_APP_ID` (same Privy app). When
   `PRIVY_APP_ID` is missing, `privyAuthMiddleware` silently fails token
   verification and every authenticated route returns 401 even with a
   valid frontend session.

## What the worker still has to wire up

After these files land, the remaining work is minimal:

1. In `main.tsx` (already provider-neutral): nothing — `AppProviders` was overwritten.
2. In a top-level layout (e.g. `App.tsx`): add `usePrivyAuthBridge();` if you want the token to flow into `AuthContext` automatically.
3. In whichever page hosts `<LoginModal>` (typically a landing/login page): pass `onLogin={async (privyToken) => { useAuth().login(privyToken); await verifyAuth(); }}` so the DB user row exists before the next route navigation.

## When NOT applied

The base scaffold ships with a no-op auth pass-through and an email+password
`LoginModal`. Workers implement an email+password flow against
`/api/auth/login` (filled in based on PRD).
