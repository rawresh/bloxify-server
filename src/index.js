const express = require('express');
const axios = require('axios');
const sharp = require('sharp');
require('dotenv').config();

const app = express();
const PORT = 52100;
const PLUGIN_SERVER_NAME = 'bloxify-server v0.1.0';

let accessToken = '';

async function refreshAccessToken() {
  try {
    const res = await axios.post('https://accounts.spotify.com/api/token', null, {
      params: {
        grant_type: 'refresh_token',
        refresh_token: process.env.SPOTIFY_REFRESH_TOKEN,
      },
      headers: {
        'Authorization': 'Basic ' + Buffer.from(
          `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
        ).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });
    accessToken = res.data.access_token;
  } catch (err) {
    console.error('Error refreshing access token:', err.response?.data || err.message);
    accessToken = '';
    throw new Error('Access token refresh failed');
  }
}

async function getUserPremiumStatus() {
  if (!accessToken) await refreshAccessToken();

  try {
    const res = await axios.get('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return res.data.product === 'premium';
  } catch (err) {
    console.error('Error fetching user profile:', err.response?.data || err.message);
    return false;
  }
}

async function getCurrentlyPlaying() {
  if (!accessToken) await refreshAccessToken();

  try {
    const res = await axios.get('https://api.spotify.com/v1/me/player', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.data || !res.data.item) return null;

    const item = res.data.item;
    const progressMs = res.data.progress_ms || 0;

    const isPremium = await getUserPremiumStatus();

    return {
      trackName: item.name,
      trackId: item.id,
      trackTimeSeconds: Math.floor(progressMs / 1000),
      trackLengthSeconds: Math.floor(item.duration_ms / 1000),
      trackLoopedState: res.data.repeat_state,
      shuffleEnabled: res.data.shuffle_state || false,
      isPlaying: !!res.data.is_playing,
      artistNames: item.artists.map(a => a.name),
      albumCoverUrl: item.album.images[0]?.url || '',
      isPremium,
    };
  } catch (err) {
    console.error('Error getting currently playing track:', err.response?.data || err.message);
    return null;
  }
}

async function getAlbumCoverPixelData(url) {
  try {
    const imgBuffer = (await axios.get(url, { responseType: 'arraybuffer' })).data;
    const image = sharp(imgBuffer).resize(1080, 1080).raw().toBuffer({ resolveWithObject: true });
    const { data } = await image;

    const pixels = [];
    for (let i = 0; i < data.length; i += 3) {
      pixels.push({ r: data[i], g: data[i + 1], b: data[i + 2] });
    }
    return pixels;
  } catch (err) {
    console.error('Error processing album cover:', err.message);
    return [{ r: 255, g: 255, b: 255 }];
  }
}

app.get('/handshake', (req, res) => {
  res.send(PLUGIN_SERVER_NAME);
});

app.get('/getPlayingTrackInfo', async (req, res) => {
  try {
    const track = await getCurrentlyPlaying();
    if (!track) {
      return res.json({
        trackName: 'N/A',
        trackId: -1,
        trackTimeSeconds: 0,
        trackLengthSeconds: 0,
        trackLoopedState: 'off',
        shuffleEnabled: false,
        isPlaying: false,
        artistNames: ['N/A'],
        isPremium: false,
      });
    }
    res.json(track);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error fetching track info');
  }
});

app.get('/getAlbumCoverPixelData', async (req, res) => {
  try {
    const track = await getCurrentlyPlaying();
    if (!track || !track.albumCoverUrl) {
      return res.json([{ r: 255, g: 255, b: 255 }]);
    }

    const pixels = await getAlbumCoverPixelData(track.albumCoverUrl);
    res.json(pixels);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error processing image');
  }
});

app.post('/pause', async (req, res) => {
  try {
    await axios.put('https://api.spotify.com/v1/me/player/pause', null, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    res.sendStatus(200);
  } catch (err) {
    console.error('Error pausing playback:', err.response?.data || err.message);
    res.status(500).send('Failed to pause');
  }
});

app.post('/togglePlay', async (req, res) => {
  try {
    const stateRes = await axios.get('https://api.spotify.com/v1/me/player', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const isPlaying = stateRes.data?.is_playing;

    if (isPlaying) {
      await axios.put('https://api.spotify.com/v1/me/player/pause', null, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    } else {
      await axios.put('https://api.spotify.com/v1/me/player/play', null, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('Error toggling playback:', err.response?.data || err.message);
    res.status(500).send('Failed to toggle playback');
  }
});

app.post('/next', async (req, res) => {
  try {
    await axios.post('https://api.spotify.com/v1/me/player/next', null, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    res.sendStatus(200);
  } catch (err) {
    console.error('Error skipping to next track:', err.response?.data || err.message);
    res.status(500).send('Failed to skip next');
  }
});

app.post('/previous', async (req, res) => {
  try {
    await axios.post('https://api.spotify.com/v1/me/player/previous', null, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    res.sendStatus(200);
  } catch (err) {
    console.error('Error skipping to previous track:', err.response?.data || err.message);
    res.status(500).send('Failed to skip previous');
  }
});

app.post('/toggleShuffle', async (req, res) => {
  try {
    const stateRes = await axios.get('https://api.spotify.com/v1/me/player', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const shuffleState = stateRes.data?.shuffle_state || false;

    await axios.put(`https://api.spotify.com/v1/me/player/shuffle?state=${!shuffleState}`, null, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    res.sendStatus(200);
  } catch (err) {
    console.error('Error toggling shuffle:', err.response?.data || err.message);
    res.status(500).send('Failed to toggle shuffle');
  }
});

app.post('/cycleLoopState', async (req, res) => {
  try {
    const stateRes = await axios.get('https://api.spotify.com/v1/me/player', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const repeatState = stateRes.data?.repeat_state || 'off';

    const nextState =
      repeatState === 'off' ? 'context' :
      repeatState === 'context' ? 'track' : 'off';

    await axios.put(`https://api.spotify.com/v1/me/player/repeat?state=${nextState}`, null, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    res.sendStatus(200);
  } catch (err) {
    console.error('Error cycling loop state:', err.response?.data || err.message);
    res.status(500).send('Failed to cycle loop state');
  }
});

app.listen(PORT, () => {
  console.log(`Bloxify server running at http://localhost:${PORT}`);
});
