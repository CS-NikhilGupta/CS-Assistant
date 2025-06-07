// FINAL index.js with File-Based Transcription Endpoint Added
const express = require('express');
const bodyParser = require('body-parser');
const multer = require('multer');
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const FormData = require('form-data');
const {
  Document, Packer, Paragraph, TextRun, AlignmentType,
} = require('docx');

const { logAbuse, storeChunks, getNextChunk } = require('./googleSheet');
const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
const upload = multer({ dest: 'uploads/' });

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const BASE_URL = process.env.BASE_URL || 'https://yourdomain.onrender.com';
fs.ensureDirSync(path.join(__dirname, 'files'));

function escapeXml(unsafe) {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/\'/g, "&apos;");
}

function safeReply(res, message) {
  try {
    const safe = escapeXml(message || "Sorry, something went wrong.");
    console.log("🟢 Sending WhatsApp reply:", safe);
    res.set('Content-Type', 'text/xml');
    res.send(`<Response><Message>${safe}</Message></Response>`);
  } catch (error) {
    console.error("❌ Error in safeReply:", error);
    res.set('Content-Type', 'text/xml');
    res.send(`<Response><Message>Unexpected error while sending reply.</Message></Response>`);
  }
}

async function transcribeVoice(mediaUrl) {
  const oggFile = await axios.get(mediaUrl, { responseType: 'stream' });

  const form = new FormData();
  form.append('file', oggFile.data, 'audio.ogg');
  form.append('model', 'whisper-1');

  const response = await axios.post(
    'https://api.openai.com/v1/audio/transcriptions',
    form,
    {
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
    }
  );

  console.log("🎤 Transcription Result:", response.data.text);
  return response.data.text;
}

async function transcribeFile(filePath) {
  const form = new FormData();
  form.append('file', fs.createReadStream(filePath));
  form.append('model', 'whisper-1');

  const response = await axios.post(
    'https://api.openai.com/v1/audio/transcriptions',
    form,
    {
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
    }
  );

  console.log("🗂️ File Transcription Result:", response.data.text);
  return response.data.text;
}

const bannedPatterns = [
  /\bfuck\b/i, /\bshit\b/i, /\basshole\b/i, /\bbastard\b/i,
  /\bsuck\b/i, /\bkill\b/i, /\bsuicide\b/i, /\brape\b/i,
];

const getPrompt = (message) => [
  {
    role: 'system',
    content: `You are a digital paralegal assistant for Company Secretaries in India. Explain CS laws, sections, and procedures with bullet points and legal accuracy. When prompted with 'draft', provide only the resolution body.`
  },
  {
    role: 'user',
    content: message,
  },
];

function splitIntoChunks(text, maxLength = 1200) {
  const chunks = [];
  while (text.length > maxLength) {
    let splitPoint = text.lastIndexOf('\n', maxLength);
    if (splitPoint === -1) splitPoint = maxLength;
    chunks.push(text.slice(0, splitPoint));
    text = text.slice(splitPoint);
  }
  chunks.push(text);
  return chunks;
}

app.get('/files/:filename', async (req, res) => {
  const filePath = path.join(__dirname, 'files', req.params.filename);
  if (await fs.pathExists(filePath)) {
    res.download(filePath);
  } else {
    res.status(404).send('❌ File not found.');
  }
});

app.post('/transcribe-audio', upload.single('audio'), async (req, res) => {
  const filePath = req.file.path;
  try {
    const text = await transcribeFile(filePath);
    res.json({ transcript: text });
  } catch (error) {
    console.error("❌ File transcription error:", error);
    res.status(500).json({ error: "Failed to transcribe audio." });
  } finally {
    fs.unlink(filePath); // cleanup
  }
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});