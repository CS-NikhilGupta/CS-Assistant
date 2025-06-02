// 📁 index.js – Full Version with GPT Draft Generation + Legal Prompt Integrity

const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const fs = require('fs-extra');
const { Document, Packer, Paragraph, TextRun, AlignmentType, HeadingLevel } = require('docx');
const path = require('path');

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));

// Serve files for download
app.use('/files', express.static(path.join(__dirname, 'files')));

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Ensure the files directory exists
fs.ensureDirSync(path.join(__dirname, 'files'));

// 🔁 Unified Prompt Function for All Messages
function getPrompt(message) {
  return [
    {
      role: "system",
      content: `
You are a digital paralegal assistant for Company Secretaries in India. You are not a chatbot or AI assistant — you work like a trusted, experienced paralegal who supports Company Secretaries with accurate and practical information.

You assist:
- CS aspirants — with information about the CS profession, eligibility, benefits, and subjects
- CS students — by explaining topics from the syllabus (e.g., Company Law, Taxation, Jurisprudence, SEBI, FEMA) with examples, case references, and section numbers
- Practicing CS professionals — by offering summaries of procedures, timelines, form details (like DIR-12, MGT-7), compliance checklists, and latest regulatory updates

Your responsibilities:
- Always respond in a structured, bullet-point format where helpful
- Use examples, form names, section numbers, and procedural clarity
- Speak professionally, as if you're in a law firm or working under a CS
- When a question is vague but related (e.g., "Why is this important?"), make an educated assumption and answer thoroughly
- If the request includes the word \"draft\", assume the user wants a formal legal document formatted as per Indian corporate practice — begin with a centered heading (e.g., BOARD RESOLUTION), justify the body text, and include sections for date, place, and signatory lines
- If a question is clearly unrelated (e.g., "How’s the weather?", "Tell me a joke"), reply:
  “I’m here to support topics related to the Company Secretary profession. Please ask something within that scope.”

You are not an AI — you are a professional-grade paralegal assistant who supports Company Secretaries with utmost precision and reliability.
      `.trim()
    },
    {
      role: "user",
      content: message
    }
  ];
}

// 📩 Webhook Route
app.post('/webhook', async (req, res) => {
  const from = req.body.From;
  const message = req.body.Body.trim();

  console.log(`Message from ${from}: ${message}`);

  // 🔎 If message requests a draft
  if (message.toLowerCase().startsWith('draft')) {
    let reply = "Sorry, I couldn't generate the draft.";

    try {
      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-3.5-turbo',
          messages: getPrompt(message),
          max_tokens: 800,
          temperature: 0.5
        },
        {
          headers: {
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const draftText = response.data.choices[0].message.content.trim();

      // 🧾 Format .docx with legal styling
      const doc = new Document({
        sections: [
          {
            children: [
              new Paragraph({
                text: "BOARD RESOLUTION",
                heading: HeadingLevel.HEADING_1,
                alignment: AlignmentType.CENTER
              }),
              new Paragraph({
                text: draftText,
                alignment: AlignmentType.JUSTIFIED
              }),
              new Paragraph({ text: "\n\n" }),
              new Paragraph({ text: "Place: ____________", alignment: AlignmentType.LEFT }),
              new Paragraph({ text: "Date: ____________", alignment: AlignmentType.LEFT }),
              new Paragraph({ text: "\n" }),
              new Paragraph({ text: "For and on behalf of the Board", alignment: AlignmentType.LEFT }),
              new Paragraph({ text: "_________________________", alignment: AlignmentType.LEFT }),
              new Paragraph({ text: "Authorized Signatory", alignment: AlignmentType.LEFT })
            ]
          }
        ]
      });

      const fileName = `resolution-${Date.now()}.docx`;
      const filePath = path.join(__dirname, 'files', fileName);

      const buffer = await Packer.toBuffer(doc);
      await fs.writeFile(filePath, buffer);

      const downloadUrl = `https://${req.headers.host}/files/${fileName}`;
      reply = `✅ Draft generated. Download your document:\n${downloadUrl}`;
    } catch (err) {
      console.error("GPT/DOCX Error:", err.response?.data || err.message);
    }

    res.set('Content-Type', 'text/xml');
    res.send(`<Response><Message>${reply}</Message></Response>`);
    return;
  }

  // 🧠 Handle general CS questions
  let generalReply = "Sorry, something went wrong.";
  try {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-3.5-turbo',
        messages: getPrompt(message),
        max_tokens: 600,
        temperature: 0.7
      },
      {
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    generalReply = response.data.choices[0].message.content.trim();
  } catch (err) {
    console.error("❌ OpenAI Error:", err.response?.data || err.message);
  }

  res.set('Content-Type', 'text/xml');
  res.send(`<Response><Message>${generalReply}</Message></Response>`);
});

app.listen(3000, () => {
  console.log('✅ Server running on http://localhost:3000');
});
