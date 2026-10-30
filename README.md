<table>
  <tr>
    <td width="100">
      <img src="https://raw.githubusercontent.com/nicholasxdavis/mottomusic/main/assets/logo.png" alt="Motto logo" width="80" />
    </td>
    <td>
      <strong>Motto</strong> is a music player that runs on your computer. Your songs stay in this folder. Anyone who clones the repo adds their own music.
    </td>
  </tr>
</table>

<table>
  <tr>
    <td width="50%">
      <img src="https://raw.githubusercontent.com/nicholasxdavis/mottomusic/main/docs/player.png" alt="Motto player" width="100%" />
    </td>
    <td width="50%">
      <img src="https://raw.githubusercontent.com/nicholasxdavis/mottomusic/main/docs/lyrics.png" alt="Motto lyrics" width="100%" />
    </td>
  </tr>
  <tr>
    <td width="50%">
      <img src="https://raw.githubusercontent.com/nicholasxdavis/mottomusic/main/docs/queue.png" alt="Motto queue" width="100%" />
    </td>
    <td width="50%">
      <img src="https://raw.githubusercontent.com/nicholasxdavis/mottomusic/main/docs/studio.png" alt="Motto studio" width="100%" />
    </td>
  </tr>
</table>

## Run

Motto needs [Node.js](https://nodejs.org). The player has nothing else to install.

On Windows, double-click `start.bat`.

From a terminal, in this folder:

```
node server.mjs
```

Open http://localhost:8080

The first time Motto opens, it asks how you want to sign in. You can leave it open, use a PIN, or use an email and a PIN. That choice stays on this computer.

Motto only answers on this PC. Other devices on the network cannot open it.

On Windows, `stop.bat` stops the server.

## Add your music

Put audio files in the `music` folder. This layout works well:

```
music/Artist/Album/Song.mp3
```

You can also open the logo at the bottom right, choose Management, then Import, and add files, a folder, or a zip.

Motto plays mp3, flac, wav, m4a, aac, ogg, opus, and aiff.

Cover art is read from the file. If a song has none, Motto looks one up while it plays.

## Lyrics

Put a `.lrc` file next to a song and give it the same name. Motto uses that file first.

If there is no file, Motto looks the lyrics up while the song plays. The Lyrics button under the cover opens them.

## Player

Play, previous, and next sit in the bottom bar, with the timeline and volume.

Shuffle plays the library. The other four buttons are stations. In Management, put the artists you want on each station.

Search is the magnifying glass.

The logo at the bottom right opens Player, Studio, Queue, and Management.

Studio is the sound rack: gain, bass, mid, air, boost, drive, cut, pitch, room, echo, and punch.

Queue is what plays next. Drag a row to reorder it.
