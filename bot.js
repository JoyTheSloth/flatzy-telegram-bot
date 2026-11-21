import { Telegraf, Markup } from 'telegraf';
import { createClient } from '@supabase/supabase-js';
import http from 'http';
import dotenv from 'dotenv';

dotenv.config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!BOT_TOKEN || BOT_TOKEN === 'YOUR_TELEGRAM_BOT_TOKEN_HERE') {
  console.error('\n⚠️ TELEGRAM_BOT_TOKEN is missing or not set in .env!');
  console.error('Please get a token from @BotFather on Telegram, paste it into .env, and restart.\n');
  process.exit(1);
}

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('\n⚠️ Supabase credentials missing in .env!\n');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const bot = new Telegraf(BOT_TOKEN);

// User in-memory session store with 3-Day Auto-Expiry
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
const sessions = new Map();

function getSession(userId) {
  const existing = sessions.get(userId);
  if (existing) {
    // Check if session has expired (older than 3 days)
    if (Date.now() - existing.lastActivity > THREE_DAYS_MS) {
      sessions.delete(userId);
    } else {
      existing.lastActivity = Date.now();
      return existing;
    }
  }

  const newSession = {
    step: 'IDLE',
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
    createdAt: Date.now(),
    lastActivity: Date.now(),
    lastUploadAt: null
  };
  sessions.set(userId, newSession);
  return newSession;
}

function resetSession(userId) {
  sessions.delete(userId);
}

// Automatic hourly cleaner: sweeps and purges sessions older than 3 days
setInterval(() => {
  const now = Date.now();
  for (const [userId, session] of sessions.entries()) {
    if (now - session.lastActivity > THREE_DAYS_MS) {
      sessions.delete(userId);
    }
  }
}, 60 * 60 * 1000);

// -------------------------------------------------------------
// /cancel or /reset COMMAND
// -------------------------------------------------------------
bot.command(['cancel', 'reset'], async (ctx) => {
  resetSession(ctx.from.id);
  await ctx.reply('🧹 *Session and upload history cleared!*\n\nType /start whenever you want to submit a new flat.', { parse_mode: 'Markdown' });
});

// -------------------------------------------------------------
// /start COMMAND
// -------------------------------------------------------------
bot.command('start', async (ctx) => {
  const userId = ctx.from.id;
  resetSession(userId);
  const session = getSession(userId);
  session.step = 'SELECT_TYPE';

  await ctx.reply(
    `👋 *Welcome to Flatzy Kolkata Listing Assistant!*\n\n` +
    `You can submit your flat for **Rent** or **Resale** directly from here.\n` +
    `Once submitted, it will be reviewed by our admin team and posted live on the **flatzy.in** website.\n\n` +
    `👉 *Is your property for Rent or Resale?*`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback('🏢 For Rent', 'type_rent'),
          Markup.button.callback('🏷️ For Resale / Buy', 'type_sale')
        ]
      ])
    }
  );
});

// -------------------------------------------------------------
// STEP 1: LISTING TYPE SELECTION
// -------------------------------------------------------------
bot.action(/type_(rent|sale)/, async (ctx) => {
  const userId = ctx.from.id;
  const session = getSession(userId);
  session.listingType = ctx.match[1];
  session.step = 'SELECT_BHK';

  await ctx.answerCbQuery();
  await ctx.reply(
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

// -------------------------------------------------------------
// STEP 2: BHK SELECTION
// -------------------------------------------------------------
bot.action(/bhk_(.+)/, async (ctx) => {
  const userId = ctx.from.id;
  const session = getSession(userId);
  session.bhk = ctx.match[1];
  session.step = 'SELECT_LOCATION';

  await ctx.answerCbQuery();
  await ctx.reply(
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

// -------------------------------------------------------------
// STEP 3: LOCATION SELECTION
// -------------------------------------------------------------
bot.action(/loc_(.+)/, async (ctx) => {
  const userId = ctx.from.id;
  const session = getSession(userId);
  session.location = ctx.match[1];
  session.step = 'SELECT_FURNISHING';

  await ctx.answerCbQuery();
  await ctx.reply(
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

// -------------------------------------------------------------
// STEP 4: FURNISHING SELECTION
// -------------------------------------------------------------
bot.action(/furn_(.+)/, async (ctx) => {
  const userId = ctx.from.id;
  const session = getSession(userId);
  session.furnishing = ctx.match[1];
  session.step = 'ENTER_PRICE';

  await ctx.answerCbQuery();
  const prompt = session.listingType === 'rent'
    ? `💰 *Expected Monthly Rent*\n\nEnter the asking rent in Rupees (e.g. \`22000\` or \`18500\`):`
    : `💰 *Expected Resale Price*\n\nEnter the selling price in Rupees (e.g. \`6500000\` for 65 Lakhs):`;

  await ctx.reply(prompt, { parse_mode: 'Markdown' });
});

// -------------------------------------------------------------
// TEXT MESSAGE ROUTER (PRICE, CONTACT, DETAILS)
// -------------------------------------------------------------
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const session = getSession(userId);
  const text = ctx.message.text.trim();

  // If user enters /done while on photo step
  if (text === '/done' && session.step === 'SEND_PHOTOS') {
    return handleFinishSubmission(ctx, session);
  }

  // STEP: ENTER PRICE
  if (session.step === 'ENTER_PRICE') {
    const cleaned = text.replace(/[^0-9]/g, '');
    const price = parseInt(cleaned, 10);

    if (isNaN(price) || price <= 0) {
      return ctx.reply('⚠️ Please enter a valid numerical amount (e.g. `20000` or `5500000`):', { parse_mode: 'Markdown' });
    }

    session.price = price;
    session.step = 'ENTER_CONTACT';

    return ctx.reply(
      `✅ Price saved: *₹${price.toLocaleString('en-IN')}*.\n\n` +
      `👉 *Please enter your Name and WhatsApp contact number:*\n` +
      `_(Example: Amit Roy, 9830012345)_`,
      { parse_mode: 'Markdown' }
    );
  }

  // STEP: ENTER CONTACT
  if (session.step === 'ENTER_CONTACT') {
    session.userName = text;
    // Extract 10-digit number if present
    const phoneMatch = text.match(/\d{10}/);
    session.userPhone = phoneMatch ? phoneMatch[0] : text;

    session.step = 'SEND_PHOTOS';

    return ctx.reply(
      `✅ Contact saved: *${session.userName}*.\n\n` +
      `📸 *Now, please upload 1 to 5 photos of the flat.*\n\n` +
      `You can upload photos directly in this chat. When you are done uploading, click the button below or type **/done**.`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('✅ Done Uploading Photos', 'finish_upload')]
        ])
      }
    );
  }

  // Fallback
  if (session.step === 'IDLE') {
    return ctx.reply('Type /start to list a flat on Flatzy!');
  }
});

// -------------------------------------------------------------
// PHOTO UPLOAD HANDLER
// -------------------------------------------------------------
bot.on('photo', async (ctx) => {
  const userId = ctx.from.id;
  const session = getSession(userId);

  if (session.step !== 'SEND_PHOTOS') {
    session.step = 'SEND_PHOTOS';
  }

  try {
    const photos = ctx.message.photo;
    const largestPhoto = photos[photos.length - 1];
    const fileLink = await ctx.telegram.getFileLink(largestPhoto.file_id);
    const photoUrl = fileLink.href;

    session.images.push(photoUrl);

    await ctx.reply(
      `📷 Photo ${session.images.length} received! Send more, or tap below when finished:`,
      {
        ...Markup.inlineKeyboard([
          [Markup.button.callback(`✅ Finish & Submit (${session.images.length} photo${session.images.length > 1 ? 's' : ''})`, 'finish_upload')]
        ])
      }
    );
  } catch (err) {
    console.error('Error receiving photo:', err);
    ctx.reply('⚠️ Could not save photo. Please try uploading again.');
  }
});

bot.action('finish_upload', async (ctx) => {
  const userId = ctx.from.id;
  const session = getSession(userId);
  await ctx.answerCbQuery();
  await handleFinishSubmission(ctx, session);
});

// -------------------------------------------------------------
// SUBMIT TO SUPABASE & NOTIFY ADMIN
// -------------------------------------------------------------
async function handleFinishSubmission(ctx, session) {
  if (session.images.length === 0) {
    // Add default Kolkata curated placeholder if no images uploaded
    session.images.push('https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=1200&q=80');
  }

  const propId = `prop_tg_${Date.now()}`;
  const title = `${session.bhk} in ${session.location}`;
  const isRent = session.listingType === 'rent';

  const payload = {
    id: propId,
    title: title,
    listing_type: session.listingType,
    bhk: session.bhk,
    sqft: session.bhk === '1 BHK' ? 650 : session.bhk === '2 BHK' ? 1050 : 1450,
    posting_date: new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
    location: session.location,
    sub_location: session.subLocation || session.location,
    price: Number(session.price) || 20000,
    security_deposit: isRent ? Number(session.price) * 2 : 0,
    furnishing: session.furnishing,
    amenities: ['Lift', '24/7 Security', 'Power Backup', 'Water Supply'],
    status: 'pending',        // <-- PENDING ADMIN APPROVAL!
    is_verified: false,       // <-- PENDING VERIFICATION!
    broker_name: session.userName || 'Community User',
    broker_phone: session.userPhone || '',
    images: session.images,
    description: `Direct submission via Flatzy Telegram Bot by ${session.userName || 'Owner'}. Contact: ${session.userPhone || 'N/A'}.`,
    created_at: new Date().toISOString()
  };

  try {
    const { error } = await supabase.from('properties').insert([payload]);

    if (error) {
      console.error('[Supabase Insert Error]:', error);
      return ctx.reply('⚠️ There was an error submitting your listing. Please try again with /start.');
    }

    // Success response to user
    await ctx.reply(
      `🎉 *Listing Submitted Successfully!*\n\n` +
      `📌 *Summary:*\n` +
      `• *Property:* ${title}\n` +
      `• *Type:* For ${session.listingType.toUpperCase()}\n` +
      `• *Price:* ₹${session.price.toLocaleString('en-IN')}${isRent ? '/month' : ''}\n` +
      `• *Location:* ${session.location}\n` +
      `• *Photos:* ${session.images.length} uploaded\n\n` +
      `⏳ *Status:* **Pending Admin Review**\n\n` +
      `Our team will review your photos and details in the **Flatzy Admin Portal**. As soon as it is approved, your flat will be live on **flatzy.in**! 🚀\n\n` +
      `_Type /start anytime to submit another flat._`,
      { parse_mode: 'Markdown' }
    );

    // Reset session
    resetSession(ctx.from.id);

  } catch (err) {
    console.error('Fatal submission error:', err);
    ctx.reply('⚠️ An unexpected error occurred. Please try again later.');
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

