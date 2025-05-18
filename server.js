const express = require('express');
const cors = require('cors');
const fs = require('fs');
const csv = require('csv-parser');
const path = require('path');
const axios = require('axios');
const { JSDOM } = require('jsdom');

const app = express();
const PORT = 5001;

app.use(cors());
app.use(express.json());

let spamWords = [];

fs.createReadStream(path.join(__dirname, './spam_words.csv'))
  .pipe(csv())
  .on('data', (row) => {
    const word = Object.values(row)[0];
    if (word) spamWords.push(word.toLowerCase());
  });

async function fetchSynonym(word) {
  try {
    const response = await axios.get('https://api.datamuse.com/words', {
      params: {
        rel_syn: word,
        max: 5
      }
    });

    if (response.data.length > 0) {
      const validSynonyms = response.data
        .map(s => s.word.toLowerCase())
        .filter(synonym => !spamWords.includes(synonym));

      return validSynonyms.length > 0 ? validSynonyms[0] : word;
    } else {
      return word;
    }
  } catch (error) {
    console.error('Error fetching synonym:', error);
    return word;
  }
}

app.post('/highlight-spam', async (req, res) => {
  const { text, isHtml } = req.body;

  if (!text) {
    return res.status(400).json({ error: 'No text provided' });
  }

  try {
    // Unique, sorted spam words
    const sortedSpamWords = [...new Set(spamWords.filter(Boolean))].sort((a, b) => b.length - a.length);
    const foundSpamWords = new Set();

    // Fetch synonyms for all spam words
    const synonyms = await Promise.all(
      sortedSpamWords.map(async (word) => {
        const synonym = await fetchSynonym(word);
        return { word, synonym };
      })
    );

    // Escape regex helper
    const escapeRegex = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    if (isHtml) {
      const dom = new JSDOM(text);
      const replacementDom = new JSDOM(text);

      // Function to highlight spam words inside text content with <mark>
      const highlightText = (textContent) => {
        let modified = textContent;
        for (const { word } of synonyms) {
          const regex = new RegExp(`\\b${escapeRegex(word)}\\b`, 'gi');
          modified = modified.replace(regex, (match) => {
            foundSpamWords.add(word.toLowerCase());
            return `<mark style="background-color: #ffcccc; color: black;">${match}</mark>`;
          });
        }
        return modified;
      };

      // Function to replace spam words with synonyms preserving case
      const replaceText = (textContent) => {
        let modified = textContent;
        for (const { word, synonym } of synonyms) {
          const regex = new RegExp(`\\b${escapeRegex(word)}\\b`, 'gi');
          modified = modified.replace(regex, (match) => {
            if (match === match.toLowerCase()) return synonym.toLowerCase();
            if (match === match.toUpperCase()) return synonym.toUpperCase();
            if (match[0] === match[0].toUpperCase()) {
              return synonym.charAt(0).toUpperCase() + synonym.slice(1).toLowerCase();
            }
            return synonym.toLowerCase();
          });
        }
        return modified;
      };

      // Helper to collect all text nodes in the document body
      const getTextNodes = (doc) => {
        const nodes = [];
        const walker = doc.createTreeWalker(doc.body, doc.defaultView.NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          nodes.push(node);
        }
        return nodes;
      };

      // Collect all text nodes from both DOMs first
      const textNodes = getTextNodes(dom.window.document);
      const replacementTextNodes = getTextNodes(replacementDom.window.document);

      // Highlight spam words in original DOM text nodes
      for (const node of textNodes) {
        const modifiedHTML = highlightText(node.nodeValue);
        if (modifiedHTML !== node.nodeValue) {
          const span = dom.window.document.createElement('span');
          span.innerHTML = modifiedHTML;
          node.replaceWith(...span.childNodes);
        }
      }

      // Replace spam words with synonyms in replacement DOM text nodes
      for (const node of replacementTextNodes) {
        node.nodeValue = replaceText(node.nodeValue);
      }

      res.json({
        highlightedHtml: dom.serialize(),
        highlightedText: dom.window.document.body.textContent,
        replacedHtml: replacementDom.serialize(),
        replacedText: replacementDom.window.document.body.textContent,
        spamWords: Array.from(foundSpamWords),
      });

    } else {
      // Plain text processing
      let highlightedText = text;
      let replacedText = text;

      for (const { word, synonym } of synonyms) {
        const regex = new RegExp(`\\b${escapeRegex(word)}\\b`, 'gi');

        highlightedText = highlightedText.replace(regex, (match) => {
          foundSpamWords.add(word.toLowerCase());
          return `**${match}**`;
        });

        replacedText = replacedText.replace(regex, (match) => {
          if (match === match.toLowerCase()) return synonym.toLowerCase();
          if (match === match.toUpperCase()) return synonym.toUpperCase();
          if (match[0] === match[0].toUpperCase()) {
            return synonym.charAt(0).toUpperCase() + synonym.slice(1).toLowerCase();
          }
          return synonym.toLowerCase();
        });
      }

      const highlightedHtml = highlightedText.replace(/\*\*(.*?)\*\*/g,
        '<mark style="background-color: #ffcccc; color: black;">$1</mark>'
      ).replace(/\n/g, '<br>');

      res.json({
        highlightedHtml,
        highlightedText,
        replacedHtml: replacedText.replace(/\n/g, '<br>'),
        replacedText,
        spamWords: Array.from(foundSpamWords),
      });
    }

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

app.listen(PORT, () => console.log(`🚀 Backend running on http://localhost:${PORT}`));
