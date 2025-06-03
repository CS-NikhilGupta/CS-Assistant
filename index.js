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
app.use('/files', express.static(path.join(__dirname, 'files')));

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const BASE_URL = process.env.BASE_URL || 'https://yourdomain.onrender.com'; // fallback
fs.ensureDirSync(path.join(__dirname, 'files'));

const bannedPatterns = [
  /\bfuck\b/i, /\bshit\b/i, /\basshole\b/i, /\bbastard\b/i,
  /\bsuck\b/i, /\bkill\b/i, /\bsuicide\b/i, /\brape\b/i,
];

const getPrompt = (message) => [
  {
    role: 'system',
    content: `
You are a digital paralegal assistant for Company Secretaries in India. You explain CS laws, sections, and procedures using a professional tone with headings, bullet points, and legal links.

When a message starts with "draft", respond with a formal Board Resolution or Notice formatted for Indian CS compliance in .docx format.
`.trim(),
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

app.post('/webhook', async (req, res) => {
  const from = req.body.From;
  const message = req.body.Body?.trim();

  console.log(`Message from ${from}: ${message}`);

  // 🚫 Abuse Filter
  if (bannedPatterns.some(pattern => pattern.test(message))) {
    await logAbuse(from, message);
    res.set('Content-Type', 'text/xml');
    res.send(`<Response><Message>This bot is for educational & professional CS support only. Please avoid inappropriate content.</Message></Response>`);
    return;
  }

  // 🔁 Handle "continue"
  if (message.toLowerCase() === 'continue') {
    const nextChunk = await getNextChunk(from);
    res.set('Content-Type', 'text/xml');
    res.send(`<Response><Message>${nextChunk || 'No more content to show.'}</Message></Response>`);
    return;
  }

  // 📝 Draft Generator
  if (message.toLowerCase().startsWith('draft')) {
    let reply = "Sorry, I couldn't generate the draft.";
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

      console.log("✅ GPT draft response received");
      console.log(response.data);

      const draftText = response.data.choices[0].message.content.trim();
      const doc = new Document({
        sections: [{
          children: [
            new Paragraph({
              text: "BOARD RESOLUTION",
              alignment: AlignmentType.CENTER,
              children: [new TextRun({ text: "BOARD RESOLUTION", bold: true, size: 28 })],
            }),
            new Paragraph({ text: "\n" }),
            ...draftText.split('\n').map(line =>
              new Paragraph({
                alignment: AlignmentType.JUSTIFIED,
                children: [new TextRun({ text: line.trim(), size: 24 })],
              })
            ),
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
      reply = `✅ Draft generated. Download your document here:\n${downloadUrl}`;
    } catch (err) {
      console.error("Draft error:", err.response?.data || err.message);
    }

    res.set('Content-Type', 'text/xml');
    res.send(`<Response><Message>${reply}</Message></Response>`);
    return;
  }

  // 🤖 GPT Q&A
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

    const gptReply = response.data.choices[0].message.content.trim();
    const chunks = splitIntoChunks(gptReply);

    if (chunks.length > 1) {
      await storeChunks(from, chunks.slice(1));
      res.set('Content-Type', 'text/xml');
      res.send(`<Response><Message>${chunks[0]}\n\n...(message truncated)\nReply 'continue' to read more.</Message></Response>`);
    } else {
      res.set('Content-Type', 'text/xml');
      res.send(`<Response><Message>${gptReply}</Message></Response>`);
    }
  } catch (err) {
    console.error("GPT Error:", err.response?.data || err.message);
    res.set('Content-Type', 'text/xml');
    res.send(`<Response><Message>Sorry, an error occurred while processing your request.</Message></Response>`);
  }
});

app.listen(3000, () => {
  console.log('✅ Server running on http://localhost:3000');
});
