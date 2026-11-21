import { Telegraf, Markup } from 'telegraf';
import { createClient } from '@supabase/supabase-js';
import http from 'http';
import dotenv from 'dotenv';

dotenv.config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!BOT_TOKEN || BOT_TOKEN === 'YOUR_TELEGRAM_BOT_TOKEN_HERE') {
  console.error('\n⚠️ TELEGRAM_BOT_TOKEN is missing or not set in .env!\n');
  process.exit(1);
}

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('\n⚠️ Supabase credentials missing in .env!\n');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const bot = new Telegraf(BOT_TOKEN);

// User in-memory session store with 3-Day Auto-Expiry & Message Tracking
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
const sessions = new Map();
const photoDebounceTimers = new Map();

function getSession(userId) {
  const existing = sessions.get(userId);
  if (existing) {
    if (Date.now() - existing.lastActivity > THREE_DAYS_MS) {
      sessions.delete(userId);
    } else {
      existing.lastActivity = Date.now();
      return existing;
    }
  }

  const newSession = {
    step: 'IDLE',
    // Property listing fields
    listingType: 'rent',
    bhk: '2 BHK',
    location: 'New Town',
    subLocation: '',
    price: 0,
    furnishing: 'Semi Furnished',
    userName: '',
    userPhone: '',
    images: [],
    description: '',
    // Broker onboarding fields
    brokerName: '',
    brokerPhone: '',
    aadhaarFront: '',
    aadhaarBack: '',
    // Metadata & history tracking
    messageIds: [],
    createdAt: Date.now(),
    lastActivity: Date.now(),
    lastUploadAt: null
  };
  sessions.set(userId, newSession);
  return newSession;
}

function resetSession(userId) {
  const existing = sessions.get(userId);
  if (existing) {
    existing.step = 'IDLE';
    existing.images = [];
    existing.price = 0;
    existing.userName = '';
    existing.userPhone = '';
    existing.brokerName = '';
    existing.brokerPhone = '';
    existing.aadhaarFront = '';
    existing.aadhaarBack = '';
    existing.lastActivity = Date.now();
  }
}

// Helper to send a reply and track its message ID for the Clear command
async function sendTracked(ctx, text, extra = {}) {
  const msg = await ctx.reply(text, extra);
  const session = getSession(ctx.from.id);
  session.messageIds.push(msg.message_id);
  return msg;
}

// Automatic hourly cleaner: purges sessions older than 3 days
setInterval(() => {
  const now = Date.now();
  for (const [userId, session] of sessions.entries()) {
    if (now - session.lastActivity > THREE_DAYS_MS) {
      sessions.delete(userId);
    }
  }
}, 60 * 60 * 1000);

// -------------------------------------------------------------
// MAIN MENU / START COMMAND
// -------------------------------------------------------------
async function showMainMenu(ctx) {
  const userId = ctx.from.id;
  resetSession(userId);
  const session = getSession(userId);
  session.step = 'IDLE';

  await sendTracked(
    ctx,
    `🏡 *Welcome to Flatzy Kolkata Official Assistant!*\n\n` +
    `Flatzy helps you list verified flats and join Kolkata's premier broker network.\n\n` +
    `👉 *What would you like to do?*`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🏢 List a Flat (Rent / Resale)', 'menu_list_flat')],
        [Markup.button.callback('🤝 How to Become a Flatzy Broker', 'menu_broker_info')],
        [Markup.button.callback('🗑️ Clear Chat History', 'menu_clear_confirm')]
      ])
    }
  );
}

bot.command('start', async (ctx) => {
  const session = getSession(ctx.from.id);
  if (ctx.message?.message_id) session.messageIds.push(ctx.message.message_id);
  await showMainMenu(ctx);
});

bot.action('menu_main', async (ctx) => {
  await ctx.answerCbQuery();
  await showMainMenu(ctx);
});

// -------------------------------------------------------------
// BROKER INSTRUCTIONS & ONBOARDING (Aadhaar KYC)
// -------------------------------------------------------------
async function showBrokerInstructions(ctx) {
  await sendTracked(
    ctx,
    `🤝 *HOW TO BECOME A VERIFIED FLATZY BROKER*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `Join Kolkata’s most trusted real estate network. Flatzy connects you directly to verified tenants and buyers without spam.\n\n` +
    `📋 *KYC Verification Requirements:*\n` +
    `1️⃣ Your Full Name & Agency Name (if applicable)\n` +
    `2️⃣ Active WhatsApp Phone Number\n` +
    `3️⃣ Clear photos of your **Aadhaar Card**:\n` +
    `   • 📸 **Front Side** (Showing photo & name)\n` +
    `   • 📸 **Back Side** (Showing address)\n\n` +
    `💼 *Broker Policy & Commission:*\n` +
    `• **Commission:** Flatzy takes **20% of whatever the flat is priced at** upon closing the deal.\n` +
    `• Verified broker badge on **flatzy.in**.\n` +
    `• Access to high-intent leads in New Town, Salt Lake, Sector V, Rajarhat & Shapoorji.\n\n` +
    `👉 *Ready to register as a Flatzy Partner Broker?*`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('📝 Apply Now as a Broker', 'broker_start_apply')],
        [Markup.button.callback('🏢 List a Flat Instead', 'menu_list_flat')],
        [Markup.button.callback('🔙 Back to Main Menu', 'menu_main')]
      ])
    }
  );
}

bot.command('broker', async (ctx) => {
  const session = getSession(ctx.from.id);
  if (ctx.message?.message_id) session.messageIds.push(ctx.message.message_id);
  await showBrokerInstructions(ctx);
});

bot.action('menu_broker_info', async (ctx) => {
  await ctx.answerCbQuery();
  await showBrokerInstructions(ctx);
});

// Broker Application Flow
bot.action('broker_start_apply', async (ctx) => {
  const userId = ctx.from.id;
  const session = getSession(userId);
  session.step = 'BROKER_NAME';

  await ctx.answerCbQuery();
  await sendTracked(
    ctx,
    `📝 *Broker Registration — Step 1 of 4*\n\n` +
    `👉 *Please enter your Full Name and Agency Name:*\n` +
    `_(Example: Rajesh Sharma, Greenline Realty)_`,
    { parse_mode: 'Markdown' }
  );
});

// -------------------------------------------------------------
// CLEAR CHAT WITH CONFIRMATION DIALOGUE BOX
// -------------------------------------------------------------
async function promptClearChat(ctx) {
  await sendTracked(
    ctx,
    `⚠️ *Confirm Clear Chat*\n\n` +
    `Are you sure you want to clear this entire conversation and wipe your session history?`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback('✅ Yes, Clear Everything', 'confirm_clear_yes'),
          Markup.button.callback('❌ Cancel', 'confirm_clear_no')
        ]
      ])
    }
  );
}

bot.command(['clear', 'cancel', 'reset'], async (ctx) => {
  const session = getSession(ctx.from.id);
  if (ctx.message?.message_id) session.messageIds.push(ctx.message.message_id);
  await promptClearChat(ctx);
});

bot.action('menu_clear_confirm', async (ctx) => {
  await ctx.answerCbQuery();
  await promptClearChat(ctx);
});

bot.action('confirm_clear_no', async (ctx) => {
  await ctx.answerCbQuery();
  try {
    await ctx.deleteMessage();
  } catch {}
  await ctx.reply('Action cancelled. Type /start to return to the main menu.');
});

bot.action('confirm_clear_yes', async (ctx) => {
  const userId = ctx.from.id;
  const session = getSession(userId);
  await ctx.answerCbQuery();

  // Delete all tracked messages from this session
  const idsToDelete = [...session.messageIds];
  if (ctx.callbackQuery?.message?.message_id) {
    idsToDelete.push(ctx.callbackQuery.message.message_id);
  }

  for (const msgId of idsToDelete) {
    try {
      await ctx.telegram.deleteMessage(ctx.chat.id, msgId);
    } catch (e) {
      // Ignored if message was already removed or expired
    }
  }

  // Clear memory session completely
  sessions.delete(userId);

  // Send a fresh clean start message
  await ctx.reply(
    `✨ *Chat Cleared Successfully!*\n\n` +
    `All your conversation history and draft details have been wiped clean.\n\n` +
    `👉 Send /start whenever you want to begin again.`,
    { parse_mode: 'Markdown' }
  );
});

// -------------------------------------------------------------
// PROPERTY LISTING FLOW
// -------------------------------------------------------------
bot.action('menu_list_flat', async (ctx) => {
  const userId = ctx.from.id;
  const session = getSession(userId);
  session.step = 'SELECT_TYPE';

  await ctx.answerCbQuery();
  await sendTracked(
    ctx,
    `🏢 *Post a Flat on Flatzy Kolkata*\n\n` +
    `👉 *Is your property for Rent or Resale?*`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback('🏢 For Rent', 'type_rent'),
          Markup.button.callback('🏷️ For Resale / Buy', 'type_sale')
        ],
        [Markup.button.callback('🔙 Back to Main Menu', 'menu_main')]
      ])
    }
  );
});

bot.action(/type_(rent|sale)/, async (ctx) => {
  const userId = ctx.from.id;
  const session = getSession(userId);
  session.listingType = ctx.match[1];
  session.step = 'SELECT_BHK';

  await ctx.answerCbQuery();
  await sendTracked(
    ctx,
    `Great! Listing for *${session.listingType === 'rent' ? 'Rent' : 'Resale'}*.\n\n` +
    `👉 *Select property configuration:*`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback('1 BHK', 'bhk_1 BHK'),
          Markup.button.callback('2 BHK', 'bhk_2 BHK')
        ],
        [
          Markup.button.callback('3 BHK', 'bhk_3 BHK'),
          Markup.button.callback('4+ BHK / Villa', 'bhk_4+ BHK')
        ]
      ])
    }
  );
});

bot.action(/bhk_(.+)/, async (ctx) => {
  const userId = ctx.from.id;
  const session = getSession(userId);
  session.bhk = ctx.match[1];
  session.step = 'SELECT_LOCATION';

  await ctx.answerCbQuery();
  await sendTracked(
    ctx,
    `Selected: *${session.bhk}*.\n\n` +
    `👉 *Which area in Kolkata is the flat located in?*`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback('📍 New Town', 'loc_New Town'),
          Markup.button.callback('📍 Salt Lake', 'loc_Salt Lake')
        ],
        [
          Markup.button.callback('📍 Sector V', 'loc_Sector V'),
          Markup.button.callback('📍 Rajarhat', 'loc_Rajarhat')
        ],
        [
          Markup.button.callback('📍 Shapoorji', 'loc_Shapoorji'),
          Markup.button.callback('📍 Howrah / Kestopur', 'loc_Howrah')
        ]
      ])
    }
  );
});

bot.action(/loc_(.+)/, async (ctx) => {
  const userId = ctx.from.id;
  const session = getSession(userId);
  session.location = ctx.match[1];
  session.step = 'SELECT_FURNISHING';

  await ctx.answerCbQuery();
  await sendTracked(
    ctx,
    `Location: *${session.location}*.\n\n` +
    `👉 *Furnishing condition:*`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback('🛋️ Fully Furnished', 'furn_Fully Furnished'),
          Markup.button.callback('🪑 Semi Furnished', 'furn_Semi Furnished')
        ],
        [
          Markup.button.callback('🚪 Unfurnished', 'furn_Unfurnished')
        ]
      ])
    }
  );
});

bot.action(/furn_(.+)/, async (ctx) => {
  const userId = ctx.from.id;
  const session = getSession(userId);
  session.furnishing = ctx.match[1];
  session.step = 'ENTER_PRICE';

  await ctx.answerCbQuery();
  const prompt = session.listingType === 'rent'
    ? `💰 *Expected Monthly Rent*\n\nEnter the asking rent in Rupees (e.g. \`22000\` or \`18500\`):`
    : `💰 *Expected Resale Price*\n\nEnter the selling price in Rupees (e.g. \`6500000\` for 65 Lakhs):`;

  await sendTracked(ctx, prompt, { parse_mode: 'Markdown' });
});

// -------------------------------------------------------------
// TEXT MESSAGE ROUTER (PRICE, CONTACT, BROKER DETAILS)
// -------------------------------------------------------------
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const session = getSession(userId);
  const text = ctx.message.text.trim();
  session.messageIds.push(ctx.message.message_id);

  // If user enters /done while on photo step
  if (text === '/done' && session.step === 'SEND_PHOTOS') {
    return handleFinishSubmission(ctx, session);
  }

  // --- BROKER ONBOARDING STEPS ---
  if (session.step === 'BROKER_NAME') {
    session.brokerName = text;
    session.step = 'BROKER_PHONE';
    return sendTracked(
      ctx,
      `✅ Name saved: *${session.brokerName}*.\n\n` +
      `📝 *Broker Registration — Step 2 of 4*\n\n` +
      `👉 *Please enter your 10-digit WhatsApp Phone Number:*\n` +
      `_(Example: 9830012345)_`,
      { parse_mode: 'Markdown' }
    );
  }

  if (session.step === 'BROKER_PHONE') {
    const phoneMatch = text.match(/\d{10}/);
    session.brokerPhone = phoneMatch ? phoneMatch[0] : text;
    session.step = 'BROKER_AADHAAR_FRONT';

    return sendTracked(
      ctx,
      `✅ Phone saved: *${session.brokerPhone}*.\n\n` +
      `📸 *Broker Registration — Step 3 of 4*\n\n` +
      `👉 *Please upload a clear photo of the FRONT side of your Aadhaar Card:*`,
      { parse_mode: 'Markdown' }
    );
  }

  // --- PROPERTY LISTING STEPS ---
  if (session.step === 'ENTER_PRICE') {
    const cleaned = text.replace(/[^0-9]/g, '');
    const price = parseInt(cleaned, 10);

    if (isNaN(price) || price <= 0) {
      return sendTracked(ctx, '⚠️ Please enter a valid numerical amount (e.g. `20000` or `5500000`):', { parse_mode: 'Markdown' });
    }

    session.price = price;
    session.step = 'ENTER_CONTACT';

    return sendTracked(
      ctx,
      `✅ Price saved: *₹${price.toLocaleString('en-IN')}*.\n\n` +
      `👉 *Please enter your Name and WhatsApp contact number:*\n` +
      `_(Example: Amit Roy, 9830012345)_`,
      { parse_mode: 'Markdown' }
    );
  }

  if (session.step === 'ENTER_CONTACT') {
    session.userName = text;
    const phoneMatch = text.match(/\d{10}/);
    session.userPhone = phoneMatch ? phoneMatch[0] : text;
    session.step = 'SEND_PHOTOS';

    return sendTracked(
      ctx,
      `✅ Contact saved: *${session.userName}*.\n\n` +
      `📸 *Now, please upload the real photos of the flat.*\n\n` +
      `⚠️ *Note:* At least 1 photo is required. Flatzy only publishes genuine photos provided by you.\n` +
      `You can upload multiple photos in this chat. When you have uploaded all your photos, tap the button below:`,
      {
        parse_mode: 'Markdown'
      }
    );
  }

  // Fallback
  if (session.step === 'IDLE') {
    return showMainMenu(ctx);
  }
});

// -------------------------------------------------------------
// PHOTO UPLOAD ROUTER (PROPERTY PHOTOS & AADHAAR KYC)
// -------------------------------------------------------------
bot.on('photo', async (ctx) => {
  const userId = ctx.from.id;
  const session = getSession(userId);
  if (ctx.message?.message_id) session.messageIds.push(ctx.message.message_id);

  try {
    const photos = ctx.message.photo;
    const largestPhoto = photos[photos.length - 1];
    const fileLink = await ctx.telegram.getFileLink(largestPhoto.file_id);
    const photoUrl = fileLink.href;

    // 1. Handle Aadhaar Card Front
    if (session.step === 'BROKER_AADHAAR_FRONT') {
      session.aadhaarFront = photoUrl;
      session.step = 'BROKER_AADHAAR_BACK';
      return sendTracked(
        ctx,
        `✅ *Aadhaar Front Side Received!*\n\n` +
        `📸 *Broker Registration — Step 4 of 4*\n\n` +
        `👉 *Now please upload a clear photo of the BACK side of your Aadhaar Card:*`,
        { parse_mode: 'Markdown' }
      );
    }

    // 2. Handle Aadhaar Card Back & Complete Broker KYC
    if (session.step === 'BROKER_AADHAAR_BACK') {
      session.aadhaarBack = photoUrl;
      return handleFinishBrokerKyc(ctx, session);
    }

    // 3. Handle Property Photos (with multi-photo debouncing buffer)
    if (session.step !== 'SEND_PHOTOS') {
      session.step = 'SEND_PHOTOS';
    }

    session.images.push(photoUrl);

    // Clear any previous debounce timer for this user
    if (photoDebounceTimers.has(userId)) {
      clearTimeout(photoDebounceTimers.get(userId));
    }

    // Debounce reply by 1.2s so multiple photos sent together result in ONE clean summary reply
    const timer = setTimeout(async () => {
      photoDebounceTimers.delete(userId);
      await sendTracked(
        ctx,
        `📷 *${session.images.length} Photo${session.images.length > 1 ? 's' : ''} Received!*\n\n` +
        `Send more photos, or tap below to submit:`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback(`✅ Finish & Submit (${session.images.length} photo${session.images.length > 1 ? 's' : ''})`, 'finish_upload')]
          ])
        }
      );
    }, 1200);

    photoDebounceTimers.set(userId, timer);
  } catch (err) {
    console.error('Error receiving photo:', err);
    sendTracked(ctx, '⚠️ Could not save photo. Please try uploading again.');
  }
});

bot.action('finish_upload', async (ctx) => {
  const userId = ctx.from.id;
  const session = getSession(userId);
  await ctx.answerCbQuery();
  await handleFinishSubmission(ctx, session);
});

// -------------------------------------------------------------
// FINISH BROKER KYC SUBMISSION
// -------------------------------------------------------------
async function handleFinishBrokerKyc(ctx, session) {
  const inquiryId = `broker_kyc_${Date.now()}`;

  const kycPayload = {
    id: inquiryId,
    name: session.brokerName,
    phone: session.brokerPhone,
    bhk: 'Aadhaar Verified KYC',
    property: 'Broker Partner Application',
    location: 'Kolkata',
    furnishing: 'Aadhaar Front & Back Uploaded',
    budget: '20% Commission Policy Accepted',
    shifting_date: 'Immediate Verification',
    tenant_type: 'Broker Partner',
    status: 'Active Lead',
    is_hot: true,
    last_follow_up: 'Aadhaar KYC Submitted via Telegram Bot',
    assigned_broker_name: 'Flatzy Onboarding',
    created_at: new Date().toISOString()
  };

  try {
    const { error } = await supabase.from('inquiries').insert([kycPayload]);

    if (error) {
      console.warn('[Broker KYC Insert Warning]:', error.message);
    }

    await sendTracked(
      ctx,
      `🎉 *Broker Application Submitted Successfully!*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `👤 *Partner Name:* ${session.brokerName}\n` +
      `📞 *WhatsApp Phone:* ${session.brokerPhone}\n` +
      `🪪 *KYC Status:* Aadhaar Card Front & Back Received\n` +
      `📜 *Policy:* 20% commission on deal closing\n\n` +
      `Our onboarding manager will verify your Aadhaar details within 24 hours and contact you on WhatsApp.\n\n` +
      `Welcome to the Flatzy Broker Family! 🤝`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🏢 List a Flat', 'menu_list_flat')],
          [Markup.button.callback('🔙 Main Menu', 'menu_main')]
        ])
      }
    );

    resetSession(ctx.from.id);
  } catch (err) {
    console.error('Error saving broker KYC:', err);
    sendTracked(ctx, '⚠️ Error submitting your KYC. Please type /broker to try again.');
  }
}

// -------------------------------------------------------------
// FINISH PROPERTY LISTING SUBMISSION
// -------------------------------------------------------------
async function handleFinishSubmission(ctx, session) {
  // STRICT: Do not add any mock/placeholder image! Require real images from broker
  if (!session.images || session.images.length === 0) {
    return sendTracked(
      ctx,
      `⚠️ *No Photos Uploaded!*\n\nFlatzy only lists properties with genuine photos taken by the broker/owner.\n\nPlease upload at least 1 real photo of the flat to proceed:`,
      { parse_mode: 'Markdown' }
    );
  }

  const propId = `prop_tg_${Date.now()}`;
  const title = `${session.bhk} in ${session.location}`;
  const isRent = session.listingType === 'rent';

  const payload = {
    id: propId,
    title: title,
    listing_type: session.listingType,
    bhk: session.bhk,
    sqft: null, // Only real data; no mock/assumed sqft
    posting_date: new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
    location: session.location,
    sub_location: session.subLocation || session.location,
    price: Number(session.price) || 0,
    security_deposit: isRent ? Number(session.price) * 2 : 0,
    furnishing: session.furnishing,
    amenities: [], // Only genuine amenities; do not inject mock lists
    status: 'pending',        // PENDING ADMIN APPROVAL
    is_verified: false,       // PENDING VERIFICATION
    broker_name: session.userName || 'Broker Partner',
    broker_phone: session.userPhone || '',
    images: session.images,   // ONLY images uploaded by the broker!
    description: `Submitted via Flatzy Telegram Bot by ${session.userName}. Contact: ${session.userPhone}.`,
    created_at: new Date().toISOString()
  };

  try {
    const { error } = await supabase.from('properties').insert([payload]);

    if (error) {
      console.error('[Supabase Insert Error]:', error);
      return sendTracked(ctx, '⚠️ There was an error submitting your listing. Please try again with /start.');
    }

    await sendTracked(
      ctx,
      `🎉 *Listing Submitted Successfully!*\n\n` +
      `📌 *Summary:*\n` +
      `• *Property:* ${title}\n` +
      `• *Type:* For ${session.listingType.toUpperCase()}\n` +
      `• *Price:* ₹${session.price.toLocaleString('en-IN')}${isRent ? '/month' : ''}\n` +
      `• *Location:* ${session.location}\n` +
      `• *Photos:* ${session.images.length} uploaded\n\n` +
      `⏳ *Status:* **Pending Admin Review**\n\n` +
      `Our team will review your photos and details in the **Flatzy Admin Portal**. As soon as it is approved, your flat will be live on **flatzy.in**! 🚀`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🏢 Submit Another Flat', 'menu_list_flat')],
          [Markup.button.callback('🔙 Main Menu', 'menu_main')]
        ])
      }
    );

    resetSession(ctx.from.id);
  } catch (err) {
    console.error('Fatal submission error:', err);
    sendTracked(ctx, '⚠️ An unexpected error occurred. Please try again later.');
  }
}

// -------------------------------------------------------------
// HTTP HEALTH CHECK SERVER (Required by Render Web Services)
// -------------------------------------------------------------
const PORT = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok', service: 'flatzy-telegram-bot', timestamp: new Date().toISOString() }));
});

server.listen(PORT, () => {
  console.log(`🌐 Health check server listening on port ${PORT}`);
});

// -------------------------------------------------------------
// LAUNCH BOT
// -------------------------------------------------------------
bot.launch()
  .then(() => {
    console.log('🚀 Flatzy Telegram Bot is online and listening for messages!');
  })
  .catch((err) => {
    console.error('Failed to launch bot:', err);
  });

// Graceful shutdown
process.once('SIGINT', () => {
  server.close();
  bot.stop('SIGINT');
});
process.once('SIGTERM', () => {
  server.close();
  bot.stop('SIGTERM');
});
