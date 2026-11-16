# TotallyTapi Christmas Showdown

A custom Discord-gated competition website with member profiles, daily check-ins, streak bonuses, a points ledger, leaderboard, mission submissions, and admin moderation.

## Important before launch

This is a deployable starter project, not a hosted/live website yet. Discord sign-in and member-only access work after you configure a Discord application, a bot, environment variables, and deploy it to a host that supports a persistent Node.js process and disk storage.

### 1. Requirements
- Node.js 20+
- A Discord account with permission to configure your community server
- A hosting provider that supports Node.js and persistent storage (for example, a small VPS or suitable Node host)

### 2. Create the Discord application
1. Open https://discord.com/developers/applications and create an application named `TotallyTapi Christmas Showdown`.
2. Under **OAuth2**, add the exact redirect URI:
   `https://YOUR-DOMAIN/auth/discord/callback`
3. Copy the Client ID and Client Secret.
4. Under **Bot**, create a bot and copy its token. Keep this token private.
5. Copy your Discord server (guild) ID. Enable Developer Mode in Discord, then right-click the server and choose Copy Server ID.
6. Add the bot to your server. The current app checks membership using Discord's OAuth `guilds.members.read` scope; the bot token is retained for future role-gated enhancements and should never be exposed in browser code.

### 3. Configure
```bash
cp .env.example .env
```
Fill in:
- `BASE_URL`
- `SESSION_SECRET` (use a long random value)
- `DISCORD_CLIENT_ID`
- `DISCORD_CLIENT_SECRET`
- `DISCORD_REDIRECT_URI`
- `DISCORD_GUILD_ID`
- `ADMIN_DISCORD_IDS` (your Discord user ID, plus trusted moderator IDs)

`DISCORD_BOT_TOKEN` is reserved for future bot-based integrations; do not share it.

### 4. Install and run
```bash
npm install
npm start
```
Open `http://localhost:3000`.

### 5. Deploy
Deploy the project to a Node.js host, set the same environment variables in the host dashboard, and use the host's persistent disk/volume for `showdown.sqlite`. Set `BASE_URL` and the Discord redirect URI to your real HTTPS domain. Do not deploy with the example session secret.

## Features
- Discord OAuth login
- Discord server membership check at login
- User profiles and cumulative points
- Daily check-in: +5, once per Eastern date during Nov 25–Dec 25, 2026
- +10 bonus on each 7-day consecutive check-in streak milestone
- Leaderboard
- Mission publishing, member submissions, and admin approval
- Admin manual point awards
- Contest overview, points menu, schedule, and rules

## Admin access
Add one or more Discord user IDs to `ADMIN_DISCORD_IDS`, comma-separated. Admins can award points and publish missions. Mission claims must be approved by an admin before points are awarded.

## Contest configuration and policies to finalize
Before launch, publish final official rules including:
- Exact iPad model, storage, retail value, and prize delivery method
- Eligible countries/states and any local eligibility restrictions
- Final tie-break procedure
- Tax and shipping responsibility, where applicable
- A clear privacy notice and contact method
- Legal review of applicable contest/sweepstakes requirements

The starter rules say participants must be 18+. Confirm that this is appropriate for your intended audience before publication.

## Security notes / production checklist
- Use HTTPS in production.
- Set a strong unique `SESSION_SECRET`.
- Keep `.env`, Discord secrets, and database backups private.
- Configure a persistent disk for SQLite.
- Use a managed session store for multi-instance deployments; the default Express MemoryStore is for a simple single-instance starter only.
- Add a privacy policy and retention/deletion process before collecting participant data.
- Consider adding role-based access, audit-log export, CSRF protection, and a Discord bot for automatic event attendance verification before scaling.
- The website does not automatically verify Twitch watch time, Instagram/TikTok/YouTube follows, or attendance in voice channels. Those activities need moderator verification or a future bot/integration.
