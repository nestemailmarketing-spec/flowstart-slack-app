import express from "express";
import crypto from "crypto";

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Raw body capture for Slack signature verification ───────────────────────
app.use((req, res, next) => {
  let data = [];
  req.on("data", (chunk) => data.push(chunk));
  req.on("end", () => {
    req.rawBody = Buffer.concat(data);
    req.body = {};
    const ct = req.headers["content-type"] || "";
    if (ct.includes("application/x-www-form-urlencoded")) {
      const parsed = new URLSearchParams(req.rawBody.toString());
      for (const [k, v] of parsed.entries()) req.body[k] = v;
    } else if (ct.includes("application/json")) {
      try { req.body = JSON.parse(req.rawBody.toString()); } catch {}
    }
    next();
  });
});

// ─── Slack Signature Verification ────────────────────────────────────────────
function verifySlackSignature(req) {
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret) return true;
  const ts = req.headers["x-slack-request-timestamp"];
  const sig = req.headers["x-slack-signature"];
  if (!ts || !sig) return false;
  if (Math.abs(Date.now() / 1000 - parseInt(ts)) > 300) return false;
  const base = `v0:${ts}:${req.rawBody.toString()}`;
  const computed = "v0=" + crypto.createHmac("sha256", secret).update(base).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(sig));
  } catch {
    return false;
  }
}

// ─── PandaDoc: Create & Send Document ────────────────────────────────────────
async function createAndSendDocument({ fullName, email, roleTitle, paymentAmount, responsibilities, startDate, sentDate }) {
  const apiKey = process.env.PANDADOC_API_KEY;
  if (!apiKey) throw new Error("PANDADOC_API_KEY not set");

  const TEMPLATE_ID = "LHJmXEwL4GGakDpNLbm2dB";
  const BASE = "https://api.pandadoc.com/public/v1";

  const headers = {
    "Authorization": `API-Key ${apiKey}`,
    "Content-Type": "application/json",
  };

  // Step 1: Create document from template
  const createRes = await fetch(`${BASE}/documents`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: `NEST Employee Agreement - ${fullName}`,
      template_uuid: TEMPLATE_ID,
      recipients: [{
        email,
        first_name: fullName.split(" ")[0] ?? fullName,
        last_name: fullName.split(" ").slice(1).join(" ") || "",
        role: "Client",
      }],
      tokens: [
        { name: "Document.SentDate", value: sentDate },
        { name: "Payment.Amount", value: paymentAmount },
        { name: "Responsibilities", value: responsibilities },
        { name: "Role.Title", value: roleTitle },
      ],
      metadata: { startDate },
    }),
  });

  if (!createRes.ok) {
    const err = await createRes.text().catch(() => "");
    throw new Error(`PandaDoc create error ${createRes.status}: ${err}`);
  }

  const created = await createRes.json();
  const docId = created.id;

  // Step 2: Poll until document is in draft status
  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const statusRes = await fetch(`${BASE}/documents/${docId}`, { headers });
    if (statusRes.ok) {
      const doc = await statusRes.json();
      if (doc.status === "document.draft") break;
    }
  }

  // Step 3: Send for e-signature
  const sendRes = await fetch(`${BASE}/documents/${docId}/send`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      message: `Hi ${fullName}, please review and sign your NEST Employee Agreement.`,
      silent: false,
    }),
  });

  if (!sendRes.ok) {
    const err = await sendRes.text().catch(() => "");
    throw new Error(`PandaDoc send error ${sendRes.status}: ${err}`);
  }

  return docId;
}

// ─── Slack API Helpers ────────────────────────────────────────────────────────
async function slackPost(endpoint, body) {
  const res = await fetch(`https://slack.com/api/${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function openModal(triggerId) {
  return slackPost("views.open", {
    trigger_id: triggerId,
    view: {
      type: "modal",
      callback_id: "employee_intake_modal",
      title: { type: "plain_text", text: "New Employee Intake", emoji: true },
      submit: { type: "plain_text", text: "Send Agreement", emoji: true },
      close: { type: "plain_text", text: "Cancel", emoji: true },
      blocks: [
        {
          type: "input",
          block_id: "full_name",
          label: { type: "plain_text", text: "Full Name" },
          element: {
            type: "plain_text_input",
            action_id: "value",
            placeholder: { type: "plain_text", text: "e.g. Jordan Smith" },
          },
        },
        {
          type: "input",
          block_id: "email",
          label: { type: "plain_text", text: "Email Address" },
          element: {
            type: "plain_text_input",
            action_id: "value",
            placeholder: { type: "plain_text", text: "e.g. jordan@example.com" },
          },
        },
        {
          type: "input",
          block_id: "role_title",
          label: { type: "plain_text", text: "Role / Job Title" },
          element: {
            type: "plain_text_input",
            action_id: "value",
            placeholder: { type: "plain_text", text: "e.g. Senior Designer" },
          },
        },
        {
          type: "input",
          block_id: "payment_amount",
          label: { type: "plain_text", text: "Payment Amount" },
          element: {
            type: "plain_text_input",
            action_id: "value",
            placeholder: { type: "plain_text", text: "e.g. $5,000/month" },
          },
        },
        {
          type: "input",
          block_id: "start_date",
          label: { type: "plain_text", text: "Start Date" },
          element: {
            type: "datepicker",
            action_id: "value",
            placeholder: { type: "plain_text", text: "Select a date" },
          },
        },
        {
          type: "input",
          block_id: "responsibilities",
          label: { type: "plain_text", text: "Responsibilities" },
          element: {
            type: "plain_text_input",
            action_id: "value",
            multiline: true,
            placeholder: {
              type: "plain_text",
              text: "Describe the employee's key responsibilities...",
            },
          },
        },
      ],
    },
  });
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// Health check
app.get("/", (req, res) => res.send("NEST Employee Intake Bot is running."));

// Slash command: /employee
app.post("/api/slack/employee", async (req, res) => {
  if (!verifySlackSignature(req)) {
    return res.status(401).send("Unauthorized");
  }

  const triggerId = req.body?.trigger_id;
  if (!triggerId) return res.status(400).send("Missing trigger_id");

  // Acknowledge immediately (Slack requires < 3s)
  res.status(200).send("");

  try {
    const result = await openModal(triggerId);
    if (!result.ok) {
      console.error("[Slack] views.open failed:", result.error);
    }
  } catch (err) {
    console.error("[Slack] Failed to open modal:", err);
  }
});

// Interactivity: modal submission
app.post("/api/slack/interactivity", async (req, res) => {
  if (!verifySlackSignature(req)) {
    return res.status(401).send("Unauthorized");
  }

  let payload;
  try {
    payload = JSON.parse(req.body?.payload);
  } catch {
    return res.status(400).send("Invalid payload");
  }

  if (
    payload.type !== "view_submission" ||
    payload.view?.callback_id !== "employee_intake_modal"
  ) {
    return res.status(200).send("");
  }

  // Acknowledge immediately
  res.status(200).json({ response_action: "clear" });

  const values = payload.view?.state?.values ?? {};
  const fullName = values?.full_name?.value?.value ?? "";
  const email = values?.email?.value?.value ?? "";
  const roleTitle = values?.role_title?.value?.value ?? "";
  const paymentAmount = values?.payment_amount?.value?.value ?? "";
  const startDate = values?.start_date?.value?.selected_date ?? "";
  const responsibilities = values?.responsibilities?.value?.value ?? "";
  const userId = payload.user?.id;

  const sentDate = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  console.log(`[Intake] Processing: ${fullName} <${email}>`);

  try {
    const docId = await createAndSendDocument({
      fullName, email, roleTitle, paymentAmount, responsibilities, startDate, sentDate,
    });

    console.log(`[Intake] PandaDoc sent: ${docId}`);

    // Post success confirmation to the user via DM
    if (userId) {
      await slackPost("chat.postMessage", {
        channel: userId,
        text: `✅ *NEST Employee Agreement sent!*\n*${fullName}* (${email}) has been sent their agreement for e-signature via PandaDoc.`,
      });
    }
  } catch (err) {
    console.error("[Intake] PandaDoc error:", err);
    if (userId) {
      await slackPost("chat.postMessage", {
        channel: userId,
        text: `❌ Failed to send the employee agreement for *${fullName}*. Error: ${err.message}`,
      });
    }
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`NEST Employee Intake Bot running on port ${PORT}`);
});
