const { google } = require('googleapis');

const SHEET_ID = '1pdnQb9XN3a9BrT9dQ2YspvNwEvFJFLIt-97nASywv5g'; // Replace with your actual sheet ID

const auth = new google.auth.GoogleAuth({
  credentials: {
    type: process.env.GOOGLE_TYPE,
    project_id: process.env.GOOGLE_PROJECT_ID,
    private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    client_id: process.env.GOOGLE_CLIENT_ID,
    auth_uri: process.env.GOOGLE_AUTH_URI,
    token_uri: process.env.GOOGLE_TOKEN_URI,
    auth_provider_x509_cert_url: process.env.GOOGLE_AUTH_PROVIDER_X509_CERT_URL,
    client_x509_cert_url: process.env.GOOGLE_CLIENT_X509_CERT_URL,
  },
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const getClient = async () => {
  const client = await auth.getClient();
  return google.sheets({ version: 'v4', auth: client });
};

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

async function storeChunks(phone, chunks) {
  const sheets = await getClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `Continuation_Queue!A2:B2`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [[phone, JSON.stringify(chunks)]],
    },
  });
}

async function getNextChunk(phone) {
  const sheets = await getClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'Continuation_Queue!A2:B2',
  });

  const row = res.data.values?.[0];
  if (!row || row[0] !== phone) return null;

  const chunks = JSON.parse(row[1]);
  const next = chunks.shift();
  await storeChunks(phone, chunks.length ? chunks : null);
  return next || null;
}

async function clearChunks(phone) {
  const sheets = await getClient();
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SHEET_ID,
    range: `Continuation_Queue!A2:B2`,
  });
}

module.exports = { logAbuse, storeChunks, getNextChunk, clearChunks };
