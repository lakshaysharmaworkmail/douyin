# Douyin Live Scraper — Web App

Google Apps Script se convert kiya hua Node.js/Express web app.

## Local Run

```bash
npm install
npm start
# http://localhost:3000
```

## Deploy to Vercel (Free)

1. [vercel.com](https://vercel.com) pe account banao
2. GitHub pe repo push karo
3. Vercel dashboard → **New Project** → repo import karo
4. Settings default rehne do → **Deploy**
5. Done! Auto URL milega jaise `https://your-app.vercel.app`

## Deploy to Render (Free)

1. [render.com](https://render.com) pe account banao
2. **New → Web Service** → GitHub repo connect karo
3. Settings:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Environment:** Node
4. Deploy karo

## Deploy to Railway

1. [railway.app](https://railway.app) pe login karo
2. **New Project → Deploy from GitHub repo**
3. Automatic detect hoga, deploy ho jayega

## API Endpoints

### POST /api/scrape
Single URL scrape karo
```json
{ "url": "https://live.douyin.com/123456789" }
```

### POST /api/scrape/batch
50 URLs tak ek saath
```json
{ "urls": ["https://live.douyin.com/111", "..."] }
```

### GET /api/scrape?url=...
Browser se quick test ke liye

## Response Format
```json
{
  "success": true,
  "data": {
    "status": "🟢 Live",
    "title": "Live room title",
    "nickname": "Streamer name",
    "totalViewers": "12000",
    "profileUrl": "https://www.douyin.com/user/...",
    "taskStatus": "✅ Done"
  }
}
```
