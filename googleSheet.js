const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const auth = new google.auth.GoogleAuth({
  keyFile: path.join(__dirname, 'gen-lang-client-0639512359-5403a0baf44c.json'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const SHEET_ID = '1pdnQb9XN3a9BrT9dQ2YspvNwEvFJFLIt-97nASywv5g'; // Paste from your sheet URL

const getClient = async () => {
  const client = await auth.getClient();
  return google.sheets({ version: 'v4', auth: client });
};

// 💾 Log abusive inputs
async function logAbuse(phone, message) {
  const sheets = await getClient();
  const now = new Date().toISOString();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: 'Abuse_Log!A1',
    valueInputOption: 'RAW',
    requestBody: {
      values: [[phone, message, now]],
    },
  });
}

// 💾 Store response chunks
async function storeChunks(phone, chunks) {
  const sheets = await getClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `Continuation_Queue!A${getRowForPhone(phone)}`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [[phone, JSON.stringify(chunks)]],
    },
  });
}

// 📤 Get next chunk
async function getNextChunk(phone) {
  const sheets = await getClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'Continuation_Queue!A2:B1000',
  });

  const row = res.data.values?.find(r => r[0] === phone);
  if (!row) return null;

  const chunks = JSON.parse(row[1]);
  const next = chunks.shift();

  // Update remaining
  await storeChunks(phone, chunks.length ? chunks : null);
  return next || null;
}

// 🧹 Clear chunks
async function clearChunks(phone) {
  const sheets = await getClient();
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SHEET_ID,
    range: `Continuation_Queue!A${getRowForPhone(phone)}:B`,
  });
}

// 🔍 Get row number for a phone
function getRowForPhone(phone) {
  // Quick mapping: whatsapp:+91xxxxxxxxxx → row index (e.g., 2 to 1000)
  // Real version should search row by phone, simplified here for MVP
  return 2; // Adjust if needed
}

module.exports = { logAbuse, storeChunks, getNextChunk, clearChunks };
