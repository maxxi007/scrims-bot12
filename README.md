# Foresight Bot - Advanced Farlight 84 Scrims Manager

A comprehensive Discord bot for managing Farlight 84 competitive scrims with advanced features including thread-based team registration, dynamic lobby management, timed check-ins with captcha verification, and automated slot list generation.

## Features

### 🎮 Thread-Based Team Registration
- Interactive registration process through Discord threads
- 6 sequential questions with validation:
  1. **Team Name** - Minimum 3 characters
  2. **Team Tag** - [ABC] format, max 6 alphanumeric characters
  3. **Player 1 (Captain)** - Format: PlayerName#12345678
  4. **Player 2** - Format: PlayerName#12345678
  5. **Player 3** - Format: PlayerName#12345678
  6. **Teammate Mentions** - Must mention exactly 3 Discord users
- Automatic **eSports** role assignment for all team members
- Team captain-only edit/delete permissions (admins can override)

### 📅 Multi-Day Scrim Scheduling
- Schedule scrims for multiple days (e.g., Monday, Wednesday, Friday)
- Set custom check-in windows (start and end times)
- Automatic timezone handling (default: Asia/Kolkata)
- Role mentions when check-in opens

### 🔒 Timed Check-In System
- **Register Here** channel automatically locks/unlocks based on schedule
- Channel permissions:
  - **Before check-in**: Locked, not interactive
  - **During check-in**: Unlocked for eSports role members
  - **After check-in**: Locked again, not interactive
- Check-in button appears at exact scheduled time
- Word-based captcha verification (60-second timeout)
- Only registered teams with eSports role can access

### 🏆 Dynamic Lobby Management
- Automatic lobby creation (Lobby-1, Lobby-2, Lobby-3, etc.)
- 20 teams per lobby maximum
- Lobby assignment based on check-in order
- Lobby-specific roles (Lobby-1, Lobby-2, etc.)
- Role transfer system between teammates
- Transferring removes role from original holder

### 📊 Automated Slot Lists
- Slot lists automatically posted to respective lobby channels
- Shows all checked-in teams with their tags
- Displays check-in order and total team count
- Updates in real-time as teams check in

### 🎨 Canvas Leaderboards
- Professional leaderboard image generation
- Custom graphics with team rankings
- Placement points and kill points
- Top 3 teams highlighted (Gold, Silver, Bronze)
- Easy CSV input format

### 💾 SQLite3 Database
- Persistent team data storage
- Scrim schedules and configurations
- Daily check-in records
- Lobby assignments
- Captcha tracking

### 🌐 24/7 Uptime
- Express server on port 3000
- Health check endpoint at `/`
- Automatic restarts and error recovery

## Setup Instructions

### 1. Prerequisites
- Node.js 18 or higher
- Discord bot token
- Discord server (Guild) ID

### 2. Environment Variables
Create a `.env` file with the following:

```env
DISCORD_TOKEN=your_discord_bot_token_here
GUILD_ID=your_guild_id_here
TIMEZONE=Asia/Kolkata
PORT=3000
```

### 3. Install Dependencies
```bash
npm install
```

### 4. Run the Bot
```bash
npm start
```

## Discord Bot Setup

### Creating the Bot
1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application
3. Go to the "Bot" section
4. Click "Reset Token" and copy the token
5. Enable the following Privileged Gateway Intents:
   - Server Members Intent
   - Message Content Intent

### Inviting the Bot
Use this URL (replace CLIENT_ID with your application ID):
```
https://discord.com/oauth2/authorize?client_id=CLIENT_ID&permissions=8&scope=bot%20applications.commands
```

## Commands

### Admin Commands

#### `/create_scrim`
Create a new scrim schedule
- **scrim_name**: Name for the scrim
- **days**: Days (e.g., Monday,Wednesday,Friday)
- **start_time**: Check-in start time (HH:MM 24h format)
- **end_time**: Check-in end time (HH:MM 24h format)
- **mention_role**: (Optional) Role to mention when check-in opens

**Example:**
```
/create_scrim scrim_name:Daily Scrim days:Monday,Wednesday,Friday start_time:18:00 end_time:18:30 mention_role:@eSports
```

#### `/delete_scrim`
Delete a scrim schedule
- **scrim_name**: Name of the scrim to delete

#### `/list_teams`
View all registered teams with their details

#### `/delete_team`
Delete a specific team
- **team_name**: Team name to delete

#### `/create_leaderboard`
Generate a leaderboard image
- **scrim_name**: Scrim name
- **data**: Format: `TeamName,PlacementPoints,KillPoints` (one per line)

**Example:**
```
/create_leaderboard scrim_name:Daily Scrim data:
Team Alpha,25,15
Team Bravo,20,18
Team Charlie,18,12
```

#### `/force_checkin`
Force check-in a team (Admin only)
- **team_name**: Team name
- **scrim_name**: Scrim name

### Public Commands

#### `/view_slots`
View current check-in slots for today

## Channel Structure

The bot automatically creates the following channels in a "Scrims" category:

### 📝 scrim-registration
- Public channel for team registration
- Contains buttons:
  - **📝 Register Team** - Start team registration
  - **✏️ Edit Team** - Edit your existing team
  - **🗑️ Delete Team** - Remove your team

### ✅ register-here
- Check-in channel (restricted to eSports role)
- Automatically locks/unlocks based on scrim schedule
- Check-in button appears during active windows
- Captcha verification required

### 🏆 lobby-1, lobby-2, lobby-3...
- Automatically created as teams check in
- 20 teams per lobby
- Contains slot lists and role transfer buttons

### 📋 scrim-log
- Admin-only logging channel
- Records all team registrations, check-ins, and deletions

## Roles

### eSports
- Assigned to all registered team members
- Grants access to the "register-here" channel
- Required to check in for scrims

### Lobby-1, Lobby-2, Lobby-3...
- Assigned on check-in
- Grants access to respective lobby channels
- Can be transferred between teammates

## Team Registration Flow

1. Click **📝 Register Team** button in #scrim-registration
2. A private thread is created for you
3. Answer 6 questions:
   - Team Name
   - Team Tag ([ABC] format)
   - Player 1 details (Captain)
   - Player 2 details
   - Player 3 details
   - Mention 3 teammates
4. All team members receive the **eSports** role
5. Thread automatically archives after completion

## Check-In Flow

1. Wait for check-in to open (announced in #register-here)
2. Click **✅ Check In Team** button
3. Receive a captcha word in a private message
4. Type the captcha word within 60 seconds
5. Get assigned to a lobby (Lobby-1, Lobby-2, etc.)
6. Receive the lobby role
7. Check the slot list in your lobby channel

## Lobby Role Transfer

1. Go to your lobby channel
2. Click the **🔄 Transfer Role** button
3. Your lobby role is transferred to a teammate
4. You lose the lobby role

## Database Schema

### teams
- team_name (PRIMARY KEY)
- team_tag
- captain_id, captain_name
- player2_id, player2_name
- player3_id, player3_name
- created_at

### scrims
- scrim_name (PRIMARY KEY)
- days
- start_time, end_time
- mention_role_id
- created_at

### daily_registration
- scrim_name, scrim_date, team_name
- checked_in_by
- lobby_number
- check_in_order
- checked_in_at

### lobby_roles
- scrim_name, scrim_date
- user_id
- lobby_number
- assigned_at

### captcha_tracking
- user_id, scrim_name, scrim_date
- captcha_word
- verified

## Technical Details

### Built With
- **discord.js v14** - Discord API interactions
- **Express** - Health check server
- **Canvas** - Leaderboard image generation
- **SQLite3** - Database management
- **moment-timezone** - Timezone handling
- **node-cron** - Scheduled tasks
- **dotenv** - Environment configuration

### System Architecture
- Event-driven Discord bot
- Thread-based conversation flows
- Automated cron jobs for scrim scheduling
- Dynamic channel and role creation
- Real-time permission management

## Troubleshooting

### Bot not responding
- Check if the bot is online in your server
- Verify DISCORD_TOKEN and GUILD_ID are set correctly
- Check console logs for errors

### Canvas errors (libuuid.so.1)
- System dependencies required for Canvas
- On Replit/NixOS, these are automatically installed
- Locally, install: `libuuid`, `cairo`, `pango`, `libjpeg`, `giflib`, `librsvg`, `pixman`

### Check-in not opening
- Verify scrim schedule is created correctly
- Check if current day matches scrim days
- Confirm time format is HH:MM (24-hour)
- Check server timezone setting

### Teams not receiving roles
- Verify bot has "Manage Roles" permission
- Ensure bot role is higher than target roles
- Check member mentions are valid

## License

MIT License - Feel free to use and modify for your community!

## Support

For issues or questions, please check the console logs or contact your server administrator.
