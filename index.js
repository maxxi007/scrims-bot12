require('dotenv').config();
const { Client, GatewayIntentBits, Partials, REST, Routes,
        ActionRowBuilder, ButtonBuilder, ButtonStyle,
        PermissionsBitField, EmbedBuilder, ChannelType,
        StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
const express = require('express');
const Canvas = require('canvas');
const moment = require('moment-timezone');
const cron = require('node-cron');
const db = require('./database');
const utils = require('./utils');

const TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const SERVER_TZ = process.env.TIMEZONE || 'Asia/Kolkata';
const PORT = process.env.PORT || 3000;

if (!TOKEN || !GUILD_ID) {
  console.error('DISCORD_TOKEN and GUILD_ID must be set in .env file');
  process.exit(1);
}

const app = express();
app.get('/', (req, res) => {
  res.send('Bot is alive!');
});

app.listen(PORT, () => {
  console.log(`Express server running on port ${PORT}`);
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel, Partials.Message]
});

const activeThreads = new Map();
const checkInStates = new Map();
let cronTask = null;

const commands = [
  {
    name: 'create_scrim',
    description: 'Create a new scrim schedule (Admin only)',
    options: [
      { name: 'scrim_name', type: 3, description: 'Name for the scrim', required: true },
      { name: 'days', type: 3, description: 'Days (e.g., Monday,Wednesday,Friday)', required: true },
      { name: 'start_time', type: 3, description: 'Check-in start time (HH:MM 24h format)', required: true },
      { name: 'end_time', type: 3, description: 'Check-in end time (HH:MM 24h format)', required: true },
      { name: 'mention_role', type: 8, description: 'Role to mention when check-in opens', required: false }
    ]
  },
  {
    name: 'delete_scrim',
    description: 'Delete a scrim schedule (Admin only)',
    options: [
      { name: 'scrim_name', type: 3, description: 'Name of the scrim to delete', required: true }
    ]
  },
  {
    name: 'list_teams',
    description: 'View all registered teams (Admin only)'
  },
  {
    name: 'delete_team',
    description: 'Delete a team (Admin only)',
    options: [
      { name: 'team_name', type: 3, description: 'Team name to delete', required: true }
    ]
  },
  {
    name: 'create_leaderboard',
    description: 'Generate leaderboard image (Admin only)',
    options: [
      { name: 'scrim_name', type: 3, description: 'Scrim name', required: true },
      { name: 'data', type: 3, description: 'Format: TeamName,PlacementPoints,KillPoints (one per line)', required: true }
    ]
  },
  {
    name: 'view_slots',
    description: 'View current check-in slots for today'
  },
  {
    name: 'force_checkin',
    description: 'Force check-in a team (Admin only)',
    options: [
      { name: 'team_name', type: 3, description: 'Team name', required: true },
      { name: 'scrim_name', type: 3, description: 'Scrim name', required: true }
    ]
  }
];

client.once('ready', async () => {
  console.log(`✅ ${client.user.tag} is online!`);
  
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  try {
    console.log('Registering slash commands...');
    await rest.put(
      Routes.applicationGuildCommands(client.user.id, GUILD_ID),
      { body: commands }
    );
    console.log('✅ Slash commands registered');
  } catch (error) {
    console.error('Error registering commands:', error);
  }

  const guild = await client.guilds.fetch(GUILD_ID);
  await setupServerStructure(guild);
  await scheduleScrimJobs(guild);
  
  console.log('✅ Bot initialization complete!');
});

async function setupServerStructure(guild) {
  let scrimCategory = guild.channels.cache.find(ch => ch.type === ChannelType.GuildCategory && ch.name === 'Scrims');
  if (!scrimCategory) {
    scrimCategory = await guild.channels.create({
      name: 'Scrims',
      type: ChannelType.GuildCategory
    });
  }

  let eSportsRole = guild.roles.cache.find(r => r.name === 'eSports');
  if (!eSportsRole) {
    eSportsRole = await guild.roles.create({
      name: 'eSports',
      reason: 'Role for registered teams to access check-in channels'
    });
  }

  const ensureChannel = async (name, permissions = []) => {
    let channel = guild.channels.cache.find(c => c.name === name && c.parentId === scrimCategory.id);
    if (!channel) {
      channel = await guild.channels.create({
        name,
        type: ChannelType.GuildText,
        parent: scrimCategory.id,
        permissionOverwrites: permissions
      });
    }
    return channel;
  };

  await ensureChannel('scrim-registration', [
    { id: guild.roles.everyone.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
  ]);

  await ensureChannel('register-here', [
    { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
    { id: eSportsRole.id, allow: [PermissionsBitField.Flags.ViewChannel], deny: [PermissionsBitField.Flags.SendMessages] }
  ]);

  await ensureChannel('scrim-log', [
    { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
  ]);

  const regChannel = guild.channels.cache.find(c => c.name === 'scrim-registration' && c.parentId === scrimCategory.id);
  const messages = await regChannel.messages.fetch({ limit: 10 });
  const existingMsg = messages.find(m => m.author.id === client.user.id && m.components.length > 0);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('register_team')
      .setLabel('📝 Register Team')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('edit_team')
      .setLabel('✏️ Edit Team')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('delete_team')
      .setLabel('🗑️ Delete Team')
      .setStyle(ButtonStyle.Danger)
  );

  const embed = new EmbedBuilder()
    .setTitle('🎮 Farlight 84 Scrim Registration')
    .setDescription('Welcome to the registration system! Use the buttons below to manage your team.\n\n**📝 Register Team** - Create a new team\n**✏️ Edit Team** - Modify your existing team\n**🗑️ Delete Team** - Remove your team')
    .setColor('#00FF00')
    .setTimestamp();

  if (existingMsg) {
    await existingMsg.edit({ embeds: [embed], components: [row] });
  } else {
    await regChannel.send({ embeds: [embed], components: [row] });
  }

  console.log('✅ Server structure verified');
}

async function scheduleScrimJobs(guild) {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
  }
  
  cronTask = cron.schedule('* * * * *', async () => {
    const scrims = await db.all('SELECT * FROM scrims');
    const currentDay = utils.getDayOfWeek(SERVER_TZ);
    const currentTime = utils.getCurrentTimeMinutes(SERVER_TZ);

    for (const scrim of scrims) {
      const scrimDays = scrim.days.split(',').map(d => d.trim());
      
      if (!scrimDays.includes(currentDay)) continue;

      const startTime = utils.parseTimeToMinutes(scrim.start_time);
      const endTime = utils.parseTimeToMinutes(scrim.end_time);

      const registerChannel = guild.channels.cache.find(c => c.name === 'register-here');
      if (!registerChannel) continue;

      if (currentTime === startTime) {
        await openCheckIn(guild, scrim, registerChannel);
      } else if (currentTime === endTime) {
        await closeCheckIn(guild, scrim, registerChannel);
      }
    }
  });

  console.log('✅ Scrim schedules activated');
}

async function openCheckIn(guild, scrim, channel) {
  const eSportsRole = guild.roles.cache.find(r => r.name === 'eSports');
  
  await channel.permissionOverwrites.edit(eSportsRole, {
    ViewChannel: true,
    SendMessages: true
  });

  const embed = new EmbedBuilder()
    .setTitle(`🔔 ${scrim.scrim_name} Check-In OPEN`)
    .setDescription(`Check-in is now open! Click the button below and complete the captcha to check in your team.\n\n**Check-in closes at:** ${scrim.end_time}`)
    .setColor('#00FF00')
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`checkin_${scrim.scrim_name}`)
      .setLabel('✅ Check In Team')
      .setStyle(ButtonStyle.Success)
  );

  const mentionText = scrim.mention_role_id ? `<@&${scrim.mention_role_id}>` : '';
  await channel.send({ content: mentionText, embeds: [embed], components: [row] });

  const logChannel = guild.channels.cache.find(c => c.name === 'scrim-log');
  if (logChannel) {
    await logChannel.send(`✅ Check-in opened for ${scrim.scrim_name}`);
  }
}

async function closeCheckIn(guild, scrim, channel) {
  const eSportsRole = guild.roles.cache.find(r => r.name === 'eSports');
  
  await channel.permissionOverwrites.edit(eSportsRole, {
    ViewChannel: true,
    SendMessages: false
  });

  const today = utils.getTodayDate(SERVER_TZ);
  const checkedInTeams = await db.all(
    'SELECT * FROM daily_registration WHERE scrim_name = ? AND scrim_date = ? ORDER BY check_in_order',
    [scrim.scrim_name, today]
  );

  const embed = new EmbedBuilder()
    .setTitle(`🔒 ${scrim.scrim_name} Check-In CLOSED`)
    .setDescription(`Check-in has ended.\n\n**Total Teams Checked In:** ${checkedInTeams.length}`)
    .setColor('#FF0000')
    .setTimestamp();

  await channel.send({ embeds: [embed] });

  await postSlotLists(guild, scrim.scrim_name, today, checkedInTeams);

  const logChannel = guild.channels.cache.find(c => c.name === 'scrim-log');
  if (logChannel) {
    await logChannel.send(`🔒 Check-in closed for ${scrim.scrim_name} - ${checkedInTeams.length} teams checked in`);
  }
}

async function postSlotLists(guild, scrimName, scrimDate, checkedInTeams) {
  const lobbyGroups = {};
  
  for (const registration of checkedInTeams) {
    const lobbyNum = registration.lobby_number;
    if (!lobbyGroups[lobbyNum]) {
      lobbyGroups[lobbyNum] = [];
    }
    
    const team = await db.get('SELECT * FROM teams WHERE team_name = ?', [registration.team_name]);
    if (team) {
      lobbyGroups[lobbyNum].push(team);
    }
  }

  const scrimCategory = guild.channels.cache.find(ch => ch.type === ChannelType.GuildCategory && ch.name === 'Scrims');

  for (const [lobbyNum, teams] of Object.entries(lobbyGroups)) {
    const lobbyChannelName = `lobby-${lobbyNum}`;
    let lobbyChannel = guild.channels.cache.find(c => c.name === lobbyChannelName && c.parentId === scrimCategory.id);
    
    const lobbyRole = await ensureLobbyRole(guild, lobbyNum);

    if (!lobbyChannel) {
      lobbyChannel = await guild.channels.create({
        name: lobbyChannelName,
        type: ChannelType.GuildText,
        parent: scrimCategory.id,
        permissionOverwrites: [
          { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: lobbyRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
        ]
      });
    }

    const slotListMessage = utils.formatSlotList(teams, lobbyNum);
    const embed = new EmbedBuilder()
      .setTitle(`🏆 ${scrimName} - Lobby ${lobbyNum}`)
      .setDescription(slotListMessage)
      .setColor('#FFD700')
      .setTimestamp()
      .setFooter({ text: `Scrim Date: ${scrimDate}` });

    const transferRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`transfer_lobby_${lobbyNum}_${scrimDate}`)
        .setLabel('🔄 Transfer Role')
        .setStyle(ButtonStyle.Primary)
    );

    await lobbyChannel.send({ embeds: [embed], components: [transferRow] });
  }
}

async function ensureLobbyRole(guild, lobbyNumber) {
  const roleName = `Lobby-${lobbyNumber}`;
  let role = guild.roles.cache.find(r => r.name === roleName);
  
  if (!role) {
    role = await guild.roles.create({
      name: roleName,
      reason: `Lobby ${lobbyNumber} access role`
    });
  }
  
  return role;
}

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      await handleSlashCommand(interaction);
    } else if (interaction.isButton()) {
      await handleButton(interaction);
    }
  } catch (error) {
    console.error('Interaction error:', error);
    const reply = { content: '❌ An error occurred while processing your request.', ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(reply);
    } else {
      await interaction.reply(reply);
    }
  }
});

async function handleSlashCommand(interaction) {
  const { commandName } = interaction;

  if (commandName === 'create_scrim') {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: '❌ Only administrators can create scrims.', ephemeral: true });
    }

    const scrimName = interaction.options.getString('scrim_name');
    const days = interaction.options.getString('days');
    const startTime = interaction.options.getString('start_time');
    const endTime = interaction.options.getString('end_time');
    const mentionRole = interaction.options.getRole('mention_role');

    if (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) {
      return interaction.reply({ content: '❌ Time must be in HH:MM format (24-hour)', ephemeral: true });
    }

    try {
      await db.run(
        'INSERT OR REPLACE INTO scrims (scrim_name, days, start_time, end_time, mention_role_id) VALUES (?, ?, ?, ?, ?)',
        [scrimName, days, startTime, endTime, mentionRole?.id || null]
      );

      await interaction.reply({ content: `✅ Scrim "${scrimName}" created successfully!\n**Days:** ${days}\n**Check-in:** ${startTime} - ${endTime}`, ephemeral: true });
      
      await scheduleScrimJobs(interaction.guild);
    } catch (error) {
      console.error(error);
      await interaction.reply({ content: '❌ Error creating scrim.', ephemeral: true });
    }
  }

  if (commandName === 'delete_scrim') {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: '❌ Only administrators can delete scrims.', ephemeral: true });
    }

    const scrimName = interaction.options.getString('scrim_name');
    await db.run('DELETE FROM scrims WHERE scrim_name = ?', [scrimName]);
    await interaction.reply({ content: `✅ Scrim "${scrimName}" deleted.`, ephemeral: true });
  }

  if (commandName === 'list_teams') {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: '❌ Only administrators can view all teams.', ephemeral: true });
    }

    const teams = await db.all('SELECT * FROM teams ORDER BY created_at DESC');
    
    if (teams.length === 0) {
      return interaction.reply({ content: '📋 No teams registered yet.', ephemeral: true });
    }

    const embed = new EmbedBuilder()
      .setTitle('📋 Registered Teams')
      .setColor('#00FF00')
      .setTimestamp();

    let description = '';
    teams.forEach((team, index) => {
      description += `**${index + 1}. [${team.team_tag}] ${team.team_name}**\n`;
      description += `   Captain: ${team.captain_name}\n`;
      description += `   Players: ${team.player2_name}, ${team.player3_name}\n\n`;
    });

    embed.setDescription(description);
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (commandName === 'delete_team') {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: '❌ Only administrators can use this command.', ephemeral: true });
    }

    const teamName = interaction.options.getString('team_name');
    await db.run('DELETE FROM teams WHERE team_name = ?', [teamName]);
    await interaction.reply({ content: `✅ Team "${teamName}" deleted.`, ephemeral: true });
  }

  if (commandName === 'create_leaderboard') {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: '❌ Only administrators can create leaderboards.', ephemeral: true });
    }

    await interaction.deferReply();

    const scrimName = interaction.options.getString('scrim_name');
    const data = interaction.options.getString('data');
    
    const lines = data.split('\n').filter(l => l.trim());
    const teams = lines.map(line => {
      const [name, placement, kills] = line.split(',').map(s => s.trim());
      return {
        name,
        placementPoints: parseInt(placement) || 0,
        killPoints: parseInt(kills) || 0,
        totalPoints: (parseInt(placement) || 0) + (parseInt(kills) || 0)
      };
    });

    teams.sort((a, b) => b.totalPoints - a.totalPoints);

    const canvas = Canvas.createCanvas(800, 600);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, 800, 600);

    ctx.fillStyle = '#FFD700';
    ctx.font = 'bold 40px Arial';
    ctx.fillText(scrimName + ' - Leaderboard', 50, 60);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 20px Arial';
    ctx.fillText('Rank', 50, 120);
    ctx.fillText('Team', 150, 120);
    ctx.fillText('Placement', 450, 120);
    ctx.fillText('Kills', 580, 120);
    ctx.fillText('Total', 690, 120);

    ctx.strokeStyle = '#FFD700';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(40, 130);
    ctx.lineTo(760, 130);
    ctx.stroke();

    teams.slice(0, 15).forEach((team, index) => {
      const y = 170 + (index * 30);
      
      if (index === 0) ctx.fillStyle = '#FFD700';
      else if (index === 1) ctx.fillStyle = '#C0C0C0';
      else if (index === 2) ctx.fillStyle = '#CD7F32';
      else ctx.fillStyle = '#FFFFFF';

      ctx.font = 'bold 18px Arial';
      ctx.fillText(`#${index + 1}`, 50, y);
      
      ctx.font = '18px Arial';
      ctx.fillText(team.name, 150, y);
      ctx.fillText(team.placementPoints.toString(), 470, y);
      ctx.fillText(team.killPoints.toString(), 600, y);
      ctx.fillText(team.totalPoints.toString(), 700, y);
    });

    const attachment = { attachment: canvas.toBuffer(), name: 'leaderboard.png' };
    await interaction.editReply({ files: [attachment] });
  }

  if (commandName === 'view_slots') {
    const today = utils.getTodayDate(SERVER_TZ);
    const scrims = await db.all('SELECT DISTINCT scrim_name FROM daily_registration WHERE scrim_date = ?', [today]);

    if (scrims.length === 0) {
      return interaction.reply({ content: '📋 No check-ins for today yet.', ephemeral: true });
    }

    const embed = new EmbedBuilder()
      .setTitle(`📋 Today's Check-ins (${today})`)
      .setColor('#00FF00')
      .setTimestamp();

    for (const scrim of scrims) {
      const teams = await db.all(
        'SELECT team_name, lobby_number FROM daily_registration WHERE scrim_name = ? AND scrim_date = ? ORDER BY check_in_order',
        [scrim.scrim_name, today]
      );

      let description = '';
      const lobbies = {};
      
      teams.forEach(t => {
        if (!lobbies[t.lobby_number]) lobbies[t.lobby_number] = [];
        lobbies[t.lobby_number].push(t.team_name);
      });

      for (const [lobby, teamList] of Object.entries(lobbies)) {
        description += `\n**Lobby ${lobby}:** ${teamList.join(', ')}`;
      }

      embed.addFields({ name: scrim.scrim_name, value: description || 'No teams yet' });
    }

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (commandName === 'force_checkin') {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: '❌ Only administrators can force check-ins.', ephemeral: true });
    }

    const teamName = interaction.options.getString('team_name');
    const scrimName = interaction.options.getString('scrim_name');
    const today = utils.getTodayDate(SERVER_TZ);

    const team = await db.get('SELECT * FROM teams WHERE team_name = ?', [teamName]);
    if (!team) {
      return interaction.reply({ content: '❌ Team not found.', ephemeral: true });
    }

    const existingCheckIn = await db.get(
      'SELECT * FROM daily_registration WHERE scrim_name = ? AND scrim_date = ? AND team_name = ?',
      [scrimName, today, teamName]
    );

    if (existingCheckIn) {
      return interaction.reply({ content: '❌ Team already checked in.', ephemeral: true });
    }

    const currentCount = await db.get(
      'SELECT COUNT(*) as count FROM daily_registration WHERE scrim_name = ? AND scrim_date = ?',
      [scrimName, today]
    );

    const lobbyNumber = Math.floor(currentCount.count / 20) + 1;
    const checkInOrder = currentCount.count + 1;

    await db.run(
      'INSERT INTO daily_registration (scrim_name, scrim_date, team_name, checked_in_by, lobby_number, check_in_order) VALUES (?, ?, ?, ?, ?, ?)',
      [scrimName, today, teamName, interaction.user.id, lobbyNumber, checkInOrder]
    );

    await interaction.reply({ content: `✅ Team "${teamName}" force checked-in to Lobby ${lobbyNumber}.`, ephemeral: true });
  }
}

async function handleButton(interaction) {
  const customId = interaction.customId;

  if (customId === 'register_team') {
    const existingTeam = await db.get(
      'SELECT * FROM teams WHERE captain_id = ? OR player2_id = ? OR player3_id = ?',
      [interaction.user.id, interaction.user.id, interaction.user.id]
    );

    if (existingTeam) {
      return interaction.reply({ content: '❌ You are already part of a team. Use "Edit Team" or "Delete Team" instead.', ephemeral: true });
    }

    const thread = await interaction.channel.threads.create({
      name: `Registration - ${interaction.user.username}`,
      autoArchiveDuration: 60,
      reason: 'Team registration'
    });

    await thread.members.add(interaction.user.id);
    
    activeThreads.set(thread.id, {
      userId: interaction.user.id,
      step: 1,
      data: {}
    });

    await thread.send(`👋 Hi <@${interaction.user.id}>! Let's register your team.\n\n**Question 1/6:** What is your **Team Name**?`);
    await interaction.reply({ content: `✅ Registration started! Please check the thread: <#${thread.id}>`, ephemeral: true });
  }

  if (customId === 'edit_team') {
    const team = await db.get(
      'SELECT * FROM teams WHERE captain_id = ? OR player2_id = ? OR player3_id = ?',
      [interaction.user.id, interaction.user.id, interaction.user.id]
    );

    if (!team) {
      return interaction.reply({ content: '❌ You are not part of any team.', ephemeral: true });
    }

    if (team.captain_id !== interaction.user.id && !interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: '❌ Only the team captain can edit the team.', ephemeral: true });
    }

    const thread = await interaction.channel.threads.create({
      name: `Edit - ${team.team_name}`,
      autoArchiveDuration: 60,
      reason: 'Team editing'
    });

    await thread.members.add(interaction.user.id);
    
    activeThreads.set(thread.id, {
      userId: interaction.user.id,
      step: 1,
      data: { editing: true, originalTeamName: team.team_name },
      teamData: team
    });

    await thread.send(`👋 Hi <@${interaction.user.id}>! Let's edit your team: **${team.team_name}**\n\n**Question 1/6:** What is your **Team Name**? (Current: ${team.team_name})`);
    await interaction.reply({ content: `✅ Edit started! Please check the thread: <#${thread.id}>`, ephemeral: true });
  }

  if (customId === 'delete_team') {
    const team = await db.get(
      'SELECT * FROM teams WHERE captain_id = ? OR player2_id = ? OR player3_id = ?',
      [interaction.user.id, interaction.user.id, interaction.user.id]
    );

    if (!team) {
      return interaction.reply({ content: '❌ You are not part of any team.', ephemeral: true });
    }

    if (team.captain_id !== interaction.user.id && !interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: '❌ Only the team captain can delete the team.', ephemeral: true });
    }

    await db.run('DELETE FROM teams WHERE team_name = ?', [team.team_name]);
    
    const eSportsRole = interaction.guild.roles.cache.find(r => r.name === 'eSports');
    const members = [team.captain_id, team.player2_id, team.player3_id].filter(Boolean);
    
    for (const memberId of members) {
      try {
        const member = await interaction.guild.members.fetch(memberId);
        if (member && eSportsRole) {
          await member.roles.remove(eSportsRole);
        }
      } catch (error) {
        console.log('Could not remove role from member:', memberId);
      }
    }

    await interaction.reply({ content: `✅ Team "${team.team_name}" has been deleted.`, ephemeral: true });

    const logChannel = interaction.guild.channels.cache.find(c => c.name === 'scrim-log');
    if (logChannel) {
      await logChannel.send(`🗑️ Team "${team.team_name}" deleted by ${interaction.user.tag}`);
    }
  }

  if (customId.startsWith('checkin_')) {
    const scrimName = customId.replace('checkin_', '');
    const today = utils.getTodayDate(SERVER_TZ);

    const team = await db.get(
      'SELECT * FROM teams WHERE captain_id = ? OR player2_id = ? OR player3_id = ?',
      [interaction.user.id, interaction.user.id, interaction.user.id]
    );

    if (!team) {
      return interaction.reply({ content: '❌ You must be part of a registered team to check in.', ephemeral: true });
    }

    const existingCheckIn = await db.get(
      'SELECT * FROM daily_registration WHERE scrim_name = ? AND scrim_date = ? AND team_name = ?',
      [scrimName, today, team.team_name]
    );

    if (existingCheckIn) {
      return interaction.reply({ content: '❌ Your team has already checked in for this scrim.', ephemeral: true });
    }

    const captchaWord = utils.generateCaptchaWord();
    
    await db.run(
      'INSERT OR REPLACE INTO captcha_tracking (user_id, scrim_name, scrim_date, captcha_word) VALUES (?, ?, ?, ?)',
      [interaction.user.id, scrimName, today, captchaWord]
    );

    const embed = new EmbedBuilder()
      .setTitle('🔐 Captcha Verification')
      .setDescription(`Please type the following word to check in your team:\n\n**${captchaWord}**\n\n(You have 60 seconds)`)
      .setColor('#FFD700');

    await interaction.reply({ embeds: [embed], ephemeral: true });

    checkInStates.set(interaction.user.id, {
      scrimName,
      teamName: team.team_name,
      captchaWord,
      timestamp: Date.now()
    });
  }

  if (customId.startsWith('transfer_lobby_')) {
    const parts = customId.split('_');
    const lobbyNumber = parseInt(parts[2]);
    const scrimDate = parts[3];

    const lobbyRole = interaction.guild.roles.cache.find(r => r.name === `Lobby-${lobbyNumber}`);
    if (!lobbyRole) {
      return interaction.reply({ content: '❌ Lobby role not found.', ephemeral: true });
    }

    if (!interaction.member.roles.cache.has(lobbyRole.id)) {
      return interaction.reply({ content: '❌ You do not have this lobby role to transfer.', ephemeral: true });
    }

    const team = await db.get(
      'SELECT * FROM teams WHERE captain_id = ? OR player2_id = ? OR player3_id = ?',
      [interaction.user.id, interaction.user.id, interaction.user.id]
    );

    if (!team) {
      return interaction.reply({ content: '❌ You must be part of a team to transfer the role.', ephemeral: true });
    }

    const teammates = [team.captain_id, team.player2_id, team.player3_id]
      .filter(id => id && id !== interaction.user.id);

    if (teammates.length === 0) {
      return interaction.reply({ content: '❌ No teammates to transfer the role to.', ephemeral: true });
    }

    let transferredTo = null;
    for (const teammateId of teammates) {
      try {
        const teammate = await interaction.guild.members.fetch(teammateId);
        if (teammate) {
          await teammate.roles.add(lobbyRole);
          transferredTo = teammate;
          break;
        }
      } catch (error) {
        console.log('Could not transfer to teammate:', teammateId);
      }
    }

    if (transferredTo) {
      await interaction.member.roles.remove(lobbyRole);
      await interaction.reply({ content: `✅ Lobby role transferred to ${transferredTo.user.tag}`, ephemeral: true });
    } else {
      await interaction.reply({ content: '❌ Could not find any teammate to transfer the role to.', ephemeral: true });
    }
  }
}

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  if (message.channel.isThread() && activeThreads.has(message.channel.id)) {
    await handleThreadResponse(message);
  }

  if (checkInStates.has(message.author.id)) {
    await handleCaptchaResponse(message);
  }
});

async function handleThreadResponse(message) {
  const threadData = activeThreads.get(message.channel.id);
  
  if (threadData.userId !== message.author.id) return;

  const { step, data } = threadData;

  if (step === 1) {
    const teamName = message.content.trim();
    if (teamName.length < 3) {
      return message.reply('❌ Team name must be at least 3 characters long. Please try again.');
    }

    if (!data.editing) {
      const existing = await db.get('SELECT * FROM teams WHERE team_name = ?', [teamName]);
      if (existing) {
        return message.reply('❌ Team name already taken. Please choose another name.');
      }
    }

    data.teamName = teamName;
    threadData.step = 2;
    await message.reply(`✅ Team name set to: **${teamName}**\n\n**Question 2/6:** What is your **Team Tag**? (Format: [ABC], max 6 characters, only letters and numbers)`);
  } else if (step === 2) {
    const rawTag = message.content.trim();
    
    if (!utils.validateTeamTag(rawTag)) {
      return message.reply('❌ Invalid team tag. Must be max 6 characters, only letters and numbers (A-Z, 0-9). You can include brackets [ABC] or just type ABC. Please try again.');
    }

    const tag = utils.normalizeTeamTag(rawTag);
    data.teamTag = tag;
    threadData.step = 3;
    await message.reply(`✅ Team tag set to: **[${tag}]**\n\n**Question 3/6:** Enter **Player 1 (Captain)** details\nFormat: PlayerName#12345678`);
  } else if (step === 3) {
    const player1 = message.content.trim();
    
    if (!utils.validatePlayerUID(player1)) {
      return message.reply('❌ Invalid format. Must be: PlayerName#12345678 (8 digits). Please try again.');
    }

    data.player1 = player1;
    data.captainId = message.author.id;
    threadData.step = 4;
    await message.reply(`✅ Player 1 set to: **${player1}**\n\n**Question 4/6:** Enter **Player 2** details\nFormat: PlayerName#12345678`);
  } else if (step === 4) {
    const player2 = message.content.trim();
    
    if (!utils.validatePlayerUID(player2)) {
      return message.reply('❌ Invalid format. Must be: PlayerName#12345678 (8 digits). Please try again.');
    }

    data.player2 = player2;
    threadData.step = 5;
    await message.reply(`✅ Player 2 set to: **${player2}**\n\n**Question 5/6:** Enter **Player 3** details\nFormat: PlayerName#12345678`);
  } else if (step === 5) {
    const player3 = message.content.trim();
    
    if (!utils.validatePlayerUID(player3)) {
      return message.reply('❌ Invalid format. Must be: PlayerName#12345678 (8 digits). Please try again.');
    }

    data.player3 = player3;
    threadData.step = 6;
    await message.reply(`✅ Player 3 set to: **${player3}**\n\n**Question 6/6:** Mention your **3 teammates**\nFormat: @user1 @user2 @user3\n(Must mention exactly 3 users)`);
  } else if (step === 6) {
    const mentions = utils.parseMentions(message.content);
    
    if (mentions.length !== 3) {
      return message.reply('❌ You must mention exactly 3 teammates. Please try again.');
    }

    data.player2Id = mentions[0];
    data.player3Id = mentions[1];

    if (data.editing) {
      await db.run(
        'UPDATE teams SET team_name = ?, team_tag = ?, captain_id = ?, captain_name = ?, player2_id = ?, player2_name = ?, player3_id = ?, player3_name = ? WHERE team_name = ?',
        [data.teamName, data.teamTag, data.captainId, data.player1, data.player2Id, data.player2, data.player3Id, data.player3, threadData.data.originalTeamName]
      );

      await message.reply(`✅ **Team Updated Successfully!**\n\n**Team Name:** ${data.teamName}\n**Team Tag:** [${data.teamTag}]\n**Captain:** ${data.player1}\n**Player 2:** ${data.player2}\n**Player 3:** ${data.player3}\n\nYou can now close this thread.`);
    } else {
      await db.run(
        'INSERT INTO teams (team_name, team_tag, captain_id, captain_name, player2_id, player2_name, player3_id, player3_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [data.teamName, data.teamTag, data.captainId, data.player1, data.player2Id, data.player2, data.player3Id, data.player3]
      );

      const eSportsRole = message.guild.roles.cache.find(r => r.name === 'eSports');
      if (eSportsRole) {
        const memberIds = [data.captainId, data.player2Id, data.player3Id];
        for (const memberId of memberIds) {
          try {
            const member = await message.guild.members.fetch(memberId);
            if (member) {
              await member.roles.add(eSportsRole);
            }
          } catch (error) {
            console.log('Could not add role to member:', memberId);
          }
        }
      }

      await message.reply(`✅ **Team Registered Successfully!**\n\n**Team Name:** ${data.teamName}\n**Team Tag:** [${data.teamTag}]\n**Captain:** ${data.player1}\n**Player 2:** ${data.player2}\n**Player 3:** ${data.player3}\n\nAll team members have been granted the **eSports** role! You can now check in for scrims.\n\nYou can close this thread now.`);

      const logChannel = message.guild.channels.cache.find(c => c.name === 'scrim-log');
      if (logChannel) {
        await logChannel.send(`✅ New team registered: **[${data.teamTag}] ${data.teamName}** by ${message.author.tag}`);
      }
    }

    activeThreads.delete(message.channel.id);
    
    setTimeout(async () => {
      try {
        await message.channel.setArchived(true);
      } catch (error) {
        console.log('Could not archive thread');
      }
    }, 5000);
  }
}

async function handleCaptchaResponse(message) {
  const state = checkInStates.get(message.author.id);
  
  if (Date.now() - state.timestamp > 60000) {
    checkInStates.delete(message.author.id);
    return message.reply('❌ Captcha verification timed out. Please try checking in again.');
  }

  if (message.content.trim().toUpperCase() !== state.captchaWord.toUpperCase()) {
    return message.reply('❌ Incorrect captcha. Please try again.');
  }

  const today = utils.getTodayDate(SERVER_TZ);

  const currentCount = await db.get(
    'SELECT COUNT(*) as count FROM daily_registration WHERE scrim_name = ? AND scrim_date = ?',
    [state.scrimName, today]
  );

  const lobbyNumber = Math.floor(currentCount.count / 20) + 1;
  const checkInOrder = currentCount.count + 1;

  await db.run(
    'INSERT INTO daily_registration (scrim_name, scrim_date, team_name, checked_in_by, lobby_number, check_in_order) VALUES (?, ?, ?, ?, ?, ?)',
    [state.scrimName, today, state.teamName, message.author.id, lobbyNumber, checkInOrder]
  );

  const lobbyRole = await ensureLobbyRole(message.guild, lobbyNumber);
  await message.member.roles.add(lobbyRole);

  await db.run(
    'INSERT INTO lobby_roles (scrim_name, scrim_date, user_id, lobby_number) VALUES (?, ?, ?, ?)',
    [state.scrimName, today, message.author.id, lobbyNumber]
  );

  await message.reply(`✅ **Check-in successful!**\n\nTeam: **${state.teamName}**\nLobby: **${lobbyNumber}**\nPosition: **#${checkInOrder}**\n\nYou have been assigned the <@&${lobbyRole.id}> role!`);

  checkInStates.delete(message.author.id);

  const logChannel = message.guild.channels.cache.find(c => c.name === 'scrim-log');
  if (logChannel) {
    await logChannel.send(`✅ Team "${state.teamName}" checked in to ${state.scrimName} - Lobby ${lobbyNumber} (Position #${checkInOrder})`);
  }
}

process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection:', error);
});

client.login(TOKEN);
