// FlowStart — Slack Modal App (HTTP Server for Railway)
// Identical architecture to /intake — HTTP server that handles Slack slash commands
// and modal interactions via signed requests.
// ─────────────────────────────────────────────────────────────────────────────
require('dotenv').config();
const express    = require('express');
const crypto     = require('crypto');
const bodyParser = require('body-parser');
const { WebClient } = require('@slack/web-api');

const app    = express();
const slack  = new WebClient(process.env.SLACK_BOT_TOKEN);
const PORT   = process.env.PORT || 3000;

// ─── TEAM MEMBERS ─────────────────────────────────────────────────────────────
const TEAM = [
  { text: { type: 'plain_text', text: 'Umar (Head)' },             value: 'U01JCEF5799' },
  { text: { type: 'plain_text', text: 'Ryan (Head of Strategy)' }, value: 'U06NJUHB2FR' },
  { text: { type: 'plain_text', text: 'Frankee (CSM)' },           value: 'U0AAW2GF69X' },
  { text: { type: 'plain_text', text: 'Honeylyn (KAM/REV)' },      value: 'U021KG1NDBR' },
  { text: { type: 'plain_text', text: 'John (KAM)' },              value: 'U09ABH1HN01' },
  { text: { type: 'plain_text', text: 'Darren (JEC)' },            value: 'U049H7UHABG' },
  { text: { type: 'plain_text', text: 'Mercy (JEC)' },             value: 'U03TUQQ9KHB' },
  { text: { type: 'plain_text', text: 'Jan (JEC)' },               value: 'U0AADHSVBU7' },
  { text: { type: 'plain_text', text: 'Mishka (JGD)' },            value: 'U05UUUHE34J' },
  { text: { type: 'plain_text', text: 'Rizhlee (JGD)' },           value: 'U09NCBU4CV8' },
  { text: { type: 'plain_text', text: 'Eric (JGD)' },              value: 'U07A3A1SKDH' },
  { text: { type: 'plain_text', text: 'Erin (JGD)' },              value: 'U07K22LBKSN' },
  { text: { type: 'plain_text', text: 'Rochelle (JGD)' },          value: 'U045PDEQW59' },
  { text: { type: 'plain_text', text: 'Ryann (JGD)' },             value: 'U0532K3SXLP' },
  { text: { type: 'plain_text', text: 'Pierce (JGD)' },            value: 'U04KJB761QR' },
  { text: { type: 'plain_text', text: 'Shantal (JGD)' },           value: 'U09911YKNEB' },
];

// ─── SIGNATURE VERIFICATION ───────────────────────────────────────────────────
function verifySlackSignature(req) {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  const timestamp     = req.headers['x-slack-request-timestamp'];
  const slackSig      = req.headers['x-slack-signature'];
  if (!timestamp || !slackSig) return false;
  // Reject requests older than 5 minutes
  if (Math.abs(Date.now() / 1000 - timestamp) > 300) return false;
  const rawBody = req.rawBody || '';
  const sigBase = `v0:${timestamp}:${rawBody}`;
  const myHash  = 'v0=' + crypto.createHmac('sha256', signingSecret).update(sigBase).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(myHash), Buffer.from(slackSig));
}

// ─── BODY PARSER (preserve rawBody for signature verification) ────────────────
app.use(bodyParser.urlencoded({
  extended: true,
  verify: (req, res, buf) => { req.rawBody = buf.toString(); },
}));
app.use(bodyParser.json({
  verify: (req, res, buf) => { req.rawBody = buf.toString(); },
}));

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.send('FlowStart is running ✅'));

// ─── /flowstart SLASH COMMAND → OPEN MODAL ───────────────────────────────────
app.post('/flowstart', async (req, res) => {
  if (!verifySlackSignature(req)) {
    return res.status(401).send('Unauthorized');
  }
  // Respond immediately (Slack requires < 3s)
  res.status(200).send('');

  try {
    await slack.views.open({
      trigger_id: req.body.trigger_id,
      view: buildModal(),
    });
    console.log('✅ Modal opened for', req.body.user_id);
  } catch (err) {
    console.error('❌ Failed to open modal:', err.message);
  }
});

// ─── INTERACTIVITY ENDPOINT (modal submission) ────────────────────────────────
app.post('/slack/interactions', async (req, res) => {
  if (!verifySlackSignature(req)) {
    return res.status(401).send('Unauthorized');
  }
  // Respond immediately
  res.status(200).send('');

  let payload;
  try {
    payload = JSON.parse(req.body.payload);
  } catch (e) {
    console.error('❌ Failed to parse payload:', e.message);
    return;
  }

  if (payload.type !== 'view_submission' || payload.view.callback_id !== 'flowstart_modal') return;

  const v = payload.view.state.values;

  const brand_name    = v.brand_name_block.brand_name_input.value || '';
  const brand_url     = v.brand_url_block.brand_url_input.value || '';
  const offer         = v.offer_block.offer_input.value || '';
  const deadline      = v.deadline_block.deadline_input.value || '';
  const lead_kam_id   = v.lead_kam_block.lead_kam_select.selected_option?.value || '';
  const impl_id       = v.impl_block.impl_select.selected_option?.value || '';
  const copy_id       = v.copy_block.copy_select.selected_option?.value || '';
  const des_id        = v.des_block.des_select.selected_option?.value || '';
  const assets        = v.assets_block.assets_input.value || '';
  const notes         = v.notes_block?.notes_input?.value || '';

  // Format assets — each line becomes a bullet
  const assetLines = assets.split('\n').filter(l => l.trim());
  const formattedAssets = assetLines.length > 0
    ? assetLines.map(line => {
        const colonIdx = line.indexOf(':');
        if (colonIdx > 0) {
          const label = line.substring(0, colonIdx).trim();
          const rest  = line.substring(colonIdx + 1).trim();
          if (rest.startsWith('http')) return `• *${label}:* <${rest}>`;
        }
        if (line.trim().startsWith('http')) return `• <${line.trim()}>`;
        return `• ${line.trim()}`;
      }).join('\n')
    : '_No assets provided_';

  // ── #flows-creation message ──────────────────────────────────────────────
  const flowsMsg = [
    `<@${lead_kam_id}> make a set of NEW flows + popup + add codes + segments + SMS in the flows for :star: *${brand_name}* :star: — and have the popup similar to the others, you can clone off them a new account and add an SMS form on the second part before submission.`,
    ``,
    `:star: *THE OFFER: ${offer}* :star:`,
    ``,
    `Also, we want to design these flows to be very upscale with good headers and footers and hero images that fit the brand. Please use all the assets that have been provided below.`,
    ``,
    `*<@${impl_id}> Please add this into <#C02MRJQPA82> and please set up the ICP and VOC data docs*`,
    ``,
    `<@${lead_kam_id}> also, please make sure to include logical SMS parts into the flows once made. I have invited you to the account so you can add in the sign-up form, and more importantly, so you can take a look at their previous emails so you have a better understanding of how we want them designed — we are remaking these flows for the client, so let's make sure it's done correctly.`,
    ``,
    `<@${copy_id}> create 4 copies for this brand, NOT 2 like normal — 2 is a welcome series copy, talking about the brand and welcoming the customer to it and giving them the offer — another 2 copy specifically about the store and including customer reviews and how exclusive it is based on the brand and its benefits of the products.`,
    ``,
    `*<@${des_id}>* make them super on brand — please start on these designs when the copies are done. Thanks`,
    ``,
    formattedAssets,
    ``,
    `Deadline *${deadline}* :alert:`,
    ...(notes ? [``, `📝 *Notes:* ${notes}`] : []),
    ``,
    `cc: <@U01JCEF5799>`,
  ].join('\n');

  // ── DM to Umar — new client notification ────────────────────────────────
  const aliaMsg = [
    `🎉 *New Client Onboarded — ${brand_name}*`,
    ``,
    `A new client has been added and their flow brief has been kicked off in <#C02AY0YHR7A>.`,
    ``,
    `🌐 *Website:* <${brand_url}>`,
    ``,
    `🎁 *Offer:* ${offer}`,
    ``,
    `📅 *Deadline:* ${deadline}`,
  ].join('\n');

  // ── Post to Slack ────────────────────────────────────────────────────────
  try {
    await slack.chat.postMessage({ channel: 'C02AY0YHR7A', text: flowsMsg });
    console.log('✅ Posted to #flows-creation');
  } catch (err) {
    console.error('❌ flows-creation error:', err.message);
  }

  try {
    await slack.chat.postMessage({ channel: 'U01JCEF5799', text: aliaMsg });
    console.log('✅ DM sent to Umar');
  } catch (err) {
    console.error('❌ DM to Umar error:', err.message);
  }
});

// ─── MODAL DEFINITION ─────────────────────────────────────────────────────────
function buildModal() {
  return {
    type: 'modal',
    callback_id: 'flowstart_modal',
    title: { type: 'plain_text', text: '⚡ Flow Start Brief' },
    submit: { type: 'plain_text', text: 'Submit Brief' },
    close:  { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'input',
        block_id: 'brand_name_block',
        label: { type: 'plain_text', text: 'Brand Name' },
        element: {
          type: 'plain_text_input',
          action_id: 'brand_name_input',
          placeholder: { type: 'plain_text', text: 'e.g. Well Nature' },
        },
      },
      {
        type: 'input',
        block_id: 'brand_url_block',
        label: { type: 'plain_text', text: 'Website URL' },
        element: {
          type: 'plain_text_input',
          action_id: 'brand_url_input',
          placeholder: { type: 'plain_text', text: 'https://...' },
        },
      },
      {
        type: 'input',
        block_id: 'offer_block',
        label: { type: 'plain_text', text: 'The Offer' },
        element: {
          type: 'plain_text_input',
          action_id: 'offer_input',
          placeholder: { type: 'plain_text', text: 'e.g. 60% OFF + FREE STARTER KIT' },
        },
      },
      {
        type: 'input',
        block_id: 'deadline_block',
        label: { type: 'plain_text', text: 'Deadline' },
        element: {
          type: 'plain_text_input',
          action_id: 'deadline_input',
          placeholder: { type: 'plain_text', text: 'e.g. Friday EOD' },
        },
      },
      {
        type: 'input',
        block_id: 'lead_kam_block',
        label: { type: 'plain_text', text: 'Lead KAM' },
        element: {
          type: 'static_select',
          action_id: 'lead_kam_select',
          placeholder: { type: 'plain_text', text: 'Select team member...' },
          options: TEAM,
        },
      },
      {
        type: 'input',
        block_id: 'impl_block',
        label: { type: 'plain_text', text: 'Implementation' },
        element: {
          type: 'static_select',
          action_id: 'impl_select',
          placeholder: { type: 'plain_text', text: 'Select team member...' },
          options: TEAM,
        },
      },
      {
        type: 'input',
        block_id: 'copy_block',
        label: { type: 'plain_text', text: 'Copywriter' },
        element: {
          type: 'static_select',
          action_id: 'copy_select',
          placeholder: { type: 'plain_text', text: 'Select team member...' },
          options: TEAM,
        },
      },
      {
        type: 'input',
        block_id: 'des_block',
        label: { type: 'plain_text', text: 'Designer' },
        element: {
          type: 'static_select',
          action_id: 'des_select',
          placeholder: { type: 'plain_text', text: 'Select team member...' },
          options: TEAM,
        },
      },
      {
        type: 'input',
        block_id: 'assets_block',
        label: { type: 'plain_text', text: 'All Assets & Links' },
        optional: true,
        element: {
          type: 'plain_text_input',
          action_id: 'assets_input',
          multiline: true,
          placeholder: {
            type: 'plain_text',
            text: 'Paste all links here — one per line.\n\ne.g.\nBrand Guidelines: https://drive.google.com/...\nLogo: https://...\nInstagram: https://instagram.com/...',
          },
        },
      },
      {
        type: 'input',
        block_id: 'notes_block',
        label: { type: 'plain_text', text: 'Additional Notes' },
        optional: true,
        element: {
          type: 'plain_text_input',
          action_id: 'notes_input',
          multiline: true,
          placeholder: { type: 'plain_text', text: 'Any extra context or special instructions...' },
        },
      },
    ],
  };
}

// ─── START ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`⚡️ FlowStart HTTP server running on port ${PORT}`);
});
// Build: 1776399673
