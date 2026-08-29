# AI Front Desk — Setup Guide (No Coding Experience Needed)

This is the working software for your first "AI Front Desk" product: it texts back
every missed call instantly, answers questions about the business, and captures
leads (name, service needed, preferred time) automatically.

You will NOT need to write any code. You're just filling in accounts and pasting
keys. Budget about 45-60 minutes for your first setup.

---

## STEP 1 — Get an Anthropic API key (the "brain")

1. Go to https://console.anthropic.com and create an account (or log in).
2. Click "API Keys" in the left menu, then "Create Key."
3. Copy the key somewhere safe — you'll paste it in Step 4.
4. Add a small amount of billing credit ($10-20 is plenty to start testing).

## STEP 2 — Get a Twilio account (the "phone line")

1. Go to https://www.twilio.com/try-twilio and sign up.
2. Buy a phone number: Console → Phone Numbers → Buy a Number. Pick one with
   SMS + Voice capability in your client's area code. (~$1.15/month per number)
3. From the Twilio Console home page, copy your **Account SID** and **Auth Token**
   — you'll need both in Step 4.

## STEP 3 — Put the code online (so Twilio can reach it)

You need somewhere for this code to "live" so it's always on. The easiest free
option for testing is **Railway** (railway.app):

1. Go to https://railway.app and sign up (you can use your GitHub account).
2. Click "New Project" → "Deploy from GitHub repo." (If you don't have GitHub yet,
   create a free account at github.com, make a new repository called
   "ai-front-desk," and upload all the files from this folder to it.)
3. Railway will detect it's a Node.js app and start building it automatically.

## STEP 4 — Add your secret keys to Railway

1. In your Railway project, click the "Variables" tab.
2. Add these four variables (paste the real values, no quotes):
   - `ANTHROPIC_API_KEY` → from Step 1
   - `TWILIO_ACCOUNT_SID` → from Step 2
   - `TWILIO_AUTH_TOKEN` → from Step 2
   - `TWILIO_PHONE_NUMBER` → your new Twilio number, format +1XXXXXXXXXX
3. Railway will redeploy automatically. Once it's done, click "Settings" →
   "Generate Domain" to get a public web address, e.g.
   `https://ai-front-desk-production.up.railway.app`

## STEP 5 — Connect Twilio to your live software

1. Back in Twilio Console → Phone Numbers → your number → "Configure."
2. Under "A Message Comes In," set the webhook to:
   `https://YOUR-RAILWAY-DOMAIN/webhook/sms` (method: HTTP POST)
3. Under Voice settings, set "Call Status Changes" webhook to:
   `https://YOUR-RAILWAY-DOMAIN/webhook/missed-call` (method: HTTP POST)
   (This is what fires the auto-text when a call isn't picked up.)
4. Save.

## STEP 6 — Customize for your client

Open `config/business-config.json` and edit these fields for the specific client
(this is the ONLY file that changes between clients — the rest of the code is
reused as-is):

- `businessName`, `niche`, `services`, `serviceArea`, `hours`, `tone`
- `missedCallMessage` — the exact text sent when a call is missed

Save, push the change to GitHub, and Railway redeploys automatically within
about a minute.

## STEP 7 — Test it

1. Text your new Twilio number from your own phone: "Hi, how much for a roof
   inspection?"
2. You should get an AI-generated reply within a few seconds, on-brand for the
   business you configured.
3. Call the number and let it ring out (don't answer) — you should get an
   automatic follow-up text within a minute.
4. Check captured leads any time by visiting:
   `https://YOUR-RAILWAY-DOMAIN/leads`

## STEP 8 — Forward the client's real business line (optional, for real deployment)

Most local businesses want to keep their existing number. Two options:
- **Call forwarding**: forward their existing number to the Twilio number on
  "no answer" (their phone provider or a $10/mo forwarding service can do this).
- **New number**: give them the Twilio number directly as a secondary "text us"
  line advertised on the website you already build them.

---

## Using this for MULTIPLE clients

Right now this is one config = one deployment. When you're ready to sell this to
several clients at once, the fastest path is: duplicate this whole project folder
per client (each with its own Twilio number and its own `business-config.json`),
and deploy each as a separate Railway project. It's simple, it works, and it's
plenty for your first 5-10 clients. Once you're past that, this is worth
rebuilding as one shared app with a client-picker — that's a good problem to have.

## Extending this with Claude Code

Everything in this folder was generated in this chat. Going forward, the fastest
way to keep improving it — add a booking calendar, add email notifications when a
lead comes in, add the Reputation Autopilot or Content Autopilot products we
talked about — is to open this folder in **Claude Code** (a coding tool that runs
on your computer or via the Claude app) and just describe what you want changed
in plain English, e.g. "add a feature that emails me every time a new lead is
captured." Claude Code will write and test the code for you the same way this
was built.
