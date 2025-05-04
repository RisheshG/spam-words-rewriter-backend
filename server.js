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

// Load spam words from CSV on server start
fs.createReadStream(path.join(__dirname, './spam_words.csv'))
  .pipe(csv())
  .on('data', (row) => {
    const word = Object.values(row)[0];
    if (word) spamWords.push(word.toLowerCase());
  });

// Function to fetch synonyms for a word (with fallback if no synonyms found)
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

// Endpoint to highlight spam words and replace them with synonyms
app.post('/highlight-spam', async (req, res) => {
  const { text } = req.body;

  if (!text) {
    return res.status(400).json({ error: 'No text provided' });
  }

  try {
    // Sort spam words by length to prevent partial matches
    const sortedSpamWords = spamWords
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);

    const foundSpamWords = new Set(); // Using Set to avoid duplicates

    // Create a single regex pattern to match all spam words
    const regexParts = sortedSpamWords.map(escapeRegex);
    const combinedRegex = new RegExp(`\\b(${regexParts.join('|')})\\b`, 'gi');

    let highlightedText = text;
    let replacedText = text;

    // Fetch synonyms concurrently using Promise.all
    const synonyms = await Promise.all(
      sortedSpamWords.map(async (word) => {
        const synonym = await fetchSynonym(word);
        return { word, synonym };
      })
    );

    // Loop through each spam word and replace it
    for (const { word, synonym } of synonyms) {
      const regex = new RegExp(`\\b${escapeRegex(word)}\\b`, 'gi');
      if (regex.test(text)) {
        foundSpamWords.add(word.toLowerCase());
      }
      highlightedText = highlightedText.replace(regex, `<mark>${word}</mark>`);
      replacedText = replacedText.replace(regex, synonym);
    }

    // Convert Set to array (DON'T join into string here - let frontend handle display formatting)
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

// Helper to escape regex special characters
function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

app.listen(PORT, () => console.log(`🚀 Backend running on http://localhost:${PORT}`));