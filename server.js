require("dotenv").config();
const express = require("express");
const session = require("express-session");
const rateLimit = require("express-rate-limit");
const Database = require("better-sqlite3");
const path = require("path");
const crypto = require("crypto");

const app = express();
const db = new Database("showdown.sqlite");
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  discord_id TEXT PRIMARY KEY, username TEXT NOT NULL, avatar TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS point_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, discord_id TEXT NOT NULL,
  points INTEGER NOT NULL, reason TEXT NOT NULL, unique_key TEXT UNIQUE,
  created_by TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS missions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL,
  description TEXT NOT NULL, points INTEGER NOT NULL DEFAULT 10,
  active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT, discord_id TEXT NOT NULL,
  mission_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
  UNIQUE(discord_id, mission_id)
);
`);
const env = (k, fallback = "") => process.env[k] || fallback;
const admins = new Set(env("ADMIN_DISCORD_IDS").split(",").map(x => x.trim()).filter(Boolean));
const startDate = env("CONTEST_START", "2026-11-25");
const endDate = env("CONTEST_END", "2026-12-25");
const zone = env("TIME_ZONE", "America/New_York");

app.use(express.json());
app.use(session({
  name: "tt_showdown",
  secret: env("SESSION_SECRET", "development-only-change-me"),
  resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: env("BASE_URL").startsWith("https://"), maxAge: 7*24*60*60*1000 }
}));
app.use(express.static(path.join(__dirname, "public")));

const apiLimiter = rateLimit({ windowMs: 60_000, limit: 90, standardHeaders: true, legacyHeaders: false });
app.use("/api", apiLimiter);

function requireAuth(req,res,next) {
  if (!req.session.user) return res.status(401).json({error:"Sign in with Discord to continue."});
  next();
}
function requireAdmin(req,res,next) {
  if (!req.session.user || !admins.has(req.session.user.id)) return res.status(403).json({error:"Admin access only."});
  next();
}
function contestDate() {
  return new Intl.DateTimeFormat("en-CA", {timeZone:zone, year:"numeric", month:"2-digit", day:"2-digit"}).format(new Date());
}
function inContest() {
  const d = contestDate();
  return d >= startDate && d <= endDate;
}
function totalPoints(id) {
  return db.prepare("SELECT COALESCE(SUM(points),0) AS n FROM point_events WHERE discord_id=?").get(id).n;
}
function addPoints(id, points, reason, uniqueKey, createdBy="system") {
  if (!Number.isInteger(points) || points < 1 || points > 100) throw new Error("Points must be between 1 and 100.");
  db.prepare("INSERT INTO point_events(discord_id,points,reason,unique_key,created_by) VALUES(?,?,?,?,?)")
    .run(id, points, reason, uniqueKey || null, createdBy);
}
function streakFor(id) {
  const days = db.prepare(`
    SELECT DISTINCT substr(created_at,1,10) AS day FROM point_events
    WHERE discord_id=? AND reason='Daily Discord check-in'
  `).all(id).map(x=>x.day).sort().reverse();
  // Use Eastern calendar dates for check-ins (saved as explicit date in unique key).
  const checkins = db.prepare("SELECT unique_key FROM point_events WHERE discord_id=? AND reason='Daily Discord check-in' ORDER BY id DESC").all(id)
    .map(x => (x.unique_key || "").replace("checkin:","")).filter(Boolean);
  let streak=0, cursor = contestDate();
  const set = new Set(checkins);
  while (set.has(cursor)) {
    streak++;
    const dt = new Date(cursor+"T12:00:00Z"); dt.setUTCDate(dt.getUTCDate()-1);
    cursor = dt.toISOString().slice(0,10);
  }
  return streak;
}
function avatarUrl(u) {
  return u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=128`
    : `https://cdn.discordapp.com/embed/avatars/0.png`;
}
app.get("/auth/discord", (req,res) => {
  const id=env("DISCORD_CLIENT_ID"), redirect=env("DISCORD_REDIRECT_URI");
  if (!id || !redirect) return res.status(503).send("Discord OAuth is not configured yet. Add your Discord application details to .env.");
  const state=crypto.randomBytes(24).toString("hex"); req.session.oauthState=state;
  const url=new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("client_id",id); url.searchParams.set("response_type","code");
  url.searchParams.set("redirect_uri",redirect); url.searchParams.set("scope","identify guilds.members.read");
  url.searchParams.set("state",state);
  res.redirect(url.toString());
});
app.get("/auth/discord/callback", async (req,res) => {
  try {
    if (!req.query.code || req.query.state !== req.session.oauthState) return res.status(400).send("Discord sign-in could not be verified. Please try again.");
    const form=new URLSearchParams({client_id:env("DISCORD_CLIENT_ID"),client_secret:env("DISCORD_CLIENT_SECRET"),grant_type:"authorization_code",code:req.query.code,redirect_uri:env("DISCORD_REDIRECT_URI")});
    const tokenRes=await fetch("https://discord.com/api/oauth2/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:form});
    const token=await tokenRes.json();
    if (!token.access_token) throw new Error("Discord did not return an access token.");
    const headers={Authorization:`Bearer ${token.access_token}`};
    const [meRes, memberRes]=await Promise.all([
      fetch("https://discord.com/api/users/@me",{headers}),
      fetch(`https://discord.com/api/users/@me/guilds/${env("DISCORD_GUILD_ID")}/member`,{headers})
    ]);
    const me=await meRes.json();
    if (!me.id || !memberRes.ok) return res.status(403).send("This competition is restricted to members of the TotallyTapi Discord server. Join the server and sign in again.");
    const member=await memberRes.json();
    const user={id:me.id, username:me.global_name || me.username, avatar:me.avatar, roles:member.roles || []};
    db.prepare("INSERT INTO users(discord_id,username,avatar) VALUES(?,?,?) ON CONFLICT(discord_id) DO UPDATE SET username=excluded.username,avatar=excluded.avatar")
      .run(user.id,user.username,user.avatar);
    req.session.user=user; delete req.session.oauthState;
    res.redirect("/");
  } catch(e) {
    console.error(e); res.status(500).send("Discord sign-in failed. Please try again.");
  }
});
app.post("/auth/logout", (req,res)=>req.session.destroy(()=>res.json({ok:true})));

app.get("/api/me", (req,res) => {
  if (!req.session.user) return res.json({signedIn:false});
  const u=req.session.user;
  res.json({signedIn:true,user:{id:u.id,username:u.username,avatar:avatarUrl(u),admin:admins.has(u.id)},points:totalPoints(u.id),streak:streakFor(u.id),inContest:inContest()});
});
app.get("/api/leaderboard", (req,res) => {
  const rows=db.prepare(`
    SELECT u.discord_id AS id,u.username,u.avatar,COALESCE(SUM(p.points),0) AS points
    FROM users u LEFT JOIN point_events p ON p.discord_id=u.discord_id
    GROUP BY u.discord_id ORDER BY points DESC,u.username COLLATE NOCASE ASC LIMIT 100
  `).all().map((u,i)=>({rank:i+1,username:u.username,avatar:avatarUrl({id:u.id,avatar:u.avatar}),points:u.points}));
  res.json({leaderboard:rows});
});
app.get("/api/missions", requireAuth, (req,res) => {
  const rows=db.prepare(`
    SELECT m.*,c.status AS my_status FROM missions m
    LEFT JOIN claims c ON c.mission_id=m.id AND c.discord_id=?
    WHERE m.active=1 ORDER BY m.id DESC
  `).all(req.session.user.id);
  res.json({missions:rows});
});
app.post("/api/checkin", requireAuth, (req,res) => {
  if (!inContest()) return res.status(400).json({error:"Daily check-ins are only available during the contest dates."});
  const day=contestDate();
  try {
    addPoints(req.session.user.id,5,"Daily Discord check-in",`checkin:${day}`);
    const streak=streakFor(req.session.user.id);
    let bonus=false;
    if (streak>0 && streak%7===0) {
      try { addPoints(req.session.user.id,10,`${streak}-day check-in streak bonus`,`streak:${req.session.user.id}:${streak}`); bonus=true; } catch {}
    }
    res.json({ok:true,points:totalPoints(req.session.user.id),streak,bonus,message:bonus?`Check-in saved! ${streak}-day streak bonus unlocked!`:"Daily check-in saved! +5 points."});
  } catch(e) {
    if (String(e).includes("UNIQUE")) return res.status(409).json({error:"You've already checked in today. Come back tomorrow!"});
    res.status(400).json({error:e.message});
  }
});
app.post("/api/missions/:id/claim", requireAuth, (req,res) => {
  const m=db.prepare("SELECT * FROM missions WHERE id=? AND active=1").get(req.params.id);
  if (!m) return res.status(404).json({error:"Mission not found."});
  try {
    db.prepare("INSERT INTO claims(discord_id,mission_id,status) VALUES(?,?,'pending')").run(req.session.user.id,m.id);
    res.json({ok:true,message:"Mission submitted for moderator verification."});
  } catch { res.status(409).json({error:"You've already submitted this mission."}); }
});
app.get("/api/admin/summary", requireAdmin, (req,res) => {
  res.json({
    members:db.prepare("SELECT COUNT(*) n FROM users").get().n,
    totalPoints:db.prepare("SELECT COALESCE(SUM(points),0) n FROM point_events").get().n,
    pending:db.prepare("SELECT COUNT(*) n FROM claims WHERE status='pending'").get().n,
    missions:db.prepare("SELECT * FROM missions ORDER BY id DESC").all(),
    claims:db.prepare(`SELECT c.id,c.status,c.mission_id,u.username,m.title,m.points,c.discord_id
      FROM claims c JOIN users u ON u.discord_id=c.discord_id JOIN missions m ON m.id=c.mission_id
      ORDER BY c.id DESC LIMIT 100`).all()
  });
});
app.post("/api/admin/points", requireAdmin, (req,res) => {
  const {discordId,points,reason}=req.body;
  if (!db.prepare("SELECT 1 FROM users WHERE discord_id=?").get(discordId)) return res.status(404).json({error:"Member not found. They must sign in first."});
  try { addPoints(discordId,Number(points),String(reason||"Moderator award").slice(0,120),`admin:${crypto.randomUUID()}`,req.session.user.id); res.json({ok:true}); }
  catch(e){res.status(400).json({error:e.message});}
});
app.post("/api/admin/missions", requireAdmin, (req,res) => {
  const {title,description,points}=req.body;
  if (!title || !description) return res.status(400).json({error:"Title and description are required."});
  try {
    db.prepare("INSERT INTO missions(title,description,points) VALUES(?,?,?)").run(String(title).slice(0,80),String(description).slice(0,300),Number(points));
    res.json({ok:true});
  } catch(e){res.status(400).json({error:e.message});}
});
app.post("/api/admin/missions/:id/toggle", requireAdmin, (req,res) => {
  db.prepare("UPDATE missions SET active=1-active WHERE id=?").run(req.params.id); res.json({ok:true});
});
app.post("/api/admin/claims/:id/approve", requireAdmin, (req,res) => {
  const claim=db.prepare(`SELECT c.*,m.points,m.title FROM claims c JOIN missions m ON m.id=c.mission_id WHERE c.id=?`).get(req.params.id);
  if (!claim || claim.status!=="pending") return res.status(404).json({error:"Pending claim not found."});
  const tx=db.transaction(()=>{
    db.prepare("UPDATE claims SET status='approved' WHERE id=?").run(claim.id);
    addPoints(claim.discord_id,claim.points,`Mission: ${claim.title}`,`mission:${claim.id}`,req.session.user.id);
  });
  try {tx();res.json({ok:true});}catch(e){res.status(400).json({error:e.message});}
});
app.post("/api/admin/claims/:id/reject", requireAdmin, (req,res) => {
  db.prepare("UPDATE claims SET status='rejected' WHERE id=? AND status='pending'").run(req.params.id); res.json({ok:true});
});

app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
const port=Number(env("PORT",3000));
app.listen(port,()=>console.log(`TotallyTapi Showdown running on port ${port}`));
