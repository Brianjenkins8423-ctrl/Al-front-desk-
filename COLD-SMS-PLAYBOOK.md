# Cold SMS Playbook: Selling the AI Front Desk

This is Charlie Morgan's "Cold SMS Full Guide" turned into a playbook for **FrontHalo**.
The product is the AI Front Desk in this repo: it texts back missed calls, answers
questions, and captures leads. The buyers are local trade owners: roofers, HVAC,
plumbers, remodelers and so on.

> **Not legal advice.** Texting phone numbers you scraped carries legal and carrier risk
> (see [Compliance](#7-compliance-read-this-before-sending)). Read that section before
> you send anything.

---

## 0. The campaign: "Missed-Call Audit" (start here)

This is the best version of the guide for FrontHalo, after checking it against
current research. It keeps Charlie's structure (two-liner, quick call, long
follow-up) and changes three things.

**1. The hook is a fact you checked yourself, not a claim you made up.** Before you
text a business, **call its public number once** during evening or weekend hours. If
nobody answers, that missed call becomes your opener. It's specific, local and true,
which is what the guide says makes people reply. It also proves the problem you
solve, in their own phone log.
- How common is this? Vendor studies put the share of home-service calls that no
  person answers anywhere from 14% to 74%. Invoca's 2026 benchmark found only 52%
  were answered live. All of these are vendor numbers, so use them on calls as
  "studies say about half," never as a hard stat.
- If they answer, the audit is still useful. Say "Sorry, wrong number," log
  `audit-answered`, and drop them to a lower-priority list. They already pick up.

**2. Compliance is part of the design.** Indiana's Do Not Call law treats a text
to a cell phone as a "telephone sales call." Penalties start at **$10,000 for the
first violation** and $25,000 for each one after that. On the federal side, the
TCPA has no blanket B2B exemption for cell phones. So:
- Scrub every list against the **National DNC** and the **Indiana DNC** lists.
  Indiana sells access to registered telemarketers through the AG's office. Remove
  any match.
- Send the first text **by hand, one at a time**, from the GHL conversation, for
  each audited business. Use the drip workflow **only** for follow-ups to people who
  replied. Replying counts as an inquiry, which supports an existing business
  relationship for 3 months under Indiana law.
- Every first text names you and your business and gives an easy way out: "Reply
  STOP and I won't text again." Honor STOP right away by marking DND.
- Register A2P 10DLC first. Carriers have blocked 100% of unregistered 10DLC
  traffic since Feb 2025.
- Before scaling past about 50 texts a day, spend an hour with an Indiana TCPA
  attorney. One complaint costs more than that consult.

**3. Lower volume, higher hit rate.** Hand-audited, personalized texts trade the
guide's 2,000 texts a month for about **300 to 400 a month (15 to 20 a day)**, with
a much higher reply rate. A text that says "I called you Tuesday at 7:40pm and got
voicemail" can't be ignored the way a template can. Charlie plans on a 1% booking
rate. Here the target is **4–6%**, which still gives about 15 to 20 booked calls a
month. That target is an estimate, so check it after 2 weeks.

### The daily routine (about 90 minutes)

| Time | Task |
|---|---|
| 5–7pm, or Sat | **Audit:** call 20 businesses from today's DNC-scrubbed list. Log `audit-missed` with day and time, or `audit-answered` |
| Next morning, 8–9am | **Open:** hand-send the two-liner to each `audit-missed` lead (template below) |
| All day | **Speed to lead:** call every positive reply within 5 minutes |
| End of day | Work the warm follow-up list (§3e). Update the 4-number tracker |

### The exact messages

**Two-liner (hand-sent the morning after the audit):**
> `Hi Mike, Brian here, local in Fishers. I called Ridgeline last night around 7:40 and got voicemail. Want me to show you a way to auto-text those callers back? (Reply STOP and I won't text again)`

**Variant for A/B testing (curiosity frame):**
> `Mike, Brian w/ FrontHalo in Fishers. Tried your line Sat afternoon, no answer. Do you have anything catching weekend calls right now? (STOP to opt out)`

**FU1, about 3 hours later, still sent by hand:**
> `No worries if you're on a roof, which is kind of my point lol. Worth a 5-min look?`

**FU2, the next day at a different time. This is the last cold touch:**
> `Last one from me, Mike. Want me to text your line a demo so you can see what your callers would get?`

**After a positive reply:** text `Awesome, calling you now`, then call within 5
minutes. On the call, **text a live AI Front Desk demo number while they're on the
phone.** Seeing it answer them in about 10 seconds is the close. Then book the
setup call for today or tomorrow morning (§3d).

**The offer:** a free 7-day trial on their line (the setup is about an hour, per
README). When the week is over, show them the leads the AI captured from the
`/leads` page. That turns "maybe" into a decision based on their own data.

### Scorecard (check after 2 weeks)

| Metric | Target | If you miss it |
|---|---|---|
| Audit miss rate | 30% or more | Audit later in the evening or on Sundays |
| Positive reply rate (of texts sent) | 10% or more | Tighten the opener, add the call time and day |
| Positive reply → booked | 40% or more | Call faster, run the full 16-touch warm sequence |
| Booked → trial started | 50% or more | Do the live demo on every call |
| Trial → paid | 50% or more | Check the trial setup quality and lead capture |

The rest of this document is the full guide this campaign is built on.

---

## 1. The whole system on one page

```
Two-liner ──no reply (2h)──▶ Follow-up 1 ──no reply (22h)──▶ Follow-up 2 ──no reply──▶ stop
    │                             │                               │
    └──────── positive reply ─────┴───────────────────────────────┘
                                  ▼
          Text back + CALL WITHIN 5 MINUTES  ──▶  book a 15-min call (today/tomorrow)
                                  │
                       no answer / no booking
                                  ▼
          Warm follow-up: 8 texts + 8 calls over 14 days (every other day)
                                  │
                         still nothing after 2–3 weeks
                                  ▼
                    Monthly reactivation text
```

The cold sequence is 3 texts and the warm sequence is up to 16 touches. Charlie says
most bookings come from follow-ups 5 through 8.

---

## 2. Why our offer fits SMS so well

Charlie's niche scorecard rates 8 things from 1 to 3. A total of 16 or more is a green
light. Local trades score high on almost all of them:

| Factor | Trades score | Why |
|---|---|---|
| Owner mobile is public | 3 | Owner-operators list their cell on Google Maps |
| Ticket size / urgency | 3 | One missed roofing call can be a $10k+ job |
| Reply culture | 3 | They live on their phones |
| Contacting a business | 3 | B2B, not consumers |
| Easy qualification | 3 | "Do you miss calls?" is a yes/no question |
| Data coverage | 3 | Google Maps has thousands per metro |
| Local proof | 3 | "Fishers", "Carmel", "Noblesville" |
| Fast fulfillment | 3 | The AI Front Desk can be live in about an hour (see README) |

**There's also a pitch inside the channel itself.** These owners miss calls because
they're on a roof. We're texting them, and our product texts their callers. If they
reply to us, they've just felt why texting works.

---

## 3. The messages

### 3a. The two-liner (first text)

The rules from the guide:
- Say who you are and give a believable, specific, local reason.
- Ask a yes/no question.
- **No links in the first text.**
- Keep it to 2 lines. Use small numbers and real place names.
- Don't use agency words like "marketing", "leads" or "solutions" in the company
  name or the message.

**Our honest hook: the missed-call test.** The guide's example "I have 2 roof
requests for you" only works if it's true. Making it up is the kind of deception TCPA
and the carriers punish. We have a hook that is true: **call the business after hours
before you text them.** If nobody picks up, that's your opener.

Templates (rewrite them in your own words, because copied templates burn out fast):

1. `Hey Mike, Brian here in Fishers. I called Ridgeline last night around 7 and got voicemail. Want me to show you how to text those callers back automatically?`
2. `Mike, Brian with FrontHalo (Fishers). Quick one: are you open to catching the roofing calls that come in while you're up on a job?`
3. `Hi Mike, sorry for the random text. Are you taking on more roof jobs around Carmel this month?` *(This is the guide's pure-curiosity opener. Explain the product on the call.)*
4. `Hey Mike, Brian here. I set up a thing for a few Indy contractors that texts back missed calls in 10 sec. Want me to run it on your line free for a week?` *(Value-first frame)*

**A/B test:** send 50 of one frame (value-first, #4) and 50 of another (direct, #1/#2)
to similar lists. Pick the winner by **signed clients**, not by reply count.

### 3b. Cold follow-ups (only if they don't reply)

- **FU1, 2 hours later:** `Not sure my last text came through. Still want to see if you're catching after-hours calls?`
- **FU2, 22 hours after FU1:** `Mike, should I keep you posted if we open more spots in Hamilton County this month?`

Vary the send time by an hour or two so the messages don't look automated.

### 3c. When they reply positively

Match their tone. Remind them of context only if you need to. Offer one small next
step. **Then call them right away, within 1 to 5 minutes.**

> `Awesome, glad to hear it. Trying you now real quick. If I miss you, does later today or tomorrow AM work better?`

### 3d. The 5-minute phone call

1. **Opener:** "Hey Mike, it's Brian, we were just texting. Got a quick sec?"
2. **Intent:** "Not pitching anything yet. I just want to see if this even fits how you run things."
3. **Qualify and find the pain (2 or 3 questions):**
   - "When you're on a job and the phone rings, what happens to that call?"
   - "Roughly how many calls a week do you think go to voicemail?"
   - "What's an average job worth to you?"
4. **Value bridge:** "Got it. So if even one of those turns into a job, that's $X. What we do is text every missed caller back in about 10 seconds, answer their questions, and get their name, job and best time to you. Easier to show you than explain."
5. **Book it:** "Are you free later today, or would tomorrow morning work better?" Book the soonest slot you can. Booking 3 or more days out kills your show rate.

**Optional live demo:** text a demo AI Front Desk number from the call while they
watch. Seeing it work is the strongest proof you have.

### 3e. Warm follow-ups (they said yes but haven't booked)

Send 8 texts and make 8 calls, every other day, for 14 days. Keep each text to one
line, don't re-pitch, and end every text with "today or tomorrow?"

1. `Hey Mike, just tried giving you a ring. Can I call back later today or tomorrow?`
2. `Still good for a quick chat about the missed-call thing? Today or tomorrow?`
3. `I know you're slammed. When's best to call, morning or afternoon?`
4. `Bumping this up, Mike.`
5. `Can make 10 min tomorrow for you. AM or PM?`
6. `Still want me to set this up on your line?`
7. `Hey Mike, should I keep a spot open this week or check back later?`
8. `Last nudge from me. Want me to circle back next month instead?`

Voicemail: *"Hey Mike, it's Brian, calling back about our texts on catching missed
calls for Ridgeline. Call or text me when you can."*

If there's still no reply after 2 or 3 weeks, tag them `reactivation`. At the end of
each month, send them: `Hey Mike, following up from last month. Still open to a quick chat about missed calls?`

---

## 4. Objections (Recognize → Relate → Redirect)

| They say | What's really going on | Reply |
|---|---|---|
| "Who is this? How'd you get my number?" | Trust | "Totally fair. I'm Brian, I'm local in Fishers and work with a few contractors around Indy. Got your number off your Google listing. Do you ever miss calls while you're on a job?" |
| "Not interested" | Timing or they don't see the need | "All good. I haven't given you a reason to be yet. Just curious, are you not looking to take on more work right now?" |
| "Too busy" | Timing | "Figured, which is kind of the point. This is built for guys who can't get to the phone. Mornings or afternoons better for 10 min?" |
| "I have an answering service / my wife answers" | They think they already have it covered | "Makes sense, most people do. Does anyone catch the 8pm and Sunday calls? That's usually where the jobs slip through. Worth 10 min to check?" |
| "Send me info" | Stalling | "Happy to, but it's way faster to show you. Can I text your line a test right now and you see what your customers would get?" |
| "What does it cost?" | Worried about cost or risk | "Depends on the setup, but one saved job usually covers it many times over. Roughly how many calls a week go to voicemail?" *(This moves them into qualifying questions.)* |
| "Tried agencies, they suck" | Trust | "Heard that a lot. Not an agency. There are no ads, it just answers your phone when you can't. What went wrong last time?" |

Handle an objection **once** and then move on. If someone is rude or says stop, mark
them **DND** right away and never contact them again.

Keep an objection log with four columns: objection, count, reply used, outcome.
Don't change a reply until you've used it 30 to 50 times.

---

## 5. Numbers to plan around

| Metric | Planning number | Good |
|---|---|---|
| Appointment booking rate (ABR = booked ÷ sent) | **1%** | 2% or more |
| Positive reply rate | — | 5% or more |
| Positive reply → booked | — | 40% or more |
| Delivery | 90% | — |

**Working backwards:** 20 booked calls a month at 1% ABR means about **2,000 to 2,500
texts a month**, roughly 100 to 125 every weekday. At a 20% close rate that's about 4
clients a month.

Track these four numbers every day: **sent, replies, positive replies, booked.**
Review weekly, but give it 2 weeks before judging, because the warm follow-up
sequence lags. Change only one variable at a time.

---

## 6. GoHighLevel setup (fronthalo sub-account)

The fronthalo sub-account (`BjB46xGWbqptCmiilMpx`) is already connected. See
[GOHIGHLEVEL.md](GOHIGHLEVEL.md).

1. **A2P 10DLC.** Settings → Phone System → Trust Center → Start A2P verification.
   Pick **Low Volume Standard → Low Volume Mixed**. Use your real EIN, address,
   domain, an email on your domain, and privacy and terms pages. Approval takes a
   few days, and you can't send until it's approved.
2. **Number.** Buy a **317 or 463** local number, since the targets are around Indy.
   Label it, e.g. `Indy-1`. Add numbers as you scale, up to about 150 texts per
   number per day. Warm new numbers for 7 to 10 days at low volume.
3. **Tags:** `cold-sent`, `interested`, `booked`, `not-interested`,
   `reactivation`, plus a source tag per import (e.g. `gmaps-carmel-roofing-2026-10`).
4. **Workflow "Cold SMS Drip"** (Automations → Workflows):
   Send SMS (two-liner) → Wait 2h → Send SMS (FU1) → Wait 22h → Send SMS (FU2).
   Settings: allow re-entry **off**, stop on response **on**, send window about
   9am to 6pm in the *prospect's* time zone (Eastern), daily limit **100 to 150**.
5. **Sending a batch:** Contacts → filter by tag or date added → select → Add to
   automation → this workflow → **drip mode, 1 message every 5 minutes, Mon–Fri**.
6. **Speed to lead:** install the LeadConnector app and turn on reply
   notifications. Call from the app so you call from the same number you texted from.
7. **Daily routine:**
   1. Reply to unread conversations in under 5 minutes.
   2. Work the warm follow-up list.
   3. Check the workflow's enrollment history. If it's empty you're out of leads; if
      messages are failing, check the number's health.

## 6b. Getting and cleaning leads

- **Source:** Google Maps (free scraping) or Apollo plus Scraper City. Start
  **city by city** (Fishers, Carmel, Noblesville, Westfield, Zionsville) before
  going statewide.
- **Clean before importing:**
  - Spot-check 30 rows each from the top, middle and bottom of the list.
  - Run the list through **clearoutphone.io** and keep only **mobile** numbers.
  - Remove duplicates.
  - Format phones as `+13175550100` with no spaces or dashes.
  - Leave empty fields blank. Never write "N/A".
- **CSV columns:** `First Name, Last Name, Company Name, Phone, Website, City, State`.
- Always keep **2 weeks of leads** ready to send.

---

## 7. Compliance (read this before sending)

The guide's rules: identify yourself, don't deceive, honor STOP immediately, no
links in the opener, respect quiet hours, write every message as if a regulator will
read it, and keep an audit trail (list source, import date, send dates, opt-outs).

There are risks the video glosses over:
- **The TCPA covers business cell phones too.** Automated texts to wireless numbers
  without consent can carry statutory damages per message.
- **A2P/10DLC registration asks you to describe how recipients opted in.** Scraped
  numbers didn't opt in. Carriers can suspend the campaign or number if they detect
  unsolicited traffic, and a burned number doesn't recover quickly.
- **Indiana's Do Not Call law counts texts to cell phones as sales calls.** Penalties are $10k for the first violation and $25k for each one after. See §0.

Ways to lower the risk:
- Keep volume low.
- Send one-to-one manual texts while you test.
- Personalize each message.
- Mark DND on any negative reply.
- Check numbers against the DNC list.
- Get a short consult with a TCPA attorney before scaling past a few hundred texts
  a day.

---

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Many failed/undelivered | Unregistered number, too much volume, landlines, bad format | A2P-registered numbers only, ≤150/day/number, rotate 3–5 numbers, vary wording, mobile-only list, `+1` format |
| Replies but few bookings | Slow speed to lead or weak follow-up | Call within 5 min, run the full 16-touch warm sequence |
| Few replies | Generic opener, weak niche or list | Make it more local and specific, re-check the list, A/B test the opener |
| Data you can't read | Not tracking, or changing everything at once | Use the daily tracker, change one variable per week |

---

## Sources (researched 2026-10-12)

Most of these are vendor sources. Confirm anything legal against the FCC, the Indiana AG and IC 24-4.7.

- [Indiana AG: Do Not Call](https://www.in.gov/attorneygeneral/consumer-protection-division/id-theft-prevention/do-not-call) · [FAQs](https://www.in.gov/attorneygeneral/consumer-protection-division/id-theft-prevention/do-not-call/faqs/)
- [SMS compliance 2026: TCPA, A2P 10DLC, state mini-TCPAs](https://beancount.io/blog/2026/06/04/tcpa-a2p-10dlc-sms-marketing-compliance-2026-small-business-text-program-the-campaign-registry-consent-stop-help-keyword-state-mini-tcpa-florida-ftsa-texas-sb140-guide)
- [TCPA & carrier restrictions 2026](https://subscriberverify.com/blog/tcpa-sms-carrier-restrictions-cold-calling-2026) · [Is cold texting illegal? (2026)](https://vocalxlabs.com/blog/is-cold-texting-real-estate-legal/)
- [Home services missed-call statistics 2026](https://stealthagents.com/research/home-services-missed-call-revenue-statistics-2026) · [Signpost: contractor missed calls](https://www.signpost.com/blog/how-much-business-do-contractors-lose-from-missed-calls/) · [HVAC/plumbing call stats 2026](https://ainora.lt/blog/hvac-service-call-statistics-2026)
- [Cold outreach reply-rate benchmarks](https://danishleadco.io/blog/b2b-outbound-benchmarks) · [Belkins B2B benchmarks](https://belkins.io/resources/b2b-cold-email-benchmarks)
- Source guide: Charlie Morgan, "Cold SMS Full Guide" (YouTube)
