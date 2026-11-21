# Flatzy Telegram Listing Bot 🤖

A conversational Telegram Bot for **Flatzy Kolkata**. Users can submit flats for Rent or Resale along with photos directly from Telegram. Submissions appear in the **FlatzyAdmin** portal for one-click approval, and automatically go live on the **Flatzy** website upon approval.

---

## ⚡ How It Works

```
1. User chats with @FlatzyListingBot on Telegram
   └── Sends BHK, Price, Location, Contact, and Photos

2. Bot submits to Supabase
   └── Creates property record with `status: 'pending'` and `is_verified: false`

3. Shows in FlatzyAdmin Portal
   └── Appears in "Pending Review" queue with photo previews
   └── Click [ ✅ Approve & Publish ] or [ ❌ Reject ]

4. Live on Flatzy Website
   └── Once approved, instantly appears in Explore and Home on flatzy.vercel.app!
```

---

## 🚀 Setup & Run (in 3 Minutes)

### Step 1: Create Your Bot on Telegram
1. Open Telegram and search for **`@BotFather`**.
2. Send `/newbot`.
3. Give your bot a name (e.g. `Flatzy Listing Bot`) and a username (e.g. `FlatzyListingBot` or `MyFlatzyBot`).
4. Copy the **HTTP API Token** provided by BotFather.

### Step 2: Configure Environment
Open `flatzy-telegram-bot/.env` and paste your bot token:
```env
TELEGRAM_BOT_TOKEN=1234567890:ABCdefGhIJKlmNoPQRsTUVwxyZ
```
*(Supabase URL and Anon Key are already pre-filled!)*

### Step 3: Install & Start
In your terminal:
```bash
cd D:\1-Perfecto\flatzy-telegram-bot
npm install
npm start
```
You will see:
```
🚀 Flatzy Telegram Bot is online and listening for messages!
```

Now open Telegram, search for your bot, send `/start`, and try submitting a flat!

---

## 🌐 Free 24/7 Cloud Deployment (Optional)
To keep the bot running 24/7 without keeping your computer on:

1. Push this folder to a GitHub repository (e.g. `flatzy-telegram-bot`).
2. Go to [Render.com](https://render.com) or [Railway.app](https://railway.app).
3. Create a **New Background Worker** (or Web Service).
4. Add the Environment Variables from your `.env`.
5. Deploy! It will run 24/7 for free.

