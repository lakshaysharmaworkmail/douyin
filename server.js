const express = require("express");
const axios = require("axios");
const path = require("path");
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// ============================================================
// Helpers (ported from Apps Script)
// ============================================================

function normaliseLiveUrl(raw) {
  if (raw.indexOf("live.douyin.com") !== -1) return raw.split("?")[0];
  const digits = raw.replace(/[^0-9]/g, "");
  return "https://live.douyin.com/" + digits;
}

function buildHeaders() {
  return {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Referer": "https://www.douyin.com/",
    "Cache-Control": "no-cache",
  };
}

function safeDecode(str) {
  if (!str) return "";
  try { return decodeURIComponent(str); } catch (e) {
    return str.replace(/%[0-9A-Fa-f]{2}/g, (t) => {
      try { return decodeURIComponent(t); } catch (e2) { return t; }
    });
  }
}

function unescape_(s) {
  if (!s) return "";
  return String(s)
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, c) => String.fromCharCode(parseInt(c, 16)))
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, c) => String.fromCharCode(parseInt(c, 16)))
    .replace(/\\n/g, " ").replace(/\\"/g, '"')
    .replace(/\b(\d+(?:\.\d+)?)w\+/gi, "$1万+")
    .trim();
}

function parseWan(str) {
  const s = String(str).trim();
  const wan = s.match(/^([\d.]+)万/);
  if (wan) return Math.round(parseFloat(wan[1]) * 10000).toString();
  const num = parseFloat(s);
  return isNaN(num) ? s : Math.round(num).toString();
}

function extractTotalViewers(html) {
  const patterns = [
    /"total_user"\s*:\s*([0-9]+)/,
    /"total_user_str"\s*:\s*"([^"]+)"/,
    /"viewer_count"\s*:\s*([0-9]+)/,
    /"viewerCount"\s*:\s*([0-9]+)/,
    /"online_user"\s*:\s*([0-9]+)/,
    /"onlineUser"\s*:\s*([0-9]+)/,
    /"user_count"\s*:\s*([0-9]+)/,
    /"userCount"\s*:\s*([0-9]+)/,
  ];
  for (const pat of patterns) {
    const m = html.match(pat);
    if (m && m[1]) {
      return /^\d+$/.test(m[1]) ? m[1] : parseWan(m[1]);
    }
  }
  const wanMatch = html.match(/([\d.]+)\s*万/);
  if (wanMatch) return parseWan(wanMatch[1] + "万");
  const people = html.replace(/<[^>]+>/g, " ").match(/(\d{1,6}(?:,\d{3})*)\s*人/);
  if (people) return people[1].replace(/,/g, "");
  return "";
}

function getTaskStatus(data) {
  const s = data.status || "";
  if (s.includes("⚠️") || s.includes("HTTP") || s.includes("error")) return "❌ Not Found";
  if (s.includes("🟢") || s.includes("🔴") || s.includes("⚫")) {
    if (data.title || data.nickname || data.totalViewers) return "✅ Done";
    return "⏳ Pending";
  }
  return "⏳ Pending";
}

function extractQuot(html, patterns) {
  for (const pat of patterns) {
    const m = html.match(pat);
    if (m && m[1]) return unescape_(m[1]);
  }
  return "";
}

function extract_(html, patterns) {
  for (const pat of patterns) {
    const m = html.match(pat);
    if (m && m[1]) return unescape_(m[1]);
  }
  return "";
}

function findInJson(obj, key, depth = 0) {
  if (depth > 12 || !obj || typeof obj !== "object") return null;
  if (obj[key] !== undefined && obj[key] !== null && obj[key] !== "") return obj[key];
  for (const k of Object.keys(obj)) {
    const r = findInJson(obj[k], key, depth + 1);
    if (r !== null && r !== undefined && r !== "") return r;
  }
  return null;
}

function errData(msg) {
  return { status: msg, title: "", nickname: "", secUid: "", totalViewers: "" };
}

function isUseful(d) {
  return !!(d && (d.title || d.totalViewers || d.status === "🟢 Live" || d.status === "🔴 Ended" || d.nickname));
}

function tryDataAttributes(html) {
  let nickname = "", secUid = "", title = "", statusCode = "";
  const am = html.match(/data-anchor-info="([^"]+)"/);
  if (am) {
    try {
      const anchor = JSON.parse(am[1].replace(/&quot;/g, '"').replace(/&#x2F;/g, '/'));
      nickname = anchor.nickname || "";
    } catch (e) {}
  }
  if (!title) title = extractQuot(html, [
    /&quot;title&quot;:&quot;([^&]{2,150})&quot;/,
    /&quot;roomTitle&quot;:&quot;([^&]{2,150})&quot;/,
    /&quot;live_room_name&quot;:&quot;([^&]{2,150})&quot;/,
  ]);
  if (!title) {
    const tm = html.match(/\\"title\\":\\"([^\\]{2,150})\\"/);
    if (tm) title = tm[1];
  }
  secUid = extractQuot(html, [
    /&quot;sec_uid&quot;:&quot;([A-Za-z0-9_\-]{20,})&quot;/,
    /&quot;secUid&quot;:&quot;([A-Za-z0-9_\-]{20,})&quot;/,
  ]);
  if (!secUid) {
    let suMatch = html.match(/"sec_uid"\s*:\s*"([A-Za-z0-9_\-]{20,})"/);
    if (!suMatch) suMatch = html.match(/\\"sec_uid\\":\\"([A-Za-z0-9_\-]{20,})\\"/);
    if (suMatch) secUid = suMatch[1];
  }
  statusCode = extractQuot(html, [/&quot;status&quot;:([0-9])/]);
  if (!statusCode) {
    let sm = html.match(/\\"status\\":([0-9])/);
    if (!sm) sm = html.match(/"status"\s*:\s*([0-9])/);
    if (sm) statusCode = sm[1];
  }
  const totalViewers = extractTotalViewers(html);
  const sc = parseInt(statusCode);
  let status = "";
  if      (sc === 2)                  status = "🟢 Live";
  else if (sc === 4)                  status = "🔴 Ended";
  else if (!title && !totalViewers)   status = "⚠️ No Data";
  else                                status = "⚫ Offline";
  return { status, title: unescape_(title), nickname: unescape_(nickname), secUid, totalViewers };
}

function extractFromParsedJson(json, html) {
  try {
    const title      = findInJson(json, "title")    || findInJson(json, "roomTitle") || "";
    const nickname   = findInJson(json, "nickname") || "";
    const secUid     = findInJson(json, "sec_uid")  || findInJson(json, "secUid")   || "";
    const statusCode = findInJson(json, "status");
    const sc = parseInt(statusCode);
    let status;
    if      (sc === 2) status = "🟢 Live";
    else if (sc === 4) status = "🔴 Ended";
    else               status = "⚫ Offline";
    const totalViewers = extractTotalViewers(html);
    if (!totalViewers && !title) status = "⚠️ No Data";
    return { status, title: unescape_(title), nickname: unescape_(nickname), secUid: String(secUid), totalViewers };
  } catch (e) { return null; }
}

function tryRenderData(html) {
  const m = html.match(/<script[^>]+id=["']RENDER_DATA["'][^>]*>([^<]+)<\/script>/i);
  if (!m || !m[1]) return null;
  try { return extractFromParsedJson(JSON.parse(safeDecode(m[1].trim())), html); }
  catch (e) { return null; }
}

function tryNextData(html) {
  const m = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!m || !m[1]) return null;
  try { return extractFromParsedJson(JSON.parse(m[1].trim()), html); }
  catch (e) { return null; }
}

function tryRegexFallback(html) {
  const title = extract_(html, [
    /\\{2,4}"title\\{2,4}":\\{2,4}"([^\\]{2,150})\\{2,4}"/,
    /"roomTitle"\s*:\s*"([^"]{2,150})"/,
    /"title"\s*:\s*"([^"]{2,120})"/,
    /<title>\s*([^<|—\-]{5,100})/,
  ]);
  const nickname = extract_(html, [
    /\\{2,4}"nickname\\{2,4}":\\{2,4}"([^\\]{2,80})\\{2,4}"/,
    /"nickname"\s*:\s*"([^"]{2,60})"/,
  ]);
  const secUid = extract_(html, [
    /\\{2,4}"sec_uid\\{2,4}":\\{2,4}"([A-Za-z0-9_\-]{20,})\\{2,4}"/,
    /"sec_uid"\s*:\s*"([A-Za-z0-9_\-]{20,})"/,
  ]);
  const isLive  = /status\\{2,4}":\\{2,4}2[^0-9]|"status"\s*:\s*2[^0-9]/.test(html);
  const isEnded = /status\\{2,4}":\\{2,4}4[^0-9]|"status"\s*:\s*4[^0-9]/.test(html);
  const totalViewers = extractTotalViewers(html);
  const status = isEnded ? "🔴 Ended" : isLive ? "🟢 Live" : (!title && !totalViewers) ? "⚠️ No Data" : "⚫ Offline";
  return { status, title, nickname, secUid, totalViewers };
}

function parseLivePage(html) {
  let data = tryDataAttributes(html);
  if (data && isUseful(data)) return data;
  data = tryRenderData(html);
  if (data && isUseful(data)) return data;
  data = tryNextData(html);
  if (data && isUseful(data)) return data;
  return tryRegexFallback(html);
}

// ============================================================
// Core scrape function
// ============================================================

async function scrapeUrl(rawUrl) {
  const liveUrl = normaliseLiveUrl(rawUrl.trim());
  try {
    const response = await axios.get(liveUrl, {
      headers: buildHeaders(),
      maxRedirects: 5,
      timeout: 15000,
      validateStatus: () => true,
    });
    if (response.status !== 200) return errData("HTTP " + response.status);
    const html = response.data;
    const data = parseLivePage(html);
    return data;
  } catch (err) {
    return errData("Fetch error: " + err.message.substring(0, 60));
  }
}

// ============================================================
// API Routes
// ============================================================

// Single URL scrape
app.post("/api/scrape", async (req, res) => {
  const url = req.body.url || req.body.douyinUrl;
  if (!url) return res.json({ success: false, error: "URL required" });

  const liveUrl = normaliseLiveUrl(url.trim());
  const data = await scrapeUrl(url);
  const profileUrl = data.secUid ? "https://www.douyin.com/user/" + data.secUid : "";
  const taskStatus = getTaskStatus(data);

  res.json({
    success: taskStatus === "✅ Done",
    data: {
      status: data.status,
      title: data.title || "",
      nickname: data.nickname || "",
      totalViewers: data.totalViewers || "",
      profileUrl,
      secUid: data.secUid || "",
      taskStatus,
    },
    debug: { originalUrl: url, normalisedUrl: liveUrl },
  });
});

// Batch scrape (multiple URLs at once)
app.post("/api/scrape/batch", async (req, res) => {
  const urls = req.body.urls;
  if (!Array.isArray(urls) || urls.length === 0)
    return res.json({ success: false, error: "urls array required" });
  if (urls.length > 50)
    return res.json({ success: false, error: "Max 50 URLs per batch" });

  const results = await Promise.all(
    urls.map(async (rawUrl) => {
      const data = await scrapeUrl(rawUrl);
      const profileUrl = data.secUid ? "https://www.douyin.com/user/" + data.secUid : "";
      const taskStatus = getTaskStatus(data);
      return {
        url: rawUrl,
        status: data.status,
        title: data.title || "",
        nickname: data.nickname || "",
        totalViewers: data.totalViewers || "",
        profileUrl,
        taskStatus,
      };
    })
  );
  res.json({ success: true, count: results.length, results });
});

// GET version (for quick browser testing)
app.get("/api/scrape", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.json({ success: false, error: "?url= parameter required" });
  req.body = { url };
  // reuse POST handler
  const fakeRes = {
    _data: null,
    json(d) { this._data = d; res.json(d); },
  };
  await app._router.handle({ ...req, method: "POST", path: "/api/scrape" }, fakeRes, () => {});
});

// Serve frontend
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Douyin Scraper running on http://localhost:${PORT}`));

module.exports = app;
