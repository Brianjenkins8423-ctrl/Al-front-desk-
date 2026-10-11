# Using GoHighLevel with Claude — Quick Guide

## What's set up

This repo is connected to **GoHighLevel's official MCP server**. That means when
you open a Claude Code session on this repo, Claude can look things up (and make
changes) in your GoHighLevel account just by you asking in plain English.

| Setting | Value |
|---|---|
| Sub-account | **fronthalo** (Fishers, IN) |
| Location ID | `BjB46xGWbqptCmiilMpx` |
| Server address | `https://services.leadconnectorhq.com/mcp/` |
| Config file | `.mcp.json` (in the top folder of this repo) |
| Password / token | **None stored in the repo.** It is added automatically in Claude Code cloud sessions. |

Tested on 2026-10-11: it read the account name, 337 contacts, all 5 pipelines,
and the newest contacts successfully.

---

## How to use it (3 steps)

1. **Open a Claude Code session on this repo** (claude.ai/code, the Claude app, or desktop).
2. If Claude asks to **approve the "gohighlevel" server**, say yes. You may also be asked
   to approve each action the first time. Approve read actions freely; read write actions carefully.
3. **Just ask.** You don't need any special commands. Examples below.

---

## Things you can ask

### Just looking (safe, nothing changes)

- "How many contacts do I have in GoHighLevel?"
- "Show me the 10 newest contacts with name and date added."
- "Find the contact named Robert Bourque and show his phone and tags."
- "List my pipelines and how many opportunities are in each stage."
- "Show open opportunities in the Sales Process pipeline."
- "What appointments are on my calendar this week?"
- "Show the last messages in my conversation with (463) 203-8036."
- "List my recent payment transactions."
- "Show my scheduled social media posts."
- "List my blog posts."

### Making changes (be careful, these are real)

- "Add the tag `hot-lead` to Mathew Stout."
- "Create a contact: Jane Doe, 317-555-0100, jane@example.com."
- "Move opportunity X to the Won stage."
- "Text Ondina Andino: 'Thanks for reaching out! When's a good time to call?'"
- "Draft a Facebook post about our spring special and schedule it for Friday 9am."

> **Tip:** Say *"read-only, don't change anything"* in your request when you only want
> to look. For changes, ask Claude to *"show me what you'll do first"* before it does it.

---

## Everything it can do

**Read only (safe)**

| Area | What it can look up |
|---|---|
| Account | Account details, custom fields |
| Contacts | Search/list contacts, one contact's details, tasks |
| Opportunities | Pipelines, search opportunities, one opportunity |
| Calendar | Calendar events, appointment notes |
| Conversations | Search conversations, read messages |
| Payments | List transactions, look up an order |
| Social media | Posts, connected accounts, statistics |
| Blogs | Blog posts, authors, categories, check a URL slug |
| Email | Fetch email templates |

**Can make changes (use with care)**

| Area | What it can change |
|---|---|
| Contacts | Create, update, upsert, add tags, remove tags |
| Opportunities | Update an opportunity (stage, value, status, etc.) |
| Conversations | **Send a real SMS/email to a customer** |
| Social media | Create and edit posts |
| Blogs | Create and update blog posts |
| Email | Create email templates |

It **cannot** delete contacts, delete opportunities, or change account settings.

---

## Important safety notes

- **Messages are real.** "Send a message" texts or emails an actual customer. Double-check before approving.
- **Everyone who uses this repo gets the same access** to the fronthalo account.
- **Never paste your GoHighLevel API key into the repo or a chat.** It isn't needed in the cloud.

---

## Using it on your own computer (optional)

In the cloud, login is automatic. On your own computer it isn't, so you'd need a token:

1. In GoHighLevel go to **Settings → Private Integrations** and create one
   (give it the scopes you want, e.g. contacts, opportunities, calendars).
2. Copy the token (starts with `pit-`).
3. Run this in a terminal (this saves it to *your* computer only, not the repo):

   ```bash
   claude mcp add --transport http gohighlevel-local https://services.leadconnectorhq.com/mcp/ \
     --header "Authorization: Bearer pit-YOUR-TOKEN" \
     --header "locationId: BjB46xGWbqptCmiilMpx"
   ```

---

## If something isn't working

| Problem | Fix |
|---|---|
| Claude says it has no GoHighLevel tools | Start a new session; approve the `gohighlevel` server when asked. Type `/mcp` to see its status. |
| "Unauthorized" / 401 error | In the cloud: check GoHighLevel is still connected in your Claude environment settings. Locally: your token expired or is missing a scope. |
| Wrong account's data | Check the `locationId` in `.mcp.json` is `BjB46xGWbqptCmiilMpx`. |
| Want to switch to another sub-account | Change the `locationId` in `.mcp.json` to that sub-account's ID and commit. |
