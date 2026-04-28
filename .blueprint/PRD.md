# Capacitr v4.0.2 — Core Application PRD

> **For code generation. Every line is load-bearing. No decorative prose.**

---

## 1. Product & Architecture

**What it is**: A market discovery terminal. User provides a signal (news URL, tweet, topic, question, opinion); system returns ranked markets across three venues — Polymarket (predictions), HyperLiquid (perps), Deribit (options).

**Two loops**:
- **On-demand** (Markets page): user clicks SCAN → 11-step pipeline → ranked markets in ~10s.
- **Passive** (Feed page): background agent runs per user every ~3h → personalized news + attached markets.

**Trade execution**: never in-app. All CTAs deep-link to the venue.

**Stack requirements**: Next.js-compatible hosting, Postgres, Redis (BullMQ queue + short caches), OpenAI, Privy, X API, Jina Reader, Polymarket/HyperLiquid/Deribit public APIs, optional Quotient.

---

## 2. Global Design System

| Token | Value / usage |
|---|---|
| Brand orange | CTAs, headline accents, selected states, external arrows, error badges |
| Terminal green bright | Active nav text, entity chips, pipeline log text |
| Terminal green deep | Nav panel, terminal log panel, dark card bg |
| Cream | Main content bg, light card bg |
| Font | Monospace throughout |
| Casing | Uppercase everywhere (exception: Privy modal, inherits sentence case) |
| Shadows | None — use borders + filled bg |
| Responsive | 375px+ no horizontal scroll; sidebar → hamburger <768px; 4-col → 2-col grids |
| Accessibility | Keyboard accessible; visible focus; color never sole signal; icon-only buttons have aria-labels; live regions (log panels) announce to screen readers |
| Universal footer | Every page with market data: *"Capacitr provides market information for reference only. Not investment advice."* |

### App Chrome (authenticated pages)
- Top bar: orange, Capacitr logo (left) + version (center) + avatar dropdown with Profile/Logout (right)
- Left sidebar: `KINETIC_OS V4.0.2` label; **NAVIGATION** group (FEED, MARKETS, ALERTS, PROFILE); **SYSTEM** group (SETTINGS). Active item: bright-green text + trailing dot.
- Bottom status: `CAPACITR // MARKET DISCOVERY · SYS.STATUS: OPERATIONAL`
- Content column: cream bg, max-width ~960px centered, full-width on mobile.

### Unauthenticated Chrome
Landing + Privy modal only. No app chrome. Full-bleed cream background.

---

## 3. Data Model

| Table | Purpose | Key fields |
|---|---|---|
| `users` | Identity | id, privy_id, display_name, avatar_url, twitter_username, twitter_user_id, farcaster_fid, farcaster_username, style_tag, style_computed_at, created_at, updated_at |
| `user_interests` | 3–10 clusters per user | (user_id, cluster) PK, selected_at |
| `style_assessment_answers` | Raw quiz answers | id, user_id, question_id, option_id, taken_at, retake |
| `trending_topics` | News stories from Feed agent, shared across users | id, source, cluster, title, summary, source_url, keywords[], entities[], fetched_at |
| `cached_markets` | Market snapshots | id, venue, market_type, external_id, title, metadata(JSON), cached_at |
| `topic_market_matches` | Story × market join | topic_id, market_id, match_score, match_reason, matched_at |
| `feed_items` | Per-user ordered feed | id, user_id, topic_id, position, created_at |
| `feed_aggregation_runs` | One per agent run | id, user_id, status, step_log(JSON), started_at, completed_at, story_count |

### Enums

- **Interest clusters (10)**: `POLITICS`, `SPORTS`, `CRYPTO`, `MUSIC`, `FOOD`, `AI`, `POP_CULTURE`, `TECH`, `ENVIRONMENT`, `FINANCE`
- **Style tags (6)**: `STEADY`, `STRATEGIST`, `OBSERVER`, `BOLD`, `CONTRARIAN`, `DEGEN`
- **Venues**: `polymarket`, `hyperliquid`, `deribit`
- **Market types**: `prediction`, `perp`, `option`

### Rules
- User must have ≥3 interests at all times.
- `style_tag` nullable — users can exist between interests save and style submit.
- **Markets scans are NOT persisted.** No scans table. Each scan is ephemeral.

---

## 4. Auth & Onboarding

### 4.1 Routes & Flow

```
/  → Privy modal → /api/auth/verify → route:
   new user OR <3 interests → /onboarding/interests
   has interests, no style_tag → /onboarding/style
   complete → /feed
```

### 4.2 Landing Page — `/`

| Aspect | Spec |
|---|---|
| Access | Public. If Privy session exists → redirect to `/feed` on mount. |
| Layout | Full-bleed cream, no app chrome. Metadata block top-left; decorative terminal icon top-right; centered hero: logo square → `CAPACITR` wordmark → `MARKET DISCOVERY TERMINAL` subtitle → italic tagline → description → orange SIGN UP button → footer microcopy. |
| Metadata block | 3 exact lines: `SYSTEM: CAPACITR_V4.0.2` / `LOCATION: 37.7749° N, 122.4194° W` / `STATUS: AWAITING OPERATOR AUTHENTICATION` |
| Tagline (italic) | *"Every headline has a market, and every opinion deserves a position."* |
| Description | `Turn chatter into tradeable exposure. Prediction markets, perpetuals, and options — all matched to the news you care about.` |
| Footer | `KINETIC_OS // SYS_INIT_SEQUENCE_READY` |
| SIGN UP click | Opens Privy modal |

### 4.3 Privy Modal

| Aspect | Spec |
|---|---|
| Providers | **Exactly** Twitter + Farcaster. No email/SMS/passkey/wallet. |
| Card | Centered white modal, dimmed backdrop, close X top-right, Capacitr logo, `LOG IN OR SIGN UP` title, 2 provider buttons, `Protected by Privy` footer. |
| RECENT badge | On whichever provider the user last used. |
| Success | `POST /api/auth/verify` with Privy JWT → server upserts user, returns `{user, is_new_user}`. |
| OAuth failure / cancel | Modal stays open, inline error `AUTHENTICATION FAILED — RETRY`. |
| Close X / backdrop | Dismiss, return to landing, no error. |

### 4.4 Onboarding — Interests — `/onboarding/interests`

| Aspect | Spec |
|---|---|
| Access | Auth-only. If user has ≥3 interests saved → redirect forward (/onboarding/style or /feed). |
| Layout | Title `SELECT INTERESTS` + `PICK AT LEAST 3 INTERESTS TO CALIBRATE YOUR FEED.` + 4-col grid of 10 cards + counter row + full-width CONTINUE button. |
| Card content | Icon top-left, 2-digit number (01–10) top-right (replaced by `SELECTED` label when selected), cluster name bold uppercase. |
| Selected state | Orange border + `SELECTED` label. |
| Counter | `MINIMUM 3 CLUSTERS REQUIRED. CURRENT: {n} CLUSTERS ACTIVE.` |
| CONTINUE | Disabled when n<3; on click `PUT /api/users/me/interests` → route to `/onboarding/style`. |
| BACK | None. Onboarding is forward-only. |

### 4.5 Onboarding — Style Assessment — `/onboarding/style`

| Aspect | Spec |
|---|---|
| Access | Auth-only. If user has style_tag saved (non-retake context) → redirect to `/feed`. |
| Structure | Exactly 6 questions, one at a time. Screen: progress `QUESTION {i} / 6` + thin bar, question text, 3–4 answer buttons, BACK + NEXT. |
| NEXT | Disabled until an option selected. On Q6 submit → `POST /api/users/me/style-assessment`. |
| BACK | Disabled on Q1; preserves prior selection on return. |
| Retake | Entered with `?retake=true`; new tag overwrites previous. |

**Scoring: two axes** (risk [−11..+11], style [−11..+11]), summed from per-answer values:

| Q ID | Axis | Question | Options (id: axis value) |
|---|---|---|---|
| q_risk_comfort | Risk | How would you feel about a position that could 2x or go to zero? | a: "I'd avoid it. Not for me." (−2) / b: "I'd watch from the sidelines." (−1) / c: "Small position, fine." (+1) / d: "Let it ride." (+3) |
| q_recent_loss | Risk | You just lost 30% on a trade. What's next? | a: "Stop trading for a while." (−3) / b: "Cut back and reassess." (−1) / c: "Keep going, adjusted." (+1) / d: "Size up to recover." (+2) |
| q_decision_process | Style | Before taking a position, you usually… | a: "Read multiple sources, build a thesis." (−3) / b: "Check the chart and key data points." (−1) / c: "Go with a strong hunch if the setup feels right." (+1) / d: "React to the moment. Vibes." (+3) |
| q_news_reaction | Style | Breaking news drops. You… | a: "Wait 24 hours to see how it develops." (−2) / b: "Read a few takes before acting." (0) / c: "Move quickly — first mover advantage." (+2) |
| q_portfolio_shape | Both | Which describes your positions best? | a: "A few convictions, small sizes, long-held." (risk −2, style −1) / b: "Diversified, rebalanced regularly." (risk 0, style −1) / c: "A few big bets, concentrated." (risk +2, style +1) / d: "Lots of trades, short timeframes." (risk +1, style +2) |
| q_advice | Style | A friend asks for a take on a trade. You… | a: "Walk through the data and tradeoffs." (−2) / b: "Share your view but hedge it." (0) / c: "Tell them exactly what you'd do." (+2) |

**Bucket mapping**:
- `risk_bucket` = low if total ≤ −2; high if ≥ +3; else mid.
- `style_bucket` = analytical if total ≤ −2; intuitive if ≥ +3; else balanced.

**Tag lookup** (deterministic — same answers → same tag):

| Risk / Style | Analytical | Balanced | Intuitive |
|---|---|---|---|
| Low | STRATEGIST | STEADY | OBSERVER |
| Mid | STEADY | STEADY | OBSERVER |
| High | CONTRARIAN | BOLD | DEGEN |

### 4.6 Onboarding — Style Result — `/onboarding/style/result`

| Aspect | Spec |
|---|---|
| Access | Auth-only. Requires `style_tag` on user; else redirect to `/onboarding/style`. |
| Layout | Centered card: icon, tag name (bold uppercase), tagline (sentence case), description, `ENTER TERMINAL` CTA. |
| CTA | Routes to `/feed`. |

**Tag content table** (source of truth):

| Tag | Icon (Lucide) | Tagline | Description |
|---|---|---|---|
| STEADY | scale | Smart about where you put your money. | You stay engaged without overcommitting. You trust your gut but keep things measured. Most people wish they had your discipline. |
| STRATEGIST | clipboard-list | Every position backed by a thesis. | You don't move without doing the work. When you take a position, it's because the data lined up. You'd rather be right slow than fast. |
| OBSERVER | eye | Watching more than you trade. | You pay attention. You see what's coming before most. You take positions rarely, but when you do, it's because you've seen enough. |
| BOLD | flame | Conviction-sized and unafraid. | You don't scatter across a dozen bets. You find one or two ideas with real upside and you press them. High trust in your read, high tolerance for the ride. |
| CONTRARIAN | swords | Where others zig, you zag. | You're most comfortable when the crowd disagrees. You read the data, run the counterargument, and take the other side. Patience is your edge. |
| DEGEN | zap | Fast in, fast out, always moving. | You thrive on velocity. The setup either works in minutes or it's on to the next. Not every trade lands, but you've made peace with that. |

### 4.7 API Contracts (Auth)

| Endpoint | Purpose | Body | Returns |
|---|---|---|---|
| `POST /api/auth/verify` | Verify Privy JWT, upsert user | (Privy JWT in header) | `{user, is_new_user}` |
| `PUT /api/users/me/interests` | Save interest selection | `{clusters: string[]}` | `{success, feed_reaggregation_enqueued}` |
| `POST /api/users/me/style-assessment` | Submit 6 answers | `{answers: [{question_id, option_id}]}` | `{style_tag, tagline, description, icon_key}` |
| `GET /api/users/me` | Get current user | — | `{user, interests, style}` |

---

## 5. Feed Page — `/feed`

**What**: Default authenticated landing. Personalized list of composite cards (news story + 0..N market children). Served from pre-computed cache; agent runs in background every ~3h.

### 5.1 Page States

| State | Trigger | Visible elements |
|---|---|---|
| Loading | Initial GET /api/feed in flight | Status strip `AGENT · LOADING...` + 5 skeleton cards |
| Aggregating | No cache yet OR user clicked REFRESH | Status strip `AGENT · AGGREGATING FEED...` (REFRESH hidden); main area = live agent log panel (§5.3) |
| Populated | Cache exists | Status strip + infinite-scroll card list |
| Empty | Agent completed with 0 stories | Centered `> NO STORIES MATCHED YOUR INTERESTS` + `OPEN SETTINGS` and `REFRESH` buttons |
| Error | Fatal agent failure | Red-dot status strip + centered `● FEED AGENT UNREACHABLE` + `RETRY` |
| Offline | `navigator.onLine === false` | Cached feed with toast `YOU ARE OFFLINE — SHOWING CACHED FEED`; else `● OFFLINE · CONNECTION REQUIRED` + `RETRY` |

### 5.2 Status Strip (sticky top)

- **Populated**: `[💬] AGENT [●] CACHED {n}H AGO · {m} STORIES    [⟳ REFRESH]`
- **Aggregating**: `[💬] AGENT [● pulsing] AGGREGATING FEED...` (REFRESH hidden)
- `{n}H AGO` = rounded from oldest story's `fetched_at`; show `{k}M AGO` if under 1h.
- `{m} STORIES` = total materialized for user, not rendered count.

### 5.3 Agent Log Panel (shown in Aggregating state)

Line sequence, appended live as agent runs:

```
FEED_AGGREGATOR_V1
01 > INITIALIZING FEED AGGREGATOR...
02 > SCANNING HACKER NEWS TOP STORIES...
03 > FETCHING GOOGLE NEWS RSS...
04 > SCRAPING ARTICLE CONTENT...
05 > RUNNING LLM ENTITY EXTRACTION...
06 > MATCHING PREDICTION MARKETS...
07 > QUERYING HYPERLIQUID PERPS...
08 > SCANNING DERIBIT OPTIONS...
09 > DEDUPLICATING & RANKING...
10 > COMPILING FEED...
```

- Active line ends with blinking cursor / `...`
- On completion, `...` → `[{result}]`, e.g., `[42 STORIES]`
- Non-fatal failure → line turns red with `[ERROR]`; subsequent steps continue
- On full completion, page auto-transitions to Populated within 1s

### 5.4 Feed Card Anatomy

**News header** (cream block, top of card):
- Source tag chip top-left (e.g., `GOOGLE NEWS`, `HACKER NEWS`, `BLOOMBERG`)
- Relative timestamp top-right (`40M AGO`, `5H AGO`)
- Bold uppercase title (max 3 lines, ellipsis)
- 2–3 sentence uppercase summary
- `OPEN ↗` link to source article

**Market children** (stacked under header, forming one visual unit). Order: Predictions → Perps → Options. Within each, sort by relevance desc.

| Card type | Fields rendered |
|---|---|
| **Prediction (Polymarket)** | Type chip `PREDICTION MARKET` · right: `VOL $XXk` · bold question · `YES {n}¢` / `NO {n}¢` two-button row (both clickable → Polymarket URL) · `VIEW ON POLYMARKET ↗` footer |
| **Perp (HyperLiquid)** | Type chip `PERPETUAL` · right: `VOL $XXm` · symbol (e.g., `BTC-PERP`) · 24h change with ▲/▼ and green/red color · large mark price · line `FUNDING {rate}% · OI {n} · VOL 24H ${n}` · `VIEW ON HYPERLIQUID ↗` footer |
| **Option (Deribit)** | Type chip `OPTION` · right: `VOL $XXm` · instrument name (e.g., `BTC-28MAR25-80000-C`) · line `MARK ${n} · IV {n}%` · line `Δ {n} · Θ {n} · V {n} · OI {n}` · `VIEW ON DERIBIT ↗` footer |

### 5.5 Frontend Rules

| ID | Rule |
|---|---|
| FR-F-01 | `/feed` is auth-only. |
| FR-F-02 | Stories with **zero matched markets across all 3 categories are excluded** from the feed entirely. |
| FR-F-03 | Feed is served from cache; never generated synchronously on page load. |
| FR-F-04 | Market prices on cards are ≤10 min old relative to page load time. |
| FR-F-05 | Infinite scroll: **10 cards per page**; fetch next when bottom card within ~600px of viewport. |
| FR-F-06 | Next-page loading shows 3 skeleton cards. Failure shows `[!] FAILED TO LOAD MORE · [RETRY]`. |
| FR-F-07 | End-of-list footer: `— END OF FEED — REFRESH TO REGENERATE` with REFRESH clickable. |
| FR-F-08 | REFRESH click replaces existing feed with agent log panel, not dim. |
| FR-F-09 | Manual REFRESH rate-limited: **1 per 60s per user**; additional clicks → toast `ALREADY AGGREGATING — PLEASE WAIT`. |
| FR-F-10 | All external links `target="_blank" rel="noopener noreferrer"`. |
| FR-F-11 | YES and NO pills on prediction cards open the same Polymarket URL as `VIEW ON POLYMARKET`. Navigational, not betting. |
| FR-F-12 | If user navigates away during aggregation and returns, page detects in-flight run and re-enters Aggregating state. |

### 5.6 Feed Aggregator Backend — 10-Step Pipeline

**When it runs**: ~3h after last successful run per user (cron scans every 15 min); on REFRESH click; on interests save; on first `/feed` visit with no `feed_items`.

**Budget per run**: p95 ≤ 90s end-to-end; OpenAI cost p95 ≤ $0.10; target 15 `feed_items` per user.

**Orchestration**:
- Durable queue: BullMQ on Redis, queue name `feed-aggregation`, payload `{user_id, trigger_source}`, dedup jobKey `feed-aggregation:{user_id}`.
- Worker concurrency: start at 5 global; 1 per user.
- Skip users inactive >7 days.
- Write `feed_aggregation_runs.step_log` with per-step `{index, name, status, duration_ms, result}` for debugging.

**Pipeline**:

| # | Step name | Action / endpoint | Processing rules | Failure | Writes |
|---|---|---|---|---|---|
| 1 | INITIALIZING FEED AGGREGATOR | Insert `feed_aggregation_runs` row status='running'; read `user_interests` | If existing running row for user, return its run_id | Fatal if DB down | `feed_aggregation_runs` row |
| 2 | SCANNING HACKER NEWS TOP STORIES | GET `hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=50` | Filter posts without url (default drop); light keyword-match against user's clusters; cap 30 candidates; timeout 5s | Non-fatal | — |
| 3 | FETCHING GOOGLE NEWS RSS | GET `news.google.com/rss/search?q={cluster_query}&hl=en-US&gl=US&ceid=US:en` per user-selected cluster in parallel | Cluster→query map (tunable config): POLITICS→"politics", SPORTS→"sports", CRYPTO→"cryptocurrency OR bitcoin OR ethereum", MUSIC→"music industry", FOOD→"food industry", AI→"artificial intelligence OR AI chips", POP_CULTURE→"pop culture OR celebrities", TECH→"technology", ENVIRONMENT→"climate OR environment", FINANCE→"finance OR stock market". Filter to last 24h; 10 per cluster, 50 total. | Non-fatal; if all clusters fail + step 2 also empty → `NO_SOURCES` fatal | — |
| 4 | SCRAPING ARTICLE CONTENT | Pre-step: Levenshtein dedup on titles at ≥0.85 (collapse ~80 → 30–40). Then GET `r.jina.ai/{url}` with `Authorization: Bearer $JINA_API_KEY` if available | Concurrency cap 10; per-URL timeout 8s; drop URLs returning <200 chars; truncate main text to 8000 chars | Non-fatal per story; if Jina fully down, fall back to title-only | — |
| 5 | RUNNING LLM ENTITY EXTRACTION | OpenAI gpt-4o-mini, Chat Completions JSON mode, batched 5 stories/call. Prompt returns `{summary (2-3 sentences), entities[] (≤5), keywords[] (≤5, lowercase), sentiment (bullish/bearish/neutral), best_cluster (one of 10)}` | Drop stories with 0 entities; drop stories whose best_cluster isn't in user's interests | **Fatal** (retry once w/ exp backoff 2→5s; abort with LLM_FAILED on 2nd fail) | Upsert each kept story to `trending_topics` (dedup key: hash(normalized_title + source_url)) |
| 6 | MATCHING PREDICTION MARKETS | Polymarket Gamma: GET `gamma-api.polymarket.com/public-search?q={keyword}&limit=10` — top 3 keywords + all entities per story, parallel cap 20. Optional Quotient: GET `q-api.quotient.social/api/v1/markets/mispriced` once per run, auth `x-quotient-api-key`. | Dedup by conditionId; filter active=true AND closed=false AND volume_24h>1000; merge Quotient fields if slug matches | Non-fatal | Upsert to `cached_markets` (venue=polymarket) |
| 7 | QUERYING HYPERLIQUID PERPS | POST `api.hyperliquid.xyz/info` body `{"type":"metaAndAssetCtxs"}` **once per run**, cache in Redis 60s TTL | Hybrid ticker map: (a) static dict (bitcoin→BTC, ethereum→ETH, solana→SOL, nvidia→NVIDIA, tesla→TSLA, gold→GOLD; ~30 entries, grow over time), (b) fuzzy match against meta.universe, (c) optional gpt-4o-mini fallback for unmatched high-value entities | Non-fatal | Upsert to `cached_markets` (venue=hyperliquid, market_type=perp) |
| 8 | SCANNING DERIBIT OPTIONS | GET `deribit.com/api/v2/public/get_book_summary_by_currency?currency={BTC|ETH}&kind=option` once each per run, cache in memory | v4 scope: only BTC and ETH. Per story with BTC/ETH entity: nearest 1–2 expiries (~30 days out), strikes within ±20% of underlying, cap 5 per story | Non-fatal | Upsert to `cached_markets` (venue=deribit, market_type=option) |
| 9 | DEDUPLICATING & RANKING | Dedup pass 2 on summary+entities (stronger than title). Batched gpt-4o-mini call per story: score each candidate market 0–1 with reason. Then rank stories: `score = 0.4×cluster_weight + 0.3×recency + 0.2×best_market_relevance + 0.1×normalized_volume` | Keep markets with score>0.5; cap 3 markets/story (1 pred + 1 perp + 1 opt ideal); top 15 stories | Non-fatal (fallback: sort by entity count + recency). Fatal only if 0 stories result | — |
| 10 | COMPILING FEED | Single DB transaction: delete all `feed_items` for user, insert new ones, insert `topic_market_matches` rows with match_score+match_reason, update `feed_aggregation_runs` (status='completed', completed_at, story_count, step_log) | — | Fatal (existing feed preserved — deletion happens within tx) | Full replace of user's `feed_items`; matches to `topic_market_matches`; run row updated |

**Streaming protocol** (SSE):
- `step_start {index, name}` — client renders line with cursor
- `step_complete {index, name, result, duration_ms}` — client replaces `...` with `[result]`
- `step_error {index, name, message}` — non-fatal; client marks red `[ERROR]`
- `run_complete {story_count}` — client closes stream, refetches `/api/feed`
- `run_error {code, message}` — fatal; client → Feed Error state
- **Fallback if SSE unavailable**: client polls `GET /api/feed/status?run_id=...` every 2s, same event shape as snapshots

**Rate limits to respect**:
- Polymarket Gamma 4000/10s (parallel keyword cap 20)
- HyperLiquid generous (cache per run)
- Deribit 20/sec (we use 2 calls per run)
- OpenAI: exp backoff on 429

### 5.7 Feed API

| Endpoint | Purpose | Body/Query | Returns |
|---|---|---|---|
| `GET /api/feed?page=N&limit=10` | Paginated feed read | page, limit | `{items:[...], has_more, total_stories, cached_at}` |
| `POST /api/feed/refresh` | Manually enqueue aggregation | — | `{run_id}` or 429 if rate-limited |
| `GET /api/feed/stream?run_id=X` | SSE stream for live agent log | — | SSE events |
| `GET /api/feed/status?run_id=X` | Polling fallback | — | Current step_log snapshot |

### 5.8 Deferred (Feed)

Mark-as-seen/hide, per-item sharing, in-feed cluster filter, alert creation from cards, edge badges on feed prediction cards (only on Markets), search within feed, pagination arrows.

---

## 6. Markets Page — `/markets` (Market Scanner V2)

**What**: User-driven counterpart to Feed. Single input (URL or natural language) → 11-step pipeline → ranked markets across 3 venues.

**Key constraint**: **Scans are ephemeral.** No DB persistence, no permalinks, no history. Each scan lives only in the current page session.

### 6.1 Page States

| State | Trigger | Behavior |
|---|---|---|
| Empty | Mount / `← SCAN ANOTHER LINK` click | Default input UI (§6.2) |
| Scanning | Valid SCAN click | Input frozen; log panel renders 11 steps live |
| Results | Pipeline completes | Frozen input + SCAN_COMPLETE panel + counter tiles + up to 3 market sections + reset footer |
| Error | Fatal step fails OR 30s client timeout | Frozen input + error block with mapped message + RETRY + SCAN ANOTHER LINK buttons |

**Transitions**: Empty → Scanning → Results | Error. Results/Error → Empty via reset button. Error → Scanning via RETRY. **Navigating away discards all state; return → Empty.**

### 6.2 Empty State — Content (top to bottom, max-width ~920px centered)

| Element | Spec |
|---|---|
| Badge | `⊙ MARKET_SCANNER_V2` |
| 4-line headline (exact colors) | `DROP A LINK.` (dark green) / `DISCUSS A TOPIC.` (dark green) / `DISCOVER MARKETS.` (orange) / `DERIVE A TRADE.` (lighter orange) |
| Description | `PASTE ANY URL OR ASK ABOUT ANY TOPIC — WE EXTRACT ENTITIES, MATCH NARRATIVES, AND SURFACE TRADEABLE MARKETS ACROSS PREDICTIONS, PERPS & OPTIONS.` |
| Input row | Label `INPUT` · single-line input with link-icon prefix, placeholder `DROP A LINK OR ASK ABOUT ANY TOPIC...` · right-aligned SCAN button with crosshair icon |
| Chip row | 5 outlined chips in order: `NEWS ARTICLES · TWEETS · TOPICS · QUESTIONS · OPINIONS` |
| Panel | `⚡ SUPPORTED MARKET TYPES` with 3 collapsible sub-cards (all collapsed default): |
|   | `PREDICTIONS` [POLYMARKET] — *Binary outcome markets. Bet on whether events will happen. YES/NO pricing reflects crowd probability.* |
|   | `PERPETUALS` [HYPERLIQUID] — *Directional leveraged positions on crypto and stock tickers. Express "which way" with size.* |
|   | `OPTIONS` [DERIBIT] — *Asymmetric risk/reward. Express volatility and tail views with defined downside.* |

### 6.3 Scanning State

- Input row freezes (readonly, shows submitted value). SCAN button: spinner + label `SCAN…`
- Chip row visible but disabled
- Agent log panel renders below with 11 steps appended live

**Step names (exact text) and completion suffix format**:

| # | Step name | On completion shows |
|---|---|---|
| 01 | INITIALIZING MARKET SCANNER | `[DONE]` |
| 02 | FETCHING SOURCE CONTENT | `[TWEET]`, `[ARTICLE]`, or `[TEXT]` based on resolved input type |
| 03 | PARSING HTML / EXTRACTING TEXT | `[DONE]` |
| 04 | RUNNING NLP ENTITY EXTRACTION | `[{n} ENTITIES]` |
| 05 | IDENTIFYING TICKERS & KEYWORDS | `[{n} KEYWORDS]` |
| 06 | QUERYING POLYMARKET PREDICTION MARKETS | `[{n} MATCHED]` or `[0]` or `[ERROR]` |
| 07 | QUERYING HYPERLIQUID PERPETUALS | `[{n} MATCHED]` or `[0]` or `[ERROR]` |
| 08 | QUERYING DERIBIT OPTIONS CHAIN | `[{n} MATCHED]` or `[0]` or `[ERROR]` |
| 09 | CROSS-REFERENCING NARRATIVES | `[DONE]` |
| 10 | RANKING BY RELEVANCE SCORE | `[{n} PASS]` (count passing 0.5 threshold) |
| 11 | COMPILING RESULTS | `[DONE]` |

### 6.4 Failure Classification

| Fatal (→ Error state) | Non-fatal (scan continues, section shows error banner) |
|---|---|
| Step 1 (Initialize), 2 (Fetch — URL inputs only), 3 (Parse), 4 (Entity), 5 (Tickers), 10 (Rank), 11 (Compile) | Step 6 (Polymarket), 7 (HyperLiquid), 8 (Deribit), 9 (Cross-ref) |

**Client-side 30s timeout** → force Error with code `TIMEOUT`.

**Error code → user-facing message**:

| Code | Message |
|---|---|
| `SCRAPE_FAILED` | "SOURCE UNREACHABLE — THE URL COULD NOT BE RETRIEVED." |
| `PARSE_FAILED` | "PARSING FAILED — THE CONTENT COULD NOT BE EXTRACTED." |
| `LLM_FAILED` | "AI SERVICE UNAVAILABLE — ENTITY EXTRACTION FAILED." |
| `TIMEOUT` | "SCAN TIMED OUT AFTER 30 SECONDS." |
| `RATE_LIMITED` | "TOO MANY REQUESTS — TRY AGAIN IN A MINUTE." |
| `INVALID_INPUT` | "INPUT REJECTED — URL MUST BE HTTP(S) OR INPUT MUST BE TEXT UNDER 2048 CHARS." |
| `INTERNAL` | "INTERNAL ERROR — PLEASE RETRY." |

### 6.5 Results State — Content (top to bottom)

1. **Frozen input row + chip row** (chips now re-enabled)
2. **SCAN_COMPLETE panel** (dark-green terminal):
   - Header: `SCAN_COMPLETE` left, `{m} MARKETS FOUND` right
   - 2–3 sentence uppercase summary
   - `🏷 ENTITIES` row: **green outline chips**
   - `# KEYWORDS` row: **orange outline chips**
3. **Counter tile row** (always all 3 rendered, equal width):
   - `{n} PREDICTIONS`, `{n} PERPETUALS`, `{n} OPTIONS`
   - Show `—` for venue-errored, `0` for queried-but-empty, `{n}` for populated
4. **Market sections** (order fixed: Predictions → Perps → Options), each:
   - Heading with venue pill (`POLYMARKET + QUOTIENT`, `HYPERLIQUID`, `DERIBIT`)
   - Sorted card list (relevance desc, max 10 per section)
   - Empty: `NO MATCHED {CATEGORY} FOR THIS INPUT.`
   - Errored: red banner `{VENUE} UNAVAILABLE — TRY AGAIN LATER.`
5. **`← SCAN ANOTHER LINK`** footer button (centered) → reset to Empty

**Clickable entity/keyword chips**: clicking any chip re-seeds input with that text AND immediately triggers a new SCAN, discarding current results.

### 6.6 Result Market Cards (richer than Feed version)

| Card | Fields rendered |
|---|---|
| **Prediction** | Top row: `PREDICTION MARKET` chip + `VOL $XXk`/`$X.XM` · **Conditional Quotient edge badge**: if edge≥5%, orange pill `{edge_pct}% EDGE — BUY {YES\|NO}`; clicking opens tooltip with BLUF reasoning · Bold question (≤3 lines) · YES/NO pill row (both → Polymarket URL): `YES {n}%` / `NO {n}%` · End date line `ENDS: {MMM DD, YYYY}` (omit if missing) · Match reason block: `⊕ MATCH REASON` + 1 sentence LLM-generated explanation · `TRADE ON POLYMARKET ↗` footer |
| **Perp** | Top row: `PERPETUAL` chip + `VOL 24H $XXm` · Symbol (e.g., `NVIDIA-PERP`) + 24h change with ▲ (green) / ▼ (red) / → (flat) + percentage · Mark price (large) · Metrics stack: `FUNDING {signed_rate}% / 8H` (green when +, red when −) / `OPEN INTEREST {K/M abbreviated}` / `MAX LEVERAGE {n}x` · Match reason block · `VIEW ON HYPERLIQUID ↗` footer |
| **Option** | Top row: `OPTION` chip + `VOL 24H $X.Xm` · Full instrument name (e.g., `BTC-28MAR25-80000-C`) · Parsed line: `{CALL\|PUT} · STRIKE ${n} · EXP {DD MMM YYYY}` · Two-field row: `MARK ${n}  IV {n}%` · Greeks line: `Δ {2dp} · Θ {1dp signed} · V {2dp} · OI {int w/ commas}` · Match reason block · `VIEW ON DERIBIT ↗` footer |

### 6.7 Frontend Rules

| ID | Rule |
|---|---|
| FR-M-01 | `/markets` auth-only; unauth → `/` |
| FR-M-02 | SCAN disabled when input empty/whitespace; input max 2048 chars (silently truncate on paste beyond) |
| FR-M-03 | **Chip click behavior is engineering judgment**: chips must be visible+clickable; what they do on click (prefill example, set backend hint, etc.) is open decision, must be documented in implementation PR |
| FR-M-04 | Sub-cards in SUPPORTED MARKET TYPES toggle individually, default all collapsed |
| FR-M-10 | Server filters out markets with relevance_score < 0.5 |
| FR-M-11 | Max 10 cards per category section |
| FR-M-12 | All outbound links `target="_blank" rel="noopener noreferrer"` |
| FR-M-13 | Every outbound click emits analytics `markets_market_click {venue, market_id, placement:"results"}` |
| FR-M-14 | `← SCAN ANOTHER LINK` resets to Empty with input cleared |
| FR-M-15 | RETRY in Error state re-runs same input |
| FR-M-16 | Leaving and returning to `/markets` always shows Empty (no result recovery) |
| FR-M-17 | **Rate limits**: 30 scans/hour, 10 scans/minute per user |

### 6.8 Markets Backend — 11-Step Pipeline

**Shares architecture with Feed aggregator except**:
- Synchronous HTTP request, not background job. No queue, no scheduler.
- No DB persistence. `cached_markets` may be touched as an optimization but not required.
- Handles two input shapes: URLs (tweet/article) and natural language. Feed only does URLs.
- Uses X API for tweet fetching (Feed doesn't).
- Hard 30s client-visible timeout (vs Feed's 90s p95 soft target).

**Input routing** (before pipeline starts):
1. Sanitize: trim whitespace, reject if empty or >2048 chars with `INVALID_INPUT`.
2. Security: reject private/loopback IPs, non-http(s) schemes, `file://`, `data:` URIs with `INVALID_INPUT`.
3. Classify:
   - URL matches `(x.com|twitter.com|mobile.twitter.com)/status/{id}` → **tweet** branch
   - Other valid http(s) URL → **article** branch
   - Otherwise → **text** branch (natural language, no fetch)

**Pipeline**:

| # | Step | Action | Processing | Failure |
|---|---|---|---|---|
| 1 | INITIALIZING | Allocate in-memory run context + scan_id | No DB write, no locking | Fatal (rare infra) |
| 2 | FETCHING SOURCE CONTENT | **tweet**: GET `api.twitter.com/2/tweets/:id?expansions=author_id&tweet.fields=text,entities,context_annotations&user.fields=name,username`, auth `Bearer $X_BEARER_TOKEN`, timeout 5s, fallback to Jina on x.com URL if fails. **article**: Jina Reader, 8s timeout. **text**: skip, pass input through. | Output includes resolved content_type | Fatal if URL branch fully fails (`SCRAPE_FAILED`); text branch has no failure mode |
| 3 | PARSING | Strip markup; truncate to 8000 chars | Text branch: no-op pass-through with ≥10 char validation | Fatal if result <50 chars (`PARSE_FAILED`) |
| 4 | RUNNING NLP ENTITY EXTRACTION | OpenAI gpt-4o (higher quality than Feed's mini — acceptable because single call), JSON mode. Prompt returns `{summary, entities[], keywords[], sentiment}` — NO `best_cluster` (no cluster filter in Markets) | — | Fatal (retry once, then `LLM_FAILED`) |
| 5 | IDENTIFYING TICKERS & KEYWORDS | Hybrid ticker mapping (same as Feed §5.6 step 7): static dict → fuzzy universe match → gpt-4o-mini fallback (worth using here since single scan, user waiting) | — | Fatal if LLM fully fails |
| 6 | QUERYING POLYMARKET | Same as Feed §5.6 step 6: Gamma public-search + optional Quotient. Cap ~30 candidates returned (ranking in step 10 trims to 10) | No DB write required | Non-fatal; tile shows `—` |
| 7 | QUERYING HYPERLIQUID | Same as Feed §5.6 step 7: metaAndAssetCtxs cached 60s in Redis | — | Non-fatal |
| 8 | QUERYING DERIBIT OPTIONS CHAIN | Same as Feed §5.6 step 8: BTC + ETH options only | — | Non-fatal |
| 9 | CROSS-REFERENCING NARRATIVES | Short gpt-4o-mini call: *Given summary + candidate markets, group markets expressing the same underlying narrative. Return `{narratives:[{label, market_ids:[]}]}`.* Markets in multi-market narratives get `narrative_boost` +0.1 in step 10 | **Unique to Markets** — Feed has no equivalent | Non-fatal; fall back to flat ranking |
| 10 | RANKING BY RELEVANCE SCORE | **One batched** gpt-4o-mini call per scan: summary + all candidate markets across all venues → `{market_id, score 0-1, reason}[]`. Apply narrative_boost. Filter `score + boost > 0.5`. Cap 10 per category. Match reason must be produced here (shown prominently on cards per FR-M — don't do separate pass) | — | Fatal (retry once, then `LLM_FAILED`) |
| 11 | COMPILING RESULTS | Build response payload, emit `run_complete` SSE event with full payload, close stream. **No DB writes required.** Optional opportunistic `cached_markets` upsert (good hygiene for Feed) | — | Fatal only on infra |

**Streaming**: Same SSE event shape as Feed. Key difference: `run_complete` in Markets carries the **entire response payload** (not just a "go fetch" signal like Feed). If SSE unavailable, synchronous POST response returning full payload in one shot is an acceptable fallback (degraded UX — client fakes step animation on timers).

**Graceful degradation**:
- No X_BEARER_TOKEN → tweet URLs fall back to Jina (lower quality, scan still completes)
- No Quotient key → edge badges don't render, everything else works
- No Jina key → free tier continues
- OpenAI rate-limited → scan aborts with `LLM_FAILED`

### 6.9 Markets API

| Endpoint | Purpose | Body | Returns |
|---|---|---|---|
| `POST /api/scan` | Start a scan | `{input: string, input_type_hint?: string}` | `{run_id, stream_url}` — client connects to SSE |
| `GET /api/scan/stream?run_id=X` | SSE stream | — | SSE events, final `run_complete` carries full result |

### 6.10 Deferred (Markets)

Scan history, permalinks, watchlist/favorites, side-by-side comparison, user-selectable venue filtering, alert creation from result cards, multi-input batch, autocomplete.

---

## 7. Profile Page — `/profile`

**What**: Read-only identity surface with 2 edit entry points.

### 7.1 Content (top to bottom)

| Section | Contents |
|---|---|
| **Identity** | Avatar 96×96 square rounded (fallback: blue square with first letter of display_name) · Display name bold uppercase · `@handle` muted (Twitter handle priority over Farcaster when both linked) |
| **Interests** | Eyebrow `PREFERENCES` · Title `YOUR INTERESTS` · Chip row (one per selected cluster, orange outline, icon + uppercase name) · Full-width `UPDATE INTERESTS →` button |
| **Style** | Eyebrow `RISK.MODULE` · Title `YOUR STYLE` · Card with style icon, tag name, tagline, description (pulled from §4.6 tag content table) · Full-width `RETAKE ASSESSMENT →` button |

### 7.2 Rules

| ID | Rule |
|---|---|
| FR-PR-01 | Auth-only. |
| FR-PR-02 | Skeletons during `GET /api/users/me`. |
| FR-PR-03 | Any interest chip OR `UPDATE INTERESTS` button → routes to `/settings`. |
| FR-PR-04 | `RETAKE ASSESSMENT` → routes to `/onboarding/style?retake=true`. |
| FR-PR-05 | **Edge case** — user without style_tag: render placeholder card (question-mark icon, tag `UNSET`, tagline `TAKE THE ASSESSMENT TO UNLOCK YOUR STYLE.`), only RETAKE button visible. |
| FR-PR-06 | Nothing inline-editable — display name, avatar, handle inherited from Privy, immutable here. |

### 7.3 Deferred (Profile)

Viewing others' profiles, editing display name/avatar, account linking UI, historical style tags, activity stats.

---

## 8. Settings Page — `/settings`

**What**: In v4.0.2, single purpose — editing interest clusters. Branded `SYS.CONFIG · EDIT INTERESTS`.

### 8.1 Content

| Element | Spec |
|---|---|
| Top | Back arrow → `/profile` |
| Eyebrow + Title | `SYS.CONFIG` orange · `EDIT INTERESTS` |
| Subtitle | `RECONFIGURE DATA STREAM CLUSTERS. CHANGES APPLY IMMEDIATELY TO FEED DISTRIBUTION.` |
| Grid | 4-col × 10 cluster cards — **identical styling and toggle behavior as Onboarding Interests (§4.4)** |
| Counter | `MINIMUM 3 CLUSTERS REQUIRED. CURRENT: {n} CLUSTERS ACTIVE.` |
| CTA | Full-width orange filled `SAVE CHANGES` button |

### 8.2 Rules

| ID | Rule |
|---|---|
| FR-S-01 | Auth-only. |
| FR-S-02 | On mount, current selection pre-applied. |
| FR-S-03 | Toggle rules identical to Onboarding Interests. |
| FR-S-04 | Attempting to deselect when count would drop to 2 → fail silently with toast `MINIMUM 3 REQUIRED`, card stays selected. |
| FR-S-05 | SAVE CHANGES enabled **only if both**: (a) ≥3 selected, AND (b) selection differs from saved state. |
| FR-S-06 | Saving triggers immediate Feed re-aggregation (server enqueues new run). |
| FR-S-07 | On success: toast `INTERESTS UPDATED — FEED RE-AGGREGATING` + route to `/profile`. |
| FR-S-08 | Back arrow with unsaved changes → confirm dialog `UNSAVED CHANGES · DISCARD AND EXIT?` with CANCEL / DISCARD buttons. |
| FR-S-09 | Closing tab with unsaved changes → browser `beforeunload` prompt. |

### 8.3 Deferred (Settings)

Account settings (email/password/delete), notification prefs, theme/dark mode, workspace/team, bulk select-all/clear, undo after save.

---

## 9. Navigation Flow

```
/                                                   [public]
 └─► Privy modal
       ├─ new user       → /onboarding/interests → /onboarding/style → /onboarding/style/result → /feed
       └─ returning      → /feed

Authenticated (global nav):
 /feed ⇄ /markets ⇄ /alerts (P1) ⇄ /profile ⇄ /settings
 /profile → /settings → /profile (after save)
 /profile → /onboarding/style?retake=true → /onboarding/style/result → /feed
```

---

## 10. Acceptance Criteria (cross-page)

### Auth & Onboarding
| ID | Criterion |
|---|---|
| AC-01 | Visiting `/` with existing Privy session redirects to `/feed` immediately. |
| AC-02 | Privy modal shows only Twitter + Farcaster. No email/SMS/wallet. |
| AC-03 | OAuth cancellation → modal stays open with inline `AUTHENTICATION FAILED — RETRY`. |
| AC-04 | New-user post-auth → `/onboarding/interests`. Returning complete user → `/feed`. |
| AC-05 | Interests grid shows exactly 10 clusters. CONTINUE disabled until ≥3 selected. |
| AC-06 | Style assessment shows exactly 6 questions with exact wording from §4.5. |
| AC-07 | NEXT disabled until answer selected each question. BACK preserves prior selection. |
| AC-08 | Same answer set always produces the same style tag (deterministic). |
| AC-09 | Style Result page tag/tagline/description/icon match the §4.6 table entry. |
| AC-10 | Retake flow (`?retake=true`) overwrites previous `style_tag`. |

### Feed
| ID | Criterion |
|---|---|
| AC-11 | First-time `/feed` (no cache) shows Agent Log Panel within 2s, steps appearing live. |
| AC-12 | Status strip shows `CACHED {n}H AGO` (or `{k}M AGO` <1h) matching oldest story's timestamp. |
| AC-13 | Each feed card renders news header on top, then market children in order: Predictions, Perps, Options. |
| AC-14 | Story with zero matched markets does not appear in feed. |
| AC-15 | Scrolling near bottom auto-loads next 10 cards; 3 skeletons while loading. |
| AC-16 | After last page: `— END OF FEED — REFRESH TO REGENERATE` with clickable REFRESH. |
| AC-17 | REFRESH click → Aggregating state within 300ms; second REFRESH within 60s → rate-limit toast. |
| AC-18 | All outbound links open new tab. |
| AC-19 | YES/NO pill on prediction card opens Polymarket in new tab (same URL as VIEW ON POLYMARKET). |
| AC-20 | Non-fatal venue failure during aggregation doesn't abort run; resulting cards simply lack that market category. |

### Markets
| ID | Criterion |
|---|---|
| AC-21 | `/markets` defaults to Empty; headline 4 lines (2 dark-green, 2 orange). |
| AC-22 | SCAN disabled when input empty; paste >2048 chars silently truncated. |
| AC-23 | All 5 chips render in order: NEWS ARTICLES, TWEETS, TOPICS, QUESTIONS, OPINIONS. |
| AC-24 | Chip click behavior documented in implementation PR. |
| AC-25 | SCAN click → Scanning within 100ms; first log line appears within 500ms. |
| AC-26 | All 11 step names render in order with exact uppercase text. |
| AC-27 | Non-fatal step failure → that line red `[ERROR]`, subsequent steps continue. |
| AC-28 | Fatal step failure → abort to Error state with mapped message. |
| AC-29 | 30s timeout with no completion → Error with code `TIMEOUT`. |
| AC-30 | All 3 counter tiles always render: `—` for venue errors, `0` for empty, `{n}` for populated. |
| AC-31 | No market with relevance_score < 0.5 in results; max 10 per section. |
| AC-32 | Prediction card renders: question, YES/NO pills, volume, end date (if present), match reason. |
| AC-33 | Edge badge renders **only** when Quotient edge ≥ 5%; clicking opens tooltip with BLUF. |
| AC-34 | Perp card renders: symbol, 24h change with ▲/▼ + correct color, mark price, funding rate, open interest, max leverage, match reason. |
| AC-35 | Option card renders: instrument, parsed CALL/PUT + strike + expiry line, mark/IV row, greeks line (Δ Θ V OI), match reason. |
| AC-36 | Entity/keyword chip in SCAN_COMPLETE re-seeds input AND immediately triggers new scan. |
| AC-37 | `← SCAN ANOTHER LINK` → Empty state with input cleared. |
| AC-38 | Navigating away mid-scan and returning → Empty state (no result recovery). |

### Profile & Settings
| ID | Criterion |
|---|---|
| AC-39 | `/profile` displays avatar/name/handle matching DB. Missing avatar → initial fallback. |
| AC-40 | Selected interests render as orange-outline chips (icon + name). |
| AC-41 | Interest chip OR UPDATE INTERESTS click → `/settings`. |
| AC-42 | Style card content matches user's `style_tag` row in §4.6. |
| AC-43 | RETAKE ASSESSMENT → `/onboarding/style?retake=true`. |
| AC-44 | User without style → placeholder card + only RETAKE button. |
| AC-45 | `/settings` grid reflects current selection on mount. |
| AC-46 | Deselecting down to 2 → fails silently with `MINIMUM 3 REQUIRED` toast. |
| AC-47 | SAVE CHANGES enabled only when ≥3 selected AND selection differs from saved. |
| AC-48 | Save success → toast + route to `/profile`. |
| AC-49 | Save also enqueues Feed re-aggregation run. |
| AC-50 | Back with unsaved changes → confirm dialog; DISCARD routes without saving. |
| AC-51 | Close tab with unsaved changes → browser beforeunload prompt. |

### Global
| ID | Criterion |
|---|---|
| AC-52 | Left-nav highlights active page with bright-green text + trailing dot. |
| AC-53 | All auth pages usable at 375px with no horizontal scroll. |
| AC-54 | All interactive elements keyboard-accessible with visible focus. |
| AC-55 | All pages with market data carry footer disclaimer: *Capacitr provides market information for reference only. Not investment advice.* |

---

## 11. Required Resources

### Strictly required (cannot run without)
| Resource | Purpose |
|---|---|
| Privy | Social login (Twitter + Farcaster only), JWT issuance |
| PostgreSQL | Stores everything in §3 except scans |
| Redis | BullMQ queue (Feed agent) + short-lived caches (HyperLiquid/Deribit meta) |
| OpenAI | LLM calls for both Feed aggregator and Markets scanner |
| Next.js-compatible hosting + worker host | Frontend + Feed agent cadence |

### Required for full functionality
| Resource | Purpose |
|---|---|
| X Developer API | Tweet scans on Markets page. Without it, x.com URLs fall back to Jina (lower quality but works). Also the backing API for Privy's Twitter login (configured in Privy dashboard, not our env). |
| Jina Reader | Article scraping for Feed agent and Markets scanner. API key recommended for rate stability but free tier works. |

### Optional (graceful degradation when absent)
| Resource | Purpose |
|---|---|
| Quotient Intelligence | AI fair-odds for Polymarket; edge badges on Prediction cards hidden if absent |
| Sentry | Error tracking |
| PostHog (or equiv) | Product analytics |

### No API key needed
Polymarket (Gamma + CLOB), HyperLiquid, Deribit (public endpoints), Hacker News Algolia, Google News RSS.

### Minimum monthly cost (100 DAU MVP)
- OpenAI: ~$40–80 (aggregation + scans combined)
- X API Basic: $100 (optional)
- Privy / Supabase / Upstash free tiers: $0
- Vercel Hobby/Pro: $0–20
- **Total: $140–200/mo** with X API; **$40–100/mo** without (degraded tweet input)

---

## 12. Analytics Events (client-side)

| Event | Fires when |
|---|---|
| landing_view | `/` mounted |
| signup_click | SIGN UP clicked |
| privy_modal_opened / privy_provider_clicked / privy_auth_success / privy_auth_error | Corresponding step in auth flow |
| onboarding_interests_view / _saved | Interests page mounted / CONTINUE saved |
| onboarding_style_q{i}_viewed / _answered / _submitted / _result_viewed | Per step in quiz |
| feed_view / feed_refresh_clicked / feed_scroll_loaded_page / feed_news_click / feed_market_click | Feed interactions |
| markets_view / markets_scan_submitted / markets_scan_completed / markets_scan_failed / markets_market_click / markets_entity_click / markets_keyword_click / markets_reset_clicked / markets_retry_clicked | Markets interactions |
| profile_view / settings_view / settings_saved / assessment_retake_started | Profile/Settings interactions |

---

## 13. Global Error Handling Principles

1. Never show a blank error screen. Every error has a mapped user-facing message.
2. Color is never the only signal. Error states include a symbol or prefix (✕, `[ERROR]`, `[!]`).
3. Every error has a way out. Error blocks include RETRY, RESET, or navigation.
4. Non-fatal errors degrade, not abort. One venue failing never prevents other venues from rendering.
5. Rate-limit messages include a retry delay.

---

## 14. Glossary

| Term | Meaning |
|---|---|
| Prediction market | Binary-outcome market (Polymarket) resolving YES or NO |
| Perp | No-expiry leveraged derivative (HyperLiquid) |
| Option | Contract with strike + expiry (Deribit). Call = right to buy; Put = right to sell |
| Greeks | Delta (Δ), Theta (Θ), Vega (V), plus Open Interest (OI) |
| IV | Implied Volatility (%) |
| BLUF | Bottom Line Up Front — Quotient's one-line reasoning for a mispriced market |
| Edge | Gap between Quotient's AI fair probability and market's current YES/NO price |
| Scan | One Markets-page pipeline run from input to results |
| Aggregation | One Feed-agent background run producing a user's feed |
| Cluster | One of the 10 fixed interest categories |
| Style tag | One of the 6 risk/style profile labels |