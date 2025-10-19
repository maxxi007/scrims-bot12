const crypto = require('crypto');

const WORD_LIST = [
  'ALPHA', 'BRAVO', 'CHARLIE', 'DELTA', 'ECHO', 'FOXTROT', 'GOLF', 'HOTEL',
  'INDIA', 'JULIET', 'KILO', 'LIMA', 'MIKE', 'NOVEMBER', 'OSCAR', 'PAPA',
  'QUEBEC', 'ROMEO', 'SIERRA', 'TANGO', 'UNIFORM', 'VICTOR', 'WHISKEY',
  'XRAY', 'YANKEE', 'ZULU', 'PHOENIX', 'DRAGON', 'THUNDER', 'SHADOW'
];

function generateCaptchaWord() {
  return WORD_LIST[Math.floor(Math.random() * WORD_LIST.length)];
}

function validateTeamTag(tag) {
  if (!tag) return false;
  const cleanTag = tag.replace(/[\[\]]/g, '').toUpperCase();
  if (cleanTag.length > 6 || cleanTag.length < 1) return false;
  return /^[A-Z0-9]{1,6}$/.test(cleanTag);
}

function normalizeTeamTag(tag) {
  return tag.replace(/[\[\]]/g, '').toUpperCase();
}

function validatePlayerUID(uid) {
  const pattern = /^.+#\d{8}$/;
  return pattern.test(uid);
}

function parseMentions(text) {
  const mentionRegex = /<@!?(\d+)>/g;
  const matches = [];
  let match;
  while ((match = mentionRegex.exec(text)) !== null) {
    matches.push(match[1]);
  }
  return matches;
}

function formatSlotList(teams, lobbyNumber) {
  let message = `**🏆 Lobby ${lobbyNumber} - Slot List**\n\n`;
  teams.forEach((team, index) => {
    message += `${index + 1}. [${team.team_tag}] ${team.team_name}\n`;
  });
  message += `\n**Total Teams: ${teams.length}/20**`;
  return message;
}

function getTodayDate(timezone) {
  const moment = require('moment-timezone');
  return moment().tz(timezone).format('YYYY-MM-DD');
}

function getDayOfWeek(timezone) {
  const moment = require('moment-timezone');
  return moment().tz(timezone).format('dddd');
}

function parseTimeToMinutes(timeStr) {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
}

function getCurrentTimeMinutes(timezone) {
  const moment = require('moment-timezone');
  const now = moment().tz(timezone);
  return now.hours() * 60 + now.minutes();
}

module.exports = {
  generateCaptchaWord,
  validateTeamTag,
  normalizeTeamTag,
  validatePlayerUID,
  parseMentions,
  formatSlotList,
  getTodayDate,
  getDayOfWeek,
  parseTimeToMinutes,
  getCurrentTimeMinutes
};
