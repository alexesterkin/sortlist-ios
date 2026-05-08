# Sortlist iOS

A React Native (Expo) iOS client for [Sortlist](https://www.sortlist.shop) — an
AI shopping organiser. Save products from anywhere, sort them into collections,
and tap through to buy.

## Stack

- **Expo SDK 54** with `expo-router` (file-based routing)
- **tRPC v11** + **TanStack Query v5** against
  `https://www.sortlist.shop/api/trpc`
- **JWT cookie auth** stored on-device via `expo-secure-store`
- **iOS share extension** via `expo-share-extension` — saves Safari URLs into
  the app via deep link
- **Brand**: Instrument Serif headings, system sans body, coral `#FF5B3A` /
  cream `#FAF8F3` / ink `#1A1A1A`

## Screens

| Route                    | Purpose                                                |
| ------------------------ | ------------------------------------------------------ |
| `/(auth)/login`          | Email + password login, register, Google sign-in       |
| `/(auth)/forgot`         | Password reset link request                            |
| `/(app)/index`           | Sortlists home — 2-column grid with cover + count      |
| `/(app)/sortlist/[id]`   | Sortlist detail — product list, tap opens buy link     |
| `/(app)/add`             | Add product modal — URL scrape + sortlist picker       |
| Share extension          | Catches a shared URL → deep-links into `/(app)/add`    |

## Backend integration

The backend is a single-page web app at sortlist.shop with a tRPC v11 API. The
client uses the procedures (terminology: backend "collections" === UI
"sortlists"):

- `auth.me`, `auth.login`, `auth.register`, `auth.logout`,
  `auth.requestPasswordReset`, `auth.resetPassword`
- `collections.list / create / update / delete`
- `products.list / add / update / delete / setStatus`
- `meta.fetch` — server-side URL → `{ title, imageUrl, price, siteName }` scrape
- `tags.list`

Auth uses an HttpOnly JWT cookie. `lib/trpc.ts` overrides fetch to capture
`Set-Cookie` headers and store them in `expo-secure-store`, then attaches the
cookie to every subsequent tRPC call.

Google sign-in opens `/api/auth/google` in `expo-web-browser` and re-fetches
`auth.me` on return.

## Share extension

When a user taps Share → Sortlist in Safari, `index.share.js` boots
`ShareExtension.tsx`. The extension lets the user confirm/edit the URL, then
calls `openHostApp("add?url=…")` which deep-links into the host app at
`sortlist://add?url=…`. `lib/deep-link.ts` listens and routes to
`/(app)/add`, which auto-fetches metadata and shows the save form.

The extension currently activates on:

- `url` (Safari share)
- `text` (any selected text — we extract the first URL)

## Project structure

```
app/
  _layout.tsx              root, providers, auth-gated routing, deep-link handler
  (auth)/login.tsx         login + register
  (auth)/forgot.tsx        password reset
  (app)/index.tsx          sortlists grid (home)
  (app)/sortlist/[id].tsx  sortlist detail
  (app)/add.tsx            add-product modal
components/ui/             text, button, input, screen primitives
constants/theme.ts         brand colors, fonts, spacing
lib/
  config.ts                base URLs
  session.ts               cookie persistence
  trpc.ts                  tRPC client + cookie-aware fetch
  auth.tsx                 AuthContext, signIn/Out wrappers
  providers.tsx            tRPC + react-query providers
  deep-link.ts             share-extension deep link routing
  types.ts                 domain types
ShareExtension.tsx         iOS share extension UI
index.share.js             share extension RN entry
index.js                   main app entry
```

## Run locally

```bash
npm install
npx expo prebuild --platform ios
npx expo run:ios            # requires Xcode + macOS for native builds
```

The share extension and JWT cookie storage both require a **development
build** — Expo Go does not include native code from `expo-share-extension` or
`expo-secure-store`.

For a TestFlight / device build:

```bash
eas build --profile development --platform ios
```

## Configuration

- Bundle ID: `com.alexesterkin.sortlist`
- URL scheme: `sortlist://`
- Universal links: `applinks:sortlist.shop`, `applinks:www.sortlist.shop`
- Backend base URL: `lib/config.ts`

## Notes

- The backend's `AppRouter` type is not vendored into this repo; tRPC hooks are
  typed permissively and procedure shapes are documented in `lib/types.ts`.
- React Native's `fetch` doesn't fully manage cookies cross-request, so we
  capture `Set-Cookie` manually after each response and re-attach it.
