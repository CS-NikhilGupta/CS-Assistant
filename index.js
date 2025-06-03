// PATCHED index.js
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, AlignmentType,
} = require('docx');

const { logAbuse, storeChunks, getNextChunk } = require('./googleSheet');
const app = express();
app.use(bodyParser.urlencoded({ extended: false }));

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const BASE_URL = process.env.BASE_URL || 'https://yourdomain.onrender.com';
fs.ensureDirSync(path.join(__dirname, 'files'));

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

app.post('/webhook', async (req, res) => {
  const from = req.body.From;
  const message = req.body.Body?.trim();
  console.log(`📩 Message from ${from}: ${message}`);

  if (bannedPatterns.some(pattern => pattern.test(message))) {
    await logAbuse(from, message);
    const abuseReply = "⚠️ This bot only supports Company Secretary-related questions. Please keep the conversation professional.";
    console.log("🚫 Abuse blocked:", message);
    res.set('Content-Type', 'text/xml');
    res.send(`<Response><Message>${abuseReply}</Message></Response>`);
    return;
  }

  if (message.toLowerCase() === 'continue') {
    const nextChunk = await getNextChunk(from);
    const safeReply = nextChunk || "No more content to show.";
    console.log("🔄 Sending continuation chunk");
    res.set('Content-Type', 'text/xml');
    res.send(`<Response><Message>${safeReply}</Message></Response>`);
    return;
  }

  if (message.toLowerCase().startsWith('draft')) {
    let reply = "Sorry, I couldn't generate the draft document.";
    try {
      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-3.5-turbo',
          messages: getPrompt(message),
          max_tokens: 1200,
          temperature: 0.7,
        },
        {
          headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
          },
        }
      );

      let draftText = response.data.choices[0]?.message?.content?.trim() || "";
      draftText = draftText.replace(/BOARD RESOLUTION.*/i, '').replace(/Click here.*/gi, '').trim();

      const doc = new Document({
        sections: [{
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new TextRun({ text: "BOARD RESOLUTION", bold: true, size: 32 })],
            }),
            new Paragraph({ text: "\n" }),
            new Paragraph({
              alignment: AlignmentType.LEFT,
              children: [new TextRun({
                text: `RESOLVED THAT ${draftText}`,
                size: 24
              })],
            }),
            new Paragraph({ text: "\n\n" }),
            new Paragraph({ text: "Place: ____________", alignment: AlignmentType.LEFT }),
            new Paragraph({ text: "Date: ____________", alignment: AlignmentType.LEFT }),
            new Paragraph({ text: "\n" }),
            new Paragraph({ text: "For and on behalf of the Board", alignment: AlignmentType.LEFT }),
            new Paragraph({ text: "_________________________", alignment: AlignmentType.LEFT }),
            new Paragraph({ text: "Authorized Signatory", alignment: AlignmentType.LEFT }),
          ]
        }]
      });

      const fileName = `resolution-${Date.now()}.docx`;
      const filePath = path.join(__dirname, 'files', fileName);
      const buffer = await Packer.toBuffer(doc);
      await fs.writeFile(filePath, buffer);

      const downloadUrl = `${BASE_URL}/files/${fileName}`;
      reply = `✅ Draft ready:\n${downloadUrl}`;
    } catch (err) {
      console.error("❌ Draft generation error:", err.response?.data || err.message);
    }

    res.set('Content-Type', 'text/xml');
    res.send(`<Response><Message>${reply}</Message></Response>`);
    return;
  }

  try {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-3.5-turbo',
        messages: getPrompt(message),
        max_tokens: 1200,
        temperature: 0.7,
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    let gptReply = response.data.choices[0]?.message?.content?.trim();
    console.log("🧠 GPT Reply:", gptReply);
    if (!gptReply || gptReply.length < 2) {
      gptReply = "Sorry, I couldn’t understand that. Please try rephrasing.";
    }

    const chunks = splitIntoChunks(gptReply);
    console.log("📦 Chunks:", chunks.length);

    if (chunks.length > 1) {
      await storeChunks(from, chunks.slice(1));
      res.set('Content-Type', 'text/xml');
      res.send(`<Response><Message>${chunks[0]}\n\n...(message truncated)\nReply 'continue' to read more.</Message></Response>`);
    } else {
      res.set('Content-Type', 'text/xml');
      res.send(`<Response><Message>${gptReply}</Message></Response>`);
    }
  } catch (err) {
    console.error("❌ GPT Error:", err.response?.data || err.message);
    res.set('Content-Type', 'text/xml');
    res.send(`<Response><Message>Sorry, something went wrong while answering your query.</Message></Response>`);
  }
});

app.listen(3000, () => {
  console.log('✅ Server running on http://localhost:3000');
});
