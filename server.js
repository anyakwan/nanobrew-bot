/**
 * Tripleseat Inquiry Auto-Responder
 * ----------------------------------
 * Listens for Tripleseat webhook events (new lead / inquiry created),
 * verifies the request signature, generates a reply, and posts that
 * reply back into Tripleseat as a note on the lead.
 *
 * SETUP REQUIRED (Tripleseat side):
 *   1. Log into Tripleseat -> Settings -> API / Webhooks
 *   2. Create a new Webhook, check "CREATE_LEAD" as the trigger,
 *      and set the URL to: https://<your-server>/webhooks/tripleseat
 *   3. Copy the Webhook Signing Secret shown there into TRIPLESEAT_WEBHOOK_SECRET below.
 *   4. Under Settings -> API, set up OAuth 2.0 credentials (client id/secret)
 *      and copy them into TRIPLESEAT_CLIENT_ID / TRIPLESEAT_CLIENT_SECRET.
 *
 * IMPORTANT: The exact endpoint/path for "add a note to a lead" is account
 * and API-version specific. Open Settings -> API -> Documentation in your
 * own Tripleseat account, find the Leads or Notes resource, and confirm the
 * path/method against the `addNoteToLead` function below before going live.
 */

const express = require("express");
const crypto = require("crypto");
require("dotenv").config();

const app = express();

// Tripleseat needs the raw request body to verify the signature,
// so capture it before JSON parsing.
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);

const {
  TRIPLESEAT_WEBHOOK_SECRET,
  TRIPLESEAT_CLIENT_ID,
  TRIPLESEAT_CLIENT_SECRET,
  TRIPLESEAT_API_BASE = "https://api.tripleseat.com",
  PORT = 3000,
} = process.env;

// ---------------------------------------------------------------------------
// 1. Verify the webhook came from Tripleseat
// ---------------------------------------------------------------------------
function verifySignature(req) {
  const signatureHeader = req.get("X-Signature");
  if (!signatureHeader || !req.rawBody) return false;

  const expected = crypto
    .createHmac("sha256", TRIPLESEAT_WEBHOOK_SECRET)
    .update(req.rawBody)
    .digest("hex");

  // Constant-time comparison to avoid timing attacks
  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// 2. Get an OAuth 2.0 access token (client-credentials flow)
//    Cached in memory and refreshed shortly before it expires.
// ---------------------------------------------------------------------------
let cachedToken = null;
let tokenExpiresAt = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) {
    return cachedToken;
  }

  const res = await fetch(`${TRIPLESEAT_API_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: TRIPLESEAT_CLIENT_ID,
      client_secret: TRIPLESEAT_CLIENT_SECRET,
    }),
  });

  if (!res.ok) {
    throw new Error(`Failed to get access token: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in ?? 3600) * 1000;
  return cachedToken;
}

// ---------------------------------------------------------------------------
// 3. Build the auto-reply text
//    Every inquiry is different (wedding vs. corporate, different guest
//    counts, different questions), so instead of a fixed template we send
//    the lead's details to Claude and get back a tailored reply.
// ---------------------------------------------------------------------------
const VENUE_CONTEXT = `
You are Anya, replying to private event inquiries on behalf of Nano Brew.
Match the tone and structure of the example reply below: warm, personal,
a little excited about hosting them, and detail-oriented. Sign off as
"Regards, Anya".

Always include, when known: which space fits their group, its capacity,
a short description of the space, the rental fee, the food & beverage
minimum, that a 20% service charge and 8% tax apply, and that a 50%
deposit (of rental + F&B minimum) is required to secure the date. Mention
that food cost depends on the menu selected, and briefly explain the bar
options (hosted with a cap, limited selection, or guests pay their own).
Offer to send the event menu / photos and offer an in-person walkthrough.

If you don't have a firm rental fee or F&B minimum for this specific
inquiry, calculate it using the PRICING RULES below based on the event's
day of week and guest count. Do not invent numbers outside these rules.
Do not invent availability, space names, or capacities not listed below.

--- PRICING RULES (apply to all spaces unless a space says otherwise) ---
Rental fee: $250 if the event is on a Wednesday or Thursday.
            $500 if the event is on a Friday, Saturday, or Sunday.
Food & beverage minimum: $30 per guest, multiplied by the guest count,
            rounded to a whole dollar total (e.g. 40 guests = $1,200).
If the day of week isn't known yet, give both the Wed/Thu and Fri-Sun
rental numbers and ask which day they're considering.

--- SPACES AT NANO BREW ---
Handle Bar: private, center room of Nano Brew. Exposed brick walls, full
bar, views into the open kitchen, expansive windows facing W25th St.
Seats 40, up to 60 with mixed seated/standing.

Pedal Bar: back room of Nano Brew. Handcrafted wood bar, ceiling-high
vintage mirrors, its own restroom, small outdoor veranda.
Seats 30, up to 50 standing.

--- EXAMPLE REPLY 1 (Handle Bar, match this style) ---
Thank you for thinking of us for this special event!

We do have a space available at Nano Brew that evening that would be a
great fit for your group, it's called the Handle Bar.

The Handle Bar is a private space with seating for 40 guests and can
accommodate up to 60 with a mix of seated/standing. The Handle Bar is the
center room of Nano Brew. This space features exposed brick walls, a full
bar, views into the open kitchen and expansive windows facing W25th St.

The Handle Bar is available that evening with a rental fee of $FEE, plus
a food and beverage minimum of $F&B, a 20% service charge and 8% tax.

A 50% deposit of the food & beverage minimum + rental fee is required to
secure the reservation.

Please see below for links to an event menu and a photo of the space for
your reference.

Food cost is based on the menu selected.

Drinks at the bar are tallied on consumption. We have a full selection of
beer, wine, and spirits to choose from. You have the option of doing a
hosted bar, with which you are welcome to limit the options available at
the bar or set a maximum bar total to keep consumption within your
budget. Or if you prefer, you can have your guests take care of their own
drinks. Whichever way you choose, all beverages purchased would apply
toward the food and beverage minimum.

Please let me know your thoughts, questions and if you'd like to meet at
the space in person to discuss options/details. I am happy to help and
hope we can host your event at Nano Brew!

--- EXAMPLE REPLY 2 (Pedal Bar, match this style) ---
Thank you for thinking of us for this special event!

We do have a space available at Nano Brew that evening, it's called the
Pedal Bar.

The Pedal Bar is the back room of Nano Brew. It has a handcrafted wood
bar, ceiling high vintage mirrors and its own restroom. The Pedal Bar has
a small outdoor veranda. The Pedal Bar can accommodate 30 seated guests
or 50 standing.

The Pedal Bar is available that evening with a rental fee of $FEE, plus a
food and beverage minimum of $F&B, a 20% service charge and 8% tax.

A 50% deposit of the food & beverage minimum + rental fee is required to
secure the reservation.

Attached here is an event menu and a photo of the space for your
reference.

Food cost is based on the menu selected. Drinks at the bar are tallied on
consumption. We have a full selection of beer, wine, and spirits to
choose from. You have the option of doing a hosted bar, with which you
are welcome to limit the options available at the bar or set a maximum
bar total to keep consumption within your budget. Or if you prefer, you
can have your guests take care of their own drinks. Whichever way is
chosen, all beverages purchased count toward the food and beverage
minimum.

Please let me know your thoughts, questions and if you'd like to meet at
the space in person to discuss options/details. I am happy to help and
hope we can host your event at Nano Brew!
`.trim();

async function buildReplyMessage(lead) {
  const leadDetails = {
    name: lead?.first_name,
    event_type: lead?.event_type,
    event_date: lead?.event_date,
    guest_count: lead?.guest_count,
    message: lead?.message || lead?.notes, // the actual inquiry text, if present
  };

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 400,
      system: VENUE_CONTEXT,
      messages: [
        {
          role: "user",
          content: `New event inquiry details (JSON):\n${JSON.stringify(
            leadDetails,
            null,
            2
          )}\n\nWrite the reply now.`,
        },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`Claude API error: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  const text = data.content
    ?.filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();

  // Fallback in case generation fails for some reason
  return (
    text ||
    `Hi ${leadDetails.name || "there"}, thanks for your inquiry! Our team will follow up shortly with full details.`
  );
}

// ---------------------------------------------------------------------------
// 4. Email the reply directly to the person who inquired (via Resend)
// ---------------------------------------------------------------------------
async function emailLead(lead, message) {
  const toEmail = lead?.email || lead?.contact_email;
  if (!toEmail) {
    throw new Error("No email address found on this lead, cannot send reply.");
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: process.env.FROM_EMAIL, // e.g. "Anya <anya@yourdomain.com>"
      to: toEmail,
      subject: "Your Nano Brew event inquiry",
      text: message,
    }),
  });

  if (!res.ok) {
    throw new Error(`Resend error: ${res.status} ${await res.text()}`);
  }

  return res.json();
}

// ---------------------------------------------------------------------------
// 5. Webhook endpoint
// ---------------------------------------------------------------------------
app.post("/webhooks/tripleseat", async (req, res) => {
  if (!verifySignature(req)) {
    return res.status(401).send("Invalid signature");
  }

  // Respond immediately so Tripleseat doesn't retry/timeout while
  // we do the (slower) work of calling the API back.
  res.status(200).send("OK");

  const { webhook_trigger_type, lead, event } = req.body || {};

  if (webhook_trigger_type !== "CREATE_LEAD") {
    return; // Only auto-respond to brand-new inquiries
  }

  try {
    const leadId = lead?.id ?? event?.lead_id;
    if (!leadId) {
      console.warn("No lead id found on payload, skipping:", req.body);
      return;
    }

    const message = await buildReplyMessage(lead);
    await emailLead(lead, message);
    console.log(`Emailed reply for lead ${leadId}`);
  } catch (err) {
    console.error("Failed to process inquiry:", err);
    // Consider adding retry logic or alerting yourself here
  }
});

app.get("/healthz", (req, res) => res.send("ok"));

app.listen(PORT, () => {
  console.log(`Tripleseat auto-responder listening on port ${PORT}`);
});
