import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import fetch from 'node-fetch';

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

app.post('/api/search', async (req, res) => {
  const { q } = req.body;

  if (!q) {
    return res.status(400).json({ error: 'Query is required' });
  }

  try {
    const response = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': process.env.SERPER_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ q }),
    });

    if (!response.ok) {
      throw new Error(`Error fetching search results: ${response.statusText}`);
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch search results' });
  }
});

app.listen(port, () => {
  console.log(`Proxy server listening at http://localhost:${port}`);
});
