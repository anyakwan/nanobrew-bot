# Tripleseat Inquiry Auto-Responder

Listens for new Tripleseat leads (event inquiries) via webhook and posts an
instant auto-reply back into Tripleseat as a note on the lead.

## 1. Install

```bash
npm install
cp .env.example .env
```

Fill in `.env` with the credentials from your Tripleseat account
(**Settings → API / Webhooks**):
- `TRIPLESEAT_WEBHOOK_SECRET` — shown when you create the webhook
- `TRIPLESEAT_CLIENT_ID` / `TRIPLESEAT_CLIENT_SECRET` — OAuth 2.0 app credentials

## 2. Confirm the API details for your account

Open **Settings → API → Documentation** inside Tripleseat and check:
- The exact path/payload for "add a note to a lead" (used in `addNoteToLead`
  in `server.js` — the path there is a placeholder and needs confirming).
- The exact shape of the `CREATE_LEAD` webhook payload (field names can vary
  slightly by account/version) — adjust `buildReplyMessage` accordingly.

## 3. Run locally

```bash
npm start
```

This starts a server on port 3000 (or whatever you set `PORT` to) with a
webhook endpoint at `/webhooks/tripleseat`.

To test locally before deploying, expose your local server with a tool like
ngrok (`ngrok http 3000`) and use the ngrok URL as your webhook URL in
Tripleseat while testing.

## 4. Deploy

Any Node hosting works (Render, Railway, Fly.io, an EC2 box, etc). Whatever
you pick:
1. Deploy this code with your `.env` variables set as environment variables.
2. Copy the public HTTPS URL, e.g. `https://your-app.onrender.com`.
3. In Tripleseat, set the webhook URL to
   `https://your-app.onrender.com/webhooks/tripleseat` and enable the
   `CREATE_LEAD` trigger.

## 5. Customize the reply

Right now `buildReplyMessage()` in `server.js` uses a simple template. To
make replies smarter (e.g. referencing guest count, event type, or venue
availability), you could:
- Pull more fields out of the `lead` object in the webhook payload
- Call an LLM (like Claude via the Anthropic API) inside `buildReplyMessage`
  to draft a more personalized response before posting it as a note
