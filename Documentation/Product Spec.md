# RoastMyBiz — Product Spec

**Working name:** RoastMyBiz
**Tagline:** "We'll roast your business. Your customers already are."
**One-liner:** A mobile app that gives any local business a brutally honest, AI-generated "roast" of how it handles calls, reviews, and its website — packaged as a shareable score card built to spread on TikTok, Reels, and Shorts.

**Origin:** This is the mobile-app build-out of Bet #5 ("The Public Roast") from the GoHighLevel-category blue ocean brief. It is designed to work as a standalone viral acquisition engine that funnels directly into AI Front Desk (this repo's core product) — every roast finding about missed calls or slow response time ends in a one-tap "fix this" path into AI Front Desk's missed-call text-back service.

---

## 1. Look & Feel — Branding Guideline

### Brand personality
Savage but caring — like a friend who roasts you to your face and then actually helps you fix it. The tone is comedic and blunt, never cruel or personal; every joke is anchored to a real, verifiable data point (load time, response time, star rating), so it reads as "accurate roast," not "random insult." Brand-safe enough to run as paid social creative on Meta and TikTok (no profanity, no protected-class jokes, no personal attacks on individuals — the business's *systems* get roasted, never its owner).

### Color palette

| Token | Hex | Use |
|---|---|---|
| `charcoal` | `#14100D` | Primary background, app chrome |
| `ember` | `#FF5A1F` | Primary accent — CTAs, flame motif, active states |
| `scorch-red` | `#E8342A` | Failing grades, critical findings |
| `cooked-gold` | `#FFB627` | Score highlights, mid grades, badges |
| `cooled-mint` | `#2BE0B0` | Passing grades, "fixed" states, positive delta |
| `ash` | `#F4F1EA` | Text-on-dark, card backgrounds in light mode |

The palette is literally a temperature gradient — from cold mint (a business that's doing fine) through gold (mediocre) to scorch-red (on fire, and not in a good way) — so the color itself communicates the score before the user reads a word.

### Typography

| Role | Typeface | Notes |
|---|---|---|
| Display / scores / roast headlines | **Anton** (Google Fonts) | Condensed, heavyweight, poster-like — built for a big letter grade to dominate a phone screen and read instantly in a 1-second TikTok scroll |
| Body / UI text | **Manrope** | Clean geometric sans, high legibility at small sizes, friendly without being corporate |
| Data / scorecard numbers | **Space Mono** | Used for sub-scores, percentages, timestamps — gives the results screen a "printed receipt" feel that reinforces the "here's your proof" concept |

### Visual style
- **Scorched-edge motif**: cards and share exports have a subtly singed/torn top edge (like a receipt pulled off a thermal printer that caught fire) — the app's single recurring visual signature, used consistently across the Roast Card, share exports, and app icon.
- **Flame as the loading/progress metaphor**: a grill/flame animates and grows during the "roasting" phase; it dies down to an ember for a passing grade or flares up for a failing one.
- **Grades over jargon**: every score is expressed as a letter grade with a doneness pun scale (Raw → Rare → Medium → Well-Done → Michelin Star) rather than a percentage — memorable, meme-able, and instantly understood without explanation.
- **Motion**: snappy, spring-based, meme-timed (score counts up fast then overshoots slightly before settling; a screen-shake micro-interaction on grade reveal). Avoid smooth corporate easing — the app should feel like a reaction video, not a dashboard.
- **Iconography**: flat, single-weight line icons with one ember-orange fill accent; a flame glyph replaces the dot on the "i" in the wordmark.

---

## 2. Functionality

### Core loop
1. **Enter a business** — by phone number, website URL, or Google Business Profile search/autocomplete.
2. **AI audits it** across four categories (below) and produces a 0–100 score mapped to a letter grade.
3. **Results render as a Roast Card** — a grade plus 3–5 specific, data-backed one-liners.
4. **User shares** an auto-generated vertical video and static card, pre-captioned for TikTok/Reels/Shorts/Instagram.
5. **Every finding links to a fix** — the app's monetization bridge into paid remediation (AI Front Desk for response-time findings; partner/upsell paths for reviews and website findings).

### What gets audited

| Category | Signal sources | Example finding |
|---|---|---|
| **Response Speed** | Simulated missed-call/text test (owned & verified numbers only — see compliance note below); public "responds to messages" badge from Google Business Profile | "A customer texted at 2pm. Nobody replied until 9am the next day. They already booked with someone else." |
| **Reviews & Reputation** | Google Business Profile rating, review volume, review recency, owner reply rate/time | "You have 4 one-star reviews from the last 90 days and replied to zero of them." |
| **Website & Booking** | Public PageSpeed/Core Web Vitals, mobile-friendliness, presence and placement of phone number/booking CTA | "Your site takes 7.8 seconds to load on mobile. Half your visitors are gone before it finishes." |
| **Listing Accuracy** | Google Business Profile completeness, hours accuracy vs. holiday schedule, NAP (name/address/phone) consistency | "Google says you're closed right now. You're not. That's a missed job." |

**Compliance/ethics note (important product decision):** Live call or SMS response-time tests are only ever run against a phone number the requesting user has verified ownership of (OTP verification). Roasting a *friend's or competitor's* business never triggers an outbound call or text to them — it uses only public signals (Google Business Profile data, public review reply behavior, public website performance). This keeps the viral "roast a competitor" loop from becoming a nuisance-calling or harassment vector.

### Highlights most likely to drive organic + paid virality

1. **Native short-form export, not a screenshot.** The app renders an actual 9:16, captioned, sound-synced video of the score reveal — built to be posted directly, not described. This is the single highest-leverage feature: it removes all the work between "got a result" and "posted a result."
2. **Every roast is unique, generated copy.** Because the one-liners are AI-generated from that specific business's real data, no two shares look templated — which matters both for organic spread (it doesn't read as an ad) and for paid creative (avoids the fatigue that kills templated UGC ad formats fast).
3. **"Roast a friend/competitor" loop.** The single fastest-spreading mechanic: one person roasts a friend's business, tags them, and the target roasts theirs back. This is the same peer-pressure share loop that made Spotify Wrapped and "rate my..." formats spread, applied to local business rivalry.
4. **Local leaderboards ("Roast Battles").** City- and industry-level rankings turn a one-off gag into a recurring reason to open the app, and are inherently pickup-able by local Facebook groups, local news, and industry associations ("Is your plumbing company the worst-rated in Denver?").
5. **The redemption arc.** Score-over-time tracking means a business can go from an F to a B after fixing what the roast flagged — a built-in before/after narrative that is the strongest-performing creative format in this ad category, and doubles as organic testimonial content ("We got roasted, fixed it, here's our new score").
6. **Agency cold-outreach mode.** Agencies/resellers (this app's other core persona) can generate a white-labeled roast of a prospect's business and use it as an outreach opener — turning the tool into a lead-gen weapon for exactly the SMMA/agency audience this category's paid social lives on.

---

## 3. Primary Screens

**1. Home / Landing**
Full-bleed charcoal background, idle flame animation, one primary CTA ("Roast a Business"), a business search bar with Google Places autocomplete, and a live scrolling ticker of recent public roasts for social proof ("Joe's Plumbing just scored a D-").

**2. Claim & Verify** *(only shown when the user is roasting their own business and wants the live response-time test)*
Phone-number entry with OTP verification, one-sentence explanation of why verification is required, and what the test will actually do (send one test text, simulate one test call).

**3. Roasting (loading) screen**
Animated grill/flame that builds as the audit runs, with a real-time status list ("Checking Google reviews… Testing response time… Analyzing your website…") to build anticipation over the ~15–30 second audit.

**4. Roast Card / Results** *(the hero screen)*
Oversized letter grade in Anton, a flame-o-meter gauge, and 3–5 punchy roast lines, each expandable to show the underlying data point it's based on. Primary actions: **Share** (prominent, ember-colored) and **See Full Breakdown**.

**5. Score Breakdown**
The four category scores (Response Speed, Reviews & Reputation, Website & Booking, Listing Accuracy) as individual mini-gauges with the specific metrics behind each, in the Space Mono "receipt" style.

**6. Share & Export**
Preview of the auto-generated vertical video and the static card side by side, with one-tap share buttons per platform (TikTok, Instagram Reels, Facebook, LinkedIn, X, copy link/SMS) and a pre-filled, editable caption with suggested hashtags.

**7. Fix-It**
A checklist mirroring each roast finding, each with a "Fix this for me" action — response-time findings route into AI Front Desk's missed-call text-back setup; review and website findings route to relevant partner flows. This screen is the monetization hinge of the app.

**8. Leaderboard / Roast Battles**
Filterable by city and industry, showing ranked scores with a "Challenge" button to nominate another business for a roast — the primary peer-to-peer virality surface.

**9. History & Progress** *(for claimed/verified businesses)*
A score-over-time chart, a "Re-roast me" button, and milestone badges (e.g., "Went from Raw to Medium in 30 days") — turns a one-time viral hit into a reason to return.

**10. Agency Mode** *(secondary persona dashboard)*
White-label branding toggle (agency logo/colors on generated roasts and exports), a bulk-prospecting list for running roasts across many target businesses at once, and exportable outreach templates built from each roast's findings.

---

## Target personas

1. **Local business owner** — receives or discovers a roast of their own business, is stung into fixing it, becomes a lead for remediation services (including AI Front Desk).
2. **Agency / reseller (SMMA)** — uses the app as a free prospecting and cold-outreach tool, generating white-labeled roasts of prospects as a door-opener; the primary "resale" growth loop, mirroring how this category's audience already operates on TikTok/YouTube.

## Success metrics (Phase 1)

- Roasts generated per day; % that result in a share action
- Share → new-roast conversion rate (viral coefficient of the "roast a friend" loop)
- Roast → Fix-It click-through rate
- Fix-It → AI Front Desk signup conversion rate
- Re-roast rate at 30/60/90 days (retention signal for claimed businesses)

## Phase 2 (explicitly out of scope for v1)

- Automated re-roasting on a schedule with push-notification score alerts
- Public API for agencies to embed roast generation in their own outreach tools
- Paid "Roast Insurance" — a subscription that keeps a business's public score monitored and alerts them before a bad review streak tanks their grade
