const express = require('express');
const cors = require('cors');
const fs = require('fs');
const csv = require('csv-parser');
const path = require('path');
const axios = require('axios');

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
      // Filter synonyms to avoid spam words
      const validSynonyms = response.data
        .map(s => s.word.toLowerCase())
        .filter(synonym => !spamWords.includes(synonym));

      return validSynonyms.length > 0 ? validSynonyms[0] : word; // Return first valid synonym or original word
    } else {
      return word; // Return the original word if no synonyms are found
    }
  } catch (error) {
    console.error('Error fetching synonym:', error);
    return word; // Fallback to the original word in case of error
  }
}

app.post('/highlight-spam', async (req, res) => {
  const { text } = req.body;

  if (!text) {
    return res.status(400).json({ error: 'No text provided' });
  }

  try {
    const sortedSpamWords = spamWords
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);

    const foundSpamWords = new Set(); 

    const regexParts = sortedSpamWords.map(escapeRegex);
    const combinedRegex = new RegExp(`\\b(${regexParts.join('|')})\\b`, 'gi');

    let highlightedText = text;
    let replacedText = text;

    const synonyms = await Promise.all(
      sortedSpamWords.map(async (word) => {
        const synonym = await fetchSynonym(word);
        return { word, synonym };
      })
    );
    
    for (const { word, synonym } of synonyms) {
      const regex = new RegExp(`\\b${escapeRegex(word)}\\b`, 'gi');
      if (regex.test(text)) {
        foundSpamWords.add(word.toLowerCase());
      }
      highlightedText = highlightedText.replace(regex, `<mark>${word}</mark>`);
      replacedText = replacedText.replace(regex, synonym);
    }

    const spamWordsArray = Array.from(foundSpamWords);

    res.json({ 
      highlightedText, 
      spamWords: spamWordsArray, // Now returns an array
      replacedText 
    });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

app.listen(PORT, () => console.log(`🚀 Backend running on http://localhost:${PORT}`));
