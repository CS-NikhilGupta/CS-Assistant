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
fs.ensureDirSync(path.join(__dirname, 'files'));

// 🚫 Offensive words list (basic starter)
const bannedWords = ['sex', 'kill', 'rape', 'f***', 'suicide'];

const getPrompt = (message) => [
  {
    role: 'system',
    content: `
You are a digital paralegal assistant for Company Secretaries in India. You explain CS laws, sections, and procedures using professional tone with headings, bullet points, short paragraphs. Always return relevant legal links where possible (MCA or IndiaCode).

For document requests starting with "draft", provide formal Indian legal formatting for Board Resolutions or Notices in a way that can be inserted into a .docx template.
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
  if (bannedWords.some(word => message.toLowerCase().includes(word))) {
    await logAbuse(from, message);
    res.set('Content-Type', 'text/xml');
    res.send(`<Response><Message>This bot is for educational & professional CS support only. Please avoid inappropriate content.</Message></Response>`);
    return;
  }

  // 🔁 Handle "continue" for long replies
  if (message.toLowerCase() === 'continue') {
    const nextChunk = await getNextChunk(from);
    res.set('Content-Type', 'text/xml');
    res.send(`<Response><Message>${nextChunk || 'No more content to show.'}</Message></Response>`);
    return;
  }

  // 📝 Handle draft generation
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

      const downloadUrl = `https://${req.headers.host}/files/${fileName}`;
      reply = `✅ Draft generated. Download your document here:\n${downloadUrl}`;
    } catch (err) {
      console.error("Draft error:", err.response?.data || err.message);
    }

    res.set('Content-Type', 'text/xml');
    res.send(`<Response><Message>${reply}</Message></Response>`);
    return;
  }

  // 🤖 Regular GPT Question
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
      await storeChunks(from, chunks.slice(1)); // store remaining
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
