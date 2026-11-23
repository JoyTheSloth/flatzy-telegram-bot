import { Telegraf, Markup } from 'telegraf';
import { createClient } from '@supabase/supabase-js';
import http from 'http';
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';
import cron from 'node-cron';
import Groq from 'groq-sdk';

dotenv.config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const EMAIL_USER = process.env.EMAIL_USER || 'joydeepsuper50@gmail.com';
const EMAIL_PASS = process.env.EMAIL_PASS;
const ADMIN_NOTIFICATION_EMAIL = process.env.ADMIN_NOTIFICATION_EMAIL || 'joydeepdasofficial2003@gmail.com';
const GROQ_API_KEY = process.env.GROQ_API_KEY;

const groq = GROQ_API_KEY ? new Groq({ apiKey: GROQ_API_KEY }) : null;

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
// GROQ AI ONE-SHOT LISTING PARSER
// Converts raw messy broker text into structured property JSON
// -------------------------------------------------------------
async function parseListingWithGroqAI(rawText) {
  try {
    const systemPrompt = `You are an expert real estate data parser for Kolkata, India.
Given an unstructured property listing from a broker or owner, parse it into JSON with these exact fields:
{
  "is_listing": true/false (true if this looks like a property listing, false if it is just a casual greeting),
  "listingType": "rent" or "sale",
  "bhk": "1 BHK", "2 BHK", "3 BHK", or "4+ BHK",
  "location": Kolkata locality, strictly one of: "New Town", "Salt Lake", "Sector V", "Rajarhat", "Shapoorji", "Chinar Park", "Kestopur", "Baguiati", "Dum Dum", "EM Bypass", "Ruby", "Garia", "Bhowanipore", "Behala", "Howrah", or "Other",
  "subLocation": string (e.g. Action Area 1, Near City Centre 2, Unitech, etc),
  "price": number (monthly rent or total selling price in INR. E.g. "25k" -> 25000, "65 lakhs" -> 6500000, "1.2 cr" -> 12000000),
  "furnishing": "Fully Furnished", "Semi Furnished", or "Unfurnished",
  "sqft": number or null,
  "userName": string or null (if contact name mentioned),
  "userPhone": 10-digit phone number or null
}
Return ONLY valid JSON. No conversational text or markdown code blocks.`;

    const completion = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: rawText }
      ],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.1,
      response_format: { type: 'json_object' }
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) return null;
    return JSON.parse(content);
  } catch (err) {
    console.error('Groq AI parsing error:', err);
    return null;
  }
}

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
    `🏢 *Flatzy Admin & Listing Control*\n\n` +
    `Manage the *"Rooms listed this week"* section on the website and submit new property listings.\n\n` +
    `👉 *Select an action below:*`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback('📤 Upload Room Listing (1 Photo)', 'btn_upload_room'),
          Markup.button.callback('📋 View Live Listings', 'btn_view_rooms')
        ],
        [
          Markup.button.callback('🗑️ Delete / Manage Listings', 'btn_manage_delete'),
          Markup.button.callback('🏢 Submit Full Property', 'menu_list_flat')
        ],
        [
          Markup.button.callback('🤝 Broker KYC', 'menu_broker_info'),
          Markup.button.callback('🧹 Clear Chat', 'menu_clear_confirm')
        ]
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

  // Handle Guided Weekly Room text input
  if (session.step === 'WEEKLY_ROOM_TEXT') {
    await ctx.sendChatAction('typing');
    const weeklyParsed = await parseWeeklyRoomWithGroq(text);
    session.pendingWeeklyRoom = {
      title: weeklyParsed?.title || text.slice(0, 40),
      price: weeklyParsed?.price || '₹15,000',
      price_period: weeklyParsed?.price_period || 'per month',
      subtitle: weeklyParsed?.subtitle || '1 BHK, semi-furnished, listed today',
      location: weeklyParsed?.location || 'New Town',
      image_url: '/properties/shapoorji/living-tv.jpg'
    };
    session.step = 'WEEKLY_ROOM_PHOTO';

    return ctx.reply(
      `📝 *Details Extracted:*\n` +
      `🏠 *Title:* ${session.pendingWeeklyRoom.title}\n` +
      `💰 *Price:* ${session.pendingWeeklyRoom.price} (${session.pendingWeeklyRoom.price_period})\n` +
      `📝 *Details:* ${session.pendingWeeklyRoom.subtitle}\n` +
      `📍 *Location:* ${session.pendingWeeklyRoom.location}\n\n` +
      `📸 *Now, please send exactly 1 image of the room:*`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('⚡ Use Default Room Image & Post Now', 'confirm_post_weekly_room')],
          [Markup.button.callback('❌ Cancel', 'menu_main')]
        ])
      }
    );
  }

  // Fallback: If user sends raw text when IDLE, try Groq AI One-Shot Parsing!
  if (session.step === 'IDLE') {
    // If text has some length, attempt AI extraction
    if (text.length > 10) {
      await ctx.sendChatAction('typing');

      // First check if it's meant for "Rooms Listed This Week"
      const weeklyParsed = await parseWeeklyRoomWithGroq(text);
      if (weeklyParsed && (weeklyParsed.price || weeklyParsed.title)) {
        session.pendingWeeklyRoom = {
          title: weeklyParsed.title || 'Room in Kolkata',
          price: weeklyParsed.price || '₹15,000',
          price_period: weeklyParsed.price_period || 'per month',
          subtitle: weeklyParsed.subtitle || 'Verified, listed this week',
          location: weeklyParsed.location || 'New Town',
          image_url: '/properties/shapoorji/living-tv.jpg'
        };

        return ctx.reply(
          `⚡ *Room Listing Detected for Website!*\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `🏠 *Title:* ${session.pendingWeeklyRoom.title}\n` +
          `💰 *Price:* ${session.pendingWeeklyRoom.price} (${session.pendingWeeklyRoom.price_period})\n` +
          `📝 *Details:* ${session.pendingWeeklyRoom.subtitle}\n` +
          `📍 *Location:* ${session.pendingWeeklyRoom.location}\n\n` +
          `👉 *Choose an action below:*`,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('🚀 Post Immediately to Website', 'confirm_post_weekly_room')],
              [Markup.button.callback('❌ Cancel', 'cancel_post_weekly_room')]
            ])
          }
        );
      }

      const parsed = await parseListingWithGroqAI(text);

      if (parsed && parsed.is_listing && parsed.bhk) {
        session.listingType = parsed.listingType || 'rent';
        session.bhk = parsed.bhk || '2 BHK';
        session.location = parsed.location || 'New Town';
        session.subLocation = parsed.subLocation || '';
        session.price = Number(parsed.price) || 20000;
        session.furnishing = parsed.furnishing || 'Semi Furnished';
        session.userName = parsed.userName || ctx.from.first_name || 'Partner Broker';
        session.userPhone = parsed.userPhone || '';
        session.step = 'SEND_PHOTOS';

        const isRent = session.listingType === 'rent';
        const priceStr = isRent 
          ? `₹${session.price.toLocaleString('en-IN')}/month` 
          : `₹${session.price >= 10000000 ? (session.price / 10000000).toFixed(2) + ' Cr' : (session.price / 100000).toFixed(1) + ' L'}`;

        return sendTracked(
          ctx,
          `⚡ *AI Instant Listing Parser Detected!*\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `I automatically extracted the following details:\n\n` +
          `🏷️ *Type:* For ${session.listingType.toUpperCase()}\n` +
          `🏢 *BHK:* ${session.bhk}\n` +
          `📍 *Location:* ${session.location} ${session.subLocation ? `(${session.subLocation})` : ''}\n` +
          `💰 *Price:* ${priceStr}\n` +
          `🛋️ *Furnishing:* ${session.furnishing}\n` +
          `👤 *Contact:* ${session.userName} ${session.userPhone ? `(${session.userPhone})` : ''}\n\n` +
          `📸 *Final Step: Please upload 1 to 5 real photos of the flat directly in this chat:*`,
          {
            parse_mode: 'Markdown'
          }
        );
      }
    }

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

    // Handle photo when waiting for 1 room image
    if (session.step === 'WEEKLY_ROOM_PHOTO' && session.pendingWeeklyRoom) {
      session.pendingWeeklyRoom.image_url = photoUrl;
      session.step = 'IDLE';

      return ctx.reply(
        `📸 *Image Attached Successfully!*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `🏠 *Title:* ${session.pendingWeeklyRoom.title}\n` +
        `💰 *Price:* ${session.pendingWeeklyRoom.price} (${session.pendingWeeklyRoom.price_period})\n` +
        `📝 *Details:* ${session.pendingWeeklyRoom.subtitle}\n` +
        `📍 *Location:* ${session.pendingWeeklyRoom.location}\n\n` +
        `👉 *Ready to go live on the website?*`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🚀 Confirm & Post to Website', 'confirm_post_weekly_room')],
            [Markup.button.callback('❌ Cancel', 'cancel_post_weekly_room')]
          ])
        }
      );
    }

    // Check if user uploaded a photo with caption while IDLE (Instant Weekly Room Post)
    const caption = ctx.message.caption;
    if (caption && session.step === 'IDLE') {
      await ctx.sendChatAction('typing');
      const weeklyParsed = await parseWeeklyRoomWithGroq(caption);
      if (weeklyParsed && (weeklyParsed.price || weeklyParsed.title)) {
        session.pendingWeeklyRoom = {
          title: weeklyParsed.title || 'Room in Kolkata',
          price: weeklyParsed.price || '₹15,000',
          price_period: weeklyParsed.price_period || 'per month',
          subtitle: weeklyParsed.subtitle || 'Verified, listed this week',
          location: weeklyParsed.location || 'New Town',
          image_url: photoUrl
        };

        return ctx.reply(
          `📸 *Room Photo & Details Detected!*\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `🏠 *Title:* ${session.pendingWeeklyRoom.title}\n` +
          `💰 *Price:* ${session.pendingWeeklyRoom.price} (${session.pendingWeeklyRoom.price_period})\n` +
          `📝 *Details:* ${session.pendingWeeklyRoom.subtitle}\n` +
          `📍 *Location:* ${session.pendingWeeklyRoom.location}\n\n` +
          `👉 *Choose an action below:*`,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('🚀 Post Immediately to Website', 'confirm_post_weekly_room')],
              [Markup.button.callback('❌ Cancel', 'cancel_post_weekly_room')]
            ])
          }
        );
      }
    }
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
// INSTANT ADMIN EMAIL ALERT ON NEW SUBMISSION (FLAT / BROKER KYC)
// -------------------------------------------------------------
async function sendAdminAlertEmail({ type, title, brokerName, brokerPhone, location, price, imagesCount, details }) {
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: EMAIL_USER,
        pass: EMAIL_PASS
      }
    });

    const isKyc = type === 'BROKER_KYC';
    const subject = isKyc 
      ? `🪪 [NEW BROKER KYC] ${brokerName} submitted Aadhaar partner application!`
      : `🔔 [NEW FLAT SUBMISSION] ${title} (${location}) submitted by ${brokerName}!`;

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 650px; margin: 0 auto; padding: 24px; background-color: #0f172a; border-radius: 20px; color: #f8fafc;">
        <div style="background: linear-gradient(135deg, ${isKyc ? '#7c3aed, #9333ea' : '#0284c7, #2563eb'}); border-radius: 16px; padding: 20px; text-align: center; margin-bottom: 24px;">
          <h2 style="margin: 0; font-size: 20px; color: white; font-weight: 900;">
            ${isKyc ? '🪪 New Broker KYC Onboarding' : '🏡 New Property Listing Received'}
          </h2>
          <p style="margin: 6px 0 0 0; font-size: 13px; color: rgba(255,255,255,0.85);">
            Submitted via Flatzy Telegram Bot (@flatzykolkatabot)
          </p>
        </div>

        <div style="background: #1e293b; border-radius: 16px; padding: 20px; border: 1px solid #334155; margin-bottom: 24px;">
          <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
            <tr>
              <td style="padding: 8px 0; color: #94a3b8; width: 140px;">Applicant / Partner:</td>
              <td style="padding: 8px 0; font-weight: 800; color: white;">${brokerName}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #94a3b8;">WhatsApp Phone:</td>
              <td style="padding: 8px 0; font-weight: bold; color: #38bdf8;">
                <a href="https://wa.me/${(brokerPhone || '').replace(/\D/g, '')}" style="color: #38bdf8; text-decoration: none;">${brokerPhone}</a>
              </td>
            </tr>
            ${!isKyc ? `
            <tr>
              <td style="padding: 8px 0; color: #94a3b8;">Property:</td>
              <td style="padding: 8px 0; font-weight: bold; color: white;">${title}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #94a3b8;">Location:</td>
              <td style="padding: 8px 0; color: white;">${location}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #94a3b8;">Price:</td>
              <td style="padding: 8px 0; font-weight: bold; color: #4ade80;">${price}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #94a3b8;">Genuine Photos:</td>
              <td style="padding: 8px 0; font-weight: bold; color: #fbbf24;">${imagesCount} photo(s) uploaded</td>
            </tr>
            ` : `
            <tr>
              <td style="padding: 8px 0; color: #94a3b8;">Verification:</td>
              <td style="padding: 8px 0; font-weight: bold; color: #a855f7;">Aadhaar Front & Back Uploaded</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #94a3b8;">Agreement:</td>
              <td style="padding: 8px 0; color: #4ade80;">20% Deal Commission Policy Accepted</td>
            </tr>
            `}
          </table>
        </div>

        <div style="text-align: center; margin-bottom: 20px;">
          <a href="https://flatzy.vercel.app" style="display: inline-block; padding: 14px 28px; background: #0284c7; color: white; text-decoration: none; border-radius: 12px; font-weight: 900; font-size: 14px; box-shadow: 0 4px 14px rgba(2,132,199,0.4);">
            Open Flatzy Admin to Review & Approve →
          </a>
        </div>

        <div style="text-align: center; font-size: 11px; color: #64748b; border-top: 1px solid #1e293b; padding-top: 16px;">
          Instant notification dispatched to ${ADMIN_NOTIFICATION_EMAIL}
        </div>
      </div>
    `;

    await transporter.sendMail({
      from: `"Flatzy Alerts" <${EMAIL_USER}>`,
      to: ADMIN_NOTIFICATION_EMAIL,
      subject: subject,
      html: html
    });
    console.log(`📨 Instant Admin Email Alert sent to ${ADMIN_NOTIFICATION_EMAIL} for ${type}`);
  } catch (err) {
    console.warn('⚠️ Could not send instant admin alert email:', err.message);
  }
}

// -------------------------------------------------------------
// DAILY CSV DATABASE BACKUP AUTOMATION (Runs every night at 23:59 IST)
// -------------------------------------------------------------
async function sendDailyDatabaseBackup() {
  console.log('💾 Running automated daily database CSV backup...');
  try {
    const [{ data: properties }, { data: inquiries }] = await Promise.all([
      supabase.from('properties').select('*').order('created_at', { ascending: false }),
      supabase.from('inquiries').select('*').order('created_at', { ascending: false })
    ]);

    // Build Properties CSV
    const propHeaders = ['id', 'title', 'listing_type', 'bhk', 'price', 'location', 'status', 'is_verified', 'broker_name', 'broker_phone', 'created_at'];
    const propRows = (properties || []).map(p => 
      propHeaders.map(h => `"${String(p[h] ?? '').replace(/"/g, '""')}"`).join(',')
    );
    const propertiesCsv = [propHeaders.join(','), ...propRows].join('\n');

    // Build Inquiries CSV
    const inqHeaders = ['id', 'name', 'phone', 'bhk', 'location', 'budget', 'status', 'is_hot', 'created_at'];
    const inqRows = (inquiries || []).map(i => 
      inqHeaders.map(h => `"${String(i[h] ?? '').replace(/"/g, '""')}"`).join(',')
    );
    const inquiriesCsv = [inqHeaders.join(','), ...inqRows].join('\n');

    const todayStr = new Date().toISOString().split('T')[0];

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: EMAIL_USER,
        pass: EMAIL_PASS
      }
    });

    await transporter.sendMail({
      from: `"Flatzy Backups" <${EMAIL_USER}>`,
      to: ADMIN_NOTIFICATION_EMAIL,
      subject: `💾 [Flatzy Daily Backup] Database CSV Export (${todayStr})`,
      html: `
        <div style="font-family: sans-serif; padding: 20px; color: #1e293b;">
          <h2>📦 Flatzy Automated Daily Data Backup</h2>
          <p>Attached are the complete offline CSV backups for all properties and client leads as of <strong>${todayStr}</strong>.</p>
          <ul>
            <li><strong>Properties Count:</strong> ${(properties || []).length}</li>
            <li><strong>Inquiries Count:</strong> ${(inquiries || []).length}</li>
          </ul>
          <p style="color: #64748b; font-size: 12px;">This backup ensures zero data loss and is retained in your Google mailbox.</p>
        </div>
      `,
      attachments: [
        {
          filename: `flatzy_properties_${todayStr}.csv`,
          content: propertiesCsv,
          contentType: 'text/csv'
        },
        {
          filename: `flatzy_inquiries_${todayStr}.csv`,
          content: inquiriesCsv,
          contentType: 'text/csv'
        }
      ]
    });

    console.log(`✅ Daily database backup CSV sent successfully to ${ADMIN_NOTIFICATION_EMAIL}`);
  } catch (backupErr) {
    console.error('❌ Error sending daily database backup:', backupErr);
  }
}

// Schedule Daily Backup at 23:59 (Every midnight)
cron.schedule('59 23 * * *', () => {
  sendDailyDatabaseBackup();
});

// Admin manual backup trigger
bot.command('backup', async (ctx) => {
  await ctx.reply(`⏳ Creating full database CSV backup and sending to ${ADMIN_NOTIFICATION_EMAIL}...`);
  await sendDailyDatabaseBackup();
  await ctx.reply(`✅ Database CSV backup files have been dispatched to ${ADMIN_NOTIFICATION_EMAIL}!`);
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

    // Trigger Instant Admin Email Alert
    sendAdminAlertEmail({
      type: 'BROKER_KYC',
      brokerName: session.brokerName,
      brokerPhone: session.brokerPhone,
      location: 'Kolkata',
      details: 'Aadhaar Card Front and Back uploaded with 20% commission policy accepted.'
    });

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
    description: `Submitted via Flatzy Telegram Bot by ${session.userName}. Contact: ${session.userPhone}. [tg_chat_id:${ctx.from.id}]`,
    created_at: new Date().toISOString()
  };

  try {
    const { error } = await supabase.from('properties').insert([payload]);

    if (error) {
      console.error('[Supabase Insert Error]:', error);
      return sendTracked(ctx, '⚠️ There was an error submitting your listing. Please try again with /start.');
    }

    // Trigger Instant Admin Email Alert
    sendAdminAlertEmail({
      type: 'FLAT_LISTING',
      title: title,
      brokerName: session.userName || 'Broker Partner',
      brokerPhone: session.userPhone || 'N/A',
      location: session.location,
      price: `₹${Number(session.price).toLocaleString('en-IN')}${isRent ? '/month' : ''}`,
      imagesCount: session.images.length
    });

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
// WEEKLY INQUIRIES EMAIL REPORT AUTOMATION (Mondays at 09:00 AM IST)
// -------------------------------------------------------------
async function sendWeeklyInquiriesReport() {
  console.log('📧 Running scheduled weekly inquiries email report...');
  try {
    const { data: inquiries, error } = await supabase
      .from('inquiries')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[Supabase Inquiries Fetch Error]:', error);
      return;
    }

    const leadList = inquiries || [];
    const totalCount = leadList.length;
    const hotCount = leadList.filter(l => l.is_hot).length;

    // Generate HTML Table Rows
    const rowsHtml = leadList.map((lead, idx) => `
      <tr style="background-color: ${idx % 2 === 0 ? '#ffffff' : '#f8fafc'};">
        <td style="padding: 10px; border: 1px solid #e2e8f0; font-weight: bold; color: #1e293b;">${idx + 1}</td>
        <td style="padding: 10px; border: 1px solid #e2e8f0; font-weight: bold; color: #0284c7;">${lead.name || 'Anonymous'}</td>
        <td style="padding: 10px; border: 1px solid #e2e8f0; color: #334155;">${lead.phone || 'N/A'}</td>
        <td style="padding: 10px; border: 1px solid #e2e8f0; font-weight: bold; color: #7c3aed;">${lead.bhk || 'N/A'}</td>
        <td style="padding: 10px; border: 1px solid #e2e8f0; color: #334155;">${lead.location || 'Kolkata'}</td>
        <td style="padding: 10px; border: 1px solid #e2e8f0; color: #16a34a; font-weight: bold;">${lead.budget || 'N/A'}</td>
        <td style="padding: 10px; border: 1px solid #e2e8f0;">
          <span style="display: inline-block; padding: 3px 8px; border-radius: 6px; font-size: 11px; font-weight: bold; background: ${lead.status === 'Closed' ? '#dcfce7; color: #166534' : '#fef3c7; color: #92400e'};">
            ${lead.status || 'Active Lead'}
          </span>
        </td>
        <td style="padding: 10px; border: 1px solid #e2e8f0; color: #64748b; font-size: 12px;">${lead.created_at ? new Date(lead.created_at).toLocaleDateString('en-IN') : 'Recent'}</td>
      </tr>
    `).join('');

    const emailHtml = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 900px; margin: 0 auto; padding: 20px; background-color: #f1f5f9; color: #0f172a;">
        <div style="background: linear-gradient(135deg, #0284c7, #2563eb); border-radius: 16px; padding: 24px; color: white; margin-bottom: 20px;">
          <h1 style="margin: 0; font-size: 24px; font-weight: 900;">Flatzy Kolkata — Weekly Inquiries Report</h1>
          <p style="margin: 6px 0 0 0; font-size: 14px; opacity: 0.9;">Automated summary of all tenant, buyer & broker leads collected.</p>
        </div>

        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px; margin-bottom: 20px;">
          <div style="background: white; border-radius: 12px; padding: 16px; border: 1px solid #e2e8f0;">
            <div style="font-size: 12px; font-weight: bold; color: #64748b; text-transform: uppercase;">Total Leads Captured</div>
            <div style="font-size: 28px; font-weight: 900; color: #0284c7; margin-top: 4px;">${totalCount}</div>
          </div>
          <div style="background: white; border-radius: 12px; padding: 16px; border: 1px solid #e2e8f0;">
            <div style="font-size: 12px; font-weight: bold; color: #64748b; text-transform: uppercase;">Priority / Hot Leads</div>
            <div style="font-size: 28px; font-weight: 900; color: #ea580c; margin-top: 4px;">${hotCount}</div>
          </div>
        </div>

        <div style="background: white; border-radius: 16px; padding: 20px; border: 1px solid #e2e8f0; overflow-x: auto;">
          <h3 style="margin: 0 0 15px 0; font-size: 16px; font-weight: 800; color: #1e293b;">📋 Complete Leads Directory Table</h3>
          <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 13px;">
            <thead>
              <tr style="background-color: #0f172a; color: white;">
                <th style="padding: 10px; border: 1px solid #0f172a;">#</th>
                <th style="padding: 10px; border: 1px solid #0f172a;">Name</th>
                <th style="padding: 10px; border: 1px solid #0f172a;">Phone</th>
                <th style="padding: 10px; border: 1px solid #0f172a;">Requirement</th>
                <th style="padding: 10px; border: 1px solid #0f172a;">Location</th>
                <th style="padding: 10px; border: 1px solid #0f172a;">Budget</th>
                <th style="padding: 10px; border: 1px solid #0f172a;">Status</th>
                <th style="padding: 10px; border: 1px solid #0f172a;">Date</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml || '<tr><td colspan="8" style="padding: 15px; text-align: center; color: #64748b;">No inquiries recorded yet.</td></tr>'}
            </tbody>
          </table>
        </div>

        <div style="text-align: center; margin-top: 24px; font-size: 12px; color: #64748b;">
          This report was automatically compiled by Flatzy Automation System.<br/>
          Visit your <a href="https://flatzy.vercel.app" style="color: #0284c7; font-weight: bold; text-decoration: none;">Flatzy Portal</a> to manage inquiries.
        </div>
      </div>
    `;

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: EMAIL_USER,
        pass: EMAIL_PASS
      }
    });

    const mailOptions = {
      from: `"Flatzy Kolkata" <${EMAIL_USER}>`,
      to: ADMIN_NOTIFICATION_EMAIL,
      subject: `📊 [Flatzy Weekly Report] Total Enquired Leads: ${totalCount} (${new Date().toLocaleDateString('en-IN')})`,
      html: emailHtml
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ Weekly inquiries email sent successfully to ${ADMIN_NOTIFICATION_EMAIL}:`, info.messageId);
  } catch (err) {
    console.error('❌ Error sending weekly inquiries email report:', err);
  }
}

// Schedule: Every Monday at 09:00 AM (0 9 * * 1)
cron.schedule('0 9 * * 1', () => {
  sendWeeklyInquiriesReport();
});

// Also trigger an immediate test report when /emailreport is called by admin
bot.command('emailreport', async (ctx) => {
  await ctx.reply(`⏳ Generating and dispatching weekly inquiries email report to ${ADMIN_NOTIFICATION_EMAIL}...`);
  await sendWeeklyInquiriesReport();
  await ctx.reply(`✅ Inquiries table report has been dispatched to ${ADMIN_NOTIFICATION_EMAIL}!`);
});

// -------------------------------------------------------------
// REALTIME SUPABASE LISTENER: AUTO-NOTIFY BROKER ON TELEGRAM WHEN APPROVED
// -------------------------------------------------------------
try {
  supabase
    .channel('properties-approval-notifications')
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'properties'
      },
      async (payload) => {
        try {
          const oldRecord = payload.old;
          const newRecord = payload.new;

          // Check if property transitioned from pending to available / approved
          const wasPending = oldRecord && (oldRecord.status === 'pending' || !oldRecord.is_verified);
          const isNowApproved = newRecord && newRecord.status === 'available' && newRecord.is_verified === true;

          if (isNowApproved && wasPending) {
            // Extract Telegram Chat ID from description
            const match = (newRecord.description || '').match(/\[tg_chat_id:(\d+)\]/);
            if (match && match[1]) {
              const brokerChatId = match[1];
              const title = newRecord.title || 'Your Flat';
              const price = newRecord.price ? `₹${Number(newRecord.price).toLocaleString('en-IN')}` : '';

              console.log(`📢 Dispatching approval notification to Telegram Chat ID: ${brokerChatId}`);

              await bot.telegram.sendMessage(
                brokerChatId,
                `🎉 *CONGRATULATIONS! YOUR FLAT IS APPROVED & LIVE!* 🚀\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                `📌 *Property:* ${title}\n` +
                `💰 *Price:* ${price}\n` +
                `📍 *Location:* ${newRecord.location || 'Kolkata'}\n` +
                `✅ *Status:* **Live & Verified on flatzy.in**\n\n` +
                `Our tenant lead matching system is now actively connecting clients looking for this flat to you. You will receive direct inquiries!\n\n` +
                `Thank you for being a valued Flatzy partner! 🤝`,
                {
                  parse_mode: 'Markdown',
                  ...Markup.inlineKeyboard([
                    [Markup.button.callback('🏢 Submit Another Flat', 'menu_list_flat')],
                    [Markup.button.callback('🔙 Main Menu', 'menu_main')]
                  ])
                }
              );
            }
          }
        } catch (notifErr) {
          console.error('Error sending Telegram approval notification:', notifErr);
        }
      }
    )
    .subscribe();
  console.log('⚡ Supabase Realtime Approval Listener initialized.');
} catch (rtErr) {
  console.warn('Realtime listener subscription warning:', rtErr.message);
}

// -------------------------------------------------------------
// ADMIN WEEKLY ROOMS AUTOMATION & WEBSITE POSTING
// -------------------------------------------------------------

// Helper to parse room listing specifically for the Weekly Rooms section
async function parseWeeklyRoomWithGroq(text) {
  if (!groq) return null;
  try {
    const prompt = `You are an AI assistant for Flatzy Kolkata real estate platform.
Extract room listing information from this raw text pasted by an admin:
"${text}"

Return ONLY a valid JSON object with these exact keys:
{
  "title": "Title of the room or flat (e.g. PG in Andheri West or 2 BHK in Shapoorji)",
  "price": "Price amount with rupee symbol (e.g. ₹14,000 or ₹28,000)",
  "price_period": "per month or per person, per month",
  "subtitle": "Details like BHK, furnishing, listed recency (e.g. 1 BHK, furnished, listed today)",
  "location": "Location name (e.g. Shapoorji, New Town, Sector V, etc.)"
}`;

    const completion = await groq.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.1,
      response_format: { type: 'json_object' }
    });

    return JSON.parse(completion.choices[0]?.message?.content || '{}');
  } catch (err) {
    console.error('Groq AI parse error for weekly room:', err);
    return null;
  }
}

// Command & Button: View & Delete Active Listings
bot.action(['btn_view_rooms', 'btn_manage_delete'], async (ctx) => {
  await ctx.answerCbQuery();
  return listActiveRoomsWithActions(ctx);
});

bot.command(['rooms', 'list'], async (ctx) => {
  return listActiveRoomsWithActions(ctx);
});

async function listActiveRoomsWithActions(ctx) {
  try {
    const { data: rooms, error } = await supabase
      .from('weekly_rooms')
      .select('*')
      .eq('status', 'available')
      .order('created_at', { ascending: false });

    if (error) {
      return ctx.reply('⚠️ Error fetching weekly rooms from Supabase: ' + error.message);
    }

    if (!rooms || rooms.length === 0) {
      return ctx.reply(
        '📭 *No active listings in "Rooms Listed This Week"*\n\n' +
        'Tap the button below to upload one now!',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('📤 Upload a Room Listing (1 Photo)', 'btn_upload_room')],
            [Markup.button.callback('🔙 Main Menu', 'menu_main')]
          ])
        }
      );
    }

    await ctx.reply(`📋 *Currently Live on Website (${rooms.length} active):*`, { parse_mode: 'Markdown' });

    for (const room of rooms) {
      const priceText = room.price ? (room.price.startsWith('₹') ? room.price : `₹${room.price}`) : '₹N/A';
      const msg = 
        `🏠 *${room.title}*\n` +
        `💰 *${priceText}* (${room.price_period || 'per month'})\n` +
        `📝 ${room.subtitle || 'Verified listing'}\n` +
        `📍 ${room.location || 'Kolkata'}\n` +
        `🕒 Posted: ${new Date(room.created_at).toLocaleDateString('en-IN')}`;

      await ctx.reply(msg, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🗑️ Delete / Remove from Website', `del_room_${room.id}`)]
        ])
      });
    }

    await ctx.reply('👉 Tap below for more options:', {
      ...Markup.inlineKeyboard([
        [Markup.button.callback('📤 Upload Another Room', 'btn_upload_room')],
        [Markup.button.callback('🔙 Main Menu', 'menu_main')]
      ])
    });
  } catch (err) {
    ctx.reply('⚠️ Error: ' + err.message);
  }
}

// Button: Upload Room Listing Guided Flow
bot.action('btn_upload_room', async (ctx) => {
  const userId = ctx.from.id;
  const session = getSession(userId);
  session.step = 'WEEKLY_ROOM_TEXT';
  await ctx.answerCbQuery();

  await ctx.reply(
    `📤 *Upload Room to "Listed This Week"*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `👉 *Step 1:* Paste the listing text in this chat.\n\n` +
    `_Example:_\n` +
    `\`₹14,000 per month. PG in Andheri West. 1 BHK, furnished, listed today.\`\n\n` +
    `Or you can directly send 1 photo with the text as caption!`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('❌ Cancel', 'menu_main')]
      ])
    }
  );
});

// Action to remove a room posting from the live website
bot.action(/del_room_(.+)/, async (ctx) => {
  const roomId = ctx.match[1];
  try {
    const { error } = await supabase
      .from('weekly_rooms')
      .update({ status: 'archived' })
      .eq('id', roomId);

    await ctx.answerCbQuery();
    if (error) {
      return ctx.reply('⚠️ Failed to remove room: ' + error.message);
    }

    await ctx.editMessageText(
      `🗑️ *Removed from Website Successfully!*\nThis room is no longer visible on the live Flatzy homepage.`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    ctx.reply('⚠️ Error removing room: ' + err.message);
  }
});

// Confirmation action to post to website
bot.action('confirm_post_weekly_room', async (ctx) => {
  const userId = ctx.from.id;
  const session = getSession(userId);
  await ctx.answerCbQuery();

  if (!session.pendingWeeklyRoom) {
    return ctx.reply('⚠️ No pending room to post. Please send the details again.');
  }

  const room = session.pendingWeeklyRoom;
  try {
    const { data, error } = await supabase.from('weekly_rooms').insert([{
      title: room.title,
      price: room.price,
      price_period: room.price_period,
      subtitle: room.subtitle,
      location: room.location,
      image_url: room.image_url || '/properties/shapoorji/living-tv.jpg',
      status: 'available',
      created_at: new Date().toISOString()
    }]);

    if (error) {
      console.error('Insert error:', error);
      return ctx.reply('⚠️ Error saving to Supabase: ' + error.message + '\n\nMake sure the `weekly_rooms` table exists.');
    }

    session.pendingWeeklyRoom = null;
    await ctx.reply(
      `🎉 *Posted to Website Successfully!*\n\n` +
      `It is now live under *"Rooms listed this week."* on the homepage.\n\n` +
      `Use /rooms anytime to view active listings or remove them.`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    ctx.reply('⚠️ Error posting to website: ' + err.message);
  }
});

// Action to cancel pending room
bot.action('cancel_post_weekly_room', async (ctx) => {
  const userId = ctx.from.id;
  const session = getSession(userId);
  session.pendingWeeklyRoom = null;
  await ctx.answerCbQuery();
  await ctx.reply('❌ Posting cancelled.');
});

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
