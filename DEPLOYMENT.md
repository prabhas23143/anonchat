# AnonChat - 0-Cost Deployment Guide (Render + Cloudflare Pages)

This guide walks you through deploying your random text chat Omegle clone completely free with zero hosting bills.

---

## Architecture Overview

| Component | Service | Cost | Features |
|---|---|---|---|
| **Backend** | **Render.com** (Web Service) | $0 / Free Tier | Node.js + Express + Socket.io, matchmaking queue, WebSockets |
| **Frontend** | **Cloudflare Pages** | $0 / Free Tier | Unlimited bandwidth, global CDN, DDoS protection, fast HTTPS |
| **Monetization** | **Adsterra / PropellerAds** | Revenue | Header/footer banner slots + Social Bar / Popunder scripts |
| **Keep-Alive** | **UptimeRobot** | $0 / Free Tier | Pings backend every 10 mins to prevent Render instance sleep |

---

## Step 1: Deploy Backend to Render.com

1. Sign up for free at [render.com](https://render.com).
2. Push your project to GitHub (make sure the `backend` folder contains `package.json` and `server.js`).
3. In Render Dashboard, click **New +** > **Web Service**.
4. Connect your GitHub repository.
5. Configure the settings:
   - **Name**: `omegle-clone-backend` (or your preferred name)
   - **Root Directory**: `backend`
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Plan**: Select **Free** ($0/month)
6. Add Environment Variables (under **Advanced**):
   - `PORT`: `3001` (or leave default, Render sets this automatically)
   - `CLIENT_URL`: `*` (or your Cloudflare Pages URL once deployed)
7. Click **Create Web Service**.
8. Once deployed, copy your backend URL: e.g. `https://omegle-clone-backend.onrender.com`.

---

## Step 2: Configure & Deploy Frontend to Cloudflare Pages

1. Open `frontend/script.js`:
   Replace the placeholder `DEFAULT_RENDER_URL` with your actual Render URL:
   ```javascript
   const DEFAULT_RENDER_URL = 'https://omegle-clone-backend.onrender.com';
   ```
2. Sign up at [pages.cloudflare.com](https://pages.cloudflare.com).
3. Click **Create a project** > **Connect to Git**.
4. Select your repository.
5. In the build settings:
   - **Framework preset**: `None`
   - **Build command**: *(Leave blank)*
   - **Build output directory**: `frontend`
   - **Root directory**: `/` (or `frontend` if deploying from subfolder)
6. Click **Save and Deploy**.
7. In ~30 seconds, your site will be live at `https://your-project.pages.dev`!

---

## Step 3: Prevent Render Cold Starts (Free Keep-Alive)

Render's free tier spins down after 15 minutes of inactivity. To keep your chat instantaneous 24/7:
1. Go to [uptimerobot.com](https://uptimerobot.com) and create a free account.
2. Click **Add New Monitor**.
3. Settings:
   - **Monitor Type**: `HTTP(s)`
   - **Friendly Name**: `AnonChat Backend Keep-Alive`
   - **URL**: `https://your-backend.onrender.com/health`
   - **Monitoring Interval**: Every 10 minutes
4. Click **Create Monitor**. Your Render backend will now stay awake and responsive!

---

## Step 4: Monetization (Adsterra & PropellerAds)

### Adsterra Setup:
1. Register as a Publisher at [adsterra.com](https://adsterra.com).
2. Add your Cloudflare Pages domain (e.g. `your-project.pages.dev`).
3. Recommended Ad Units:
   - **728x90 Leaderboard** or **320x50 Mobile**: Paste the ad snippet inside `<div class="ad-banner-slot" id="header-ad-container">` in `frontend/index.html`.
   - **Social Bar**: Paste the JavaScript snippet directly in the `<head>` of `frontend/index.html`. It looks like an iOS notification and has high CPM.
   - **Popunder**: Add before `</body>`.

### PropellerAds Setup:
1. Register at [propellerads.com](https://propellerads.com).
2. Verify domain with Cloudflare DNS or HTML file.
3. Choose **MultiTag** or **Interstitial** / **Push Notifications** and paste into `frontend/index.html`.
