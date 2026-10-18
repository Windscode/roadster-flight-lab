# Expanded music library: recording rights and acceptance

Checked 2026-10-18. Existing five recordings are retained byte-for-byte. Five
recordings were added, bringing the library to ten tracks. The added runtime
files total **26,872,246 bytes**, below the requested 30 MB budget. The entire
library is 58,194,203 bytes. No audio was played to speakers.

| New track | Composer / recording artist | Collection | Runtime duration | Recording license |
| --- | --- | --- | ---: | --- |
| Canon in D Major / D大调卡农 | Johann Pachelbel / Kevin MacLeod | classical | 5:56 | CC BY 4.0 |
| Gymnopédie No. 1 / 第一号吉姆诺佩蒂 | Erik Satie / Kevin MacLeod | classical | 3:07 | CC BY 4.0 |
| Prelude in C Major BWV 846 / C大调前奏曲 | J.S. Bach / Kimiko Ishizaka | classical | 2:43 | CC0 1.0 |
| Goodbye To Spring | Josh Woodward | pop | 4:06 | CC BY 4.0 |
| I'm Letting Go | Josh Woodward | pop | 3:12 | CC BY 4.0 |

## Recording permission, separate from composition

The original Pachelbel, Satie and Bach compositions are public-domain works.
That is not the basis for using a modern recording. Each selected recording has
separate permission:

- Kevin MacLeod's official track pages identify the exact ISRC, recording title,
  downloadable master filename and CC BY 4.0 attribution. The current pages load
  `pieces.json` and generate the license block. Both the page code and matching
  catalog entries were inspected; unrelated recordings with the same title
  were not substituted.
- Kimiko Ishizaka's official Bandcamp album page explicitly applies CC0 to the
  **recording**, and lists Prelude No. 1 BWV 846 as its first track. Her official
  project announcement independently says that this studio recording was
  released into the public domain. The downloaded Commons file identifies this
  2015 performance, its performer and CC0 dedication, and links back to that
  project. Permission was verified on the author's album, rather than inferred
  from Bach's age or Commons' general site footer.
- Josh Woodward's two official song pages each expose the specific original MP3
  and CC BY 4.0 statement. The downloaded recordings are those author files,
  not commercial recordings by other musicians with similarly named songs.

No NC, ND or ShareAlike recording was added. The music licenses remain attached
to these media files and do not replace the project's code license. Keeping the
recordings in a public GitHub repository is redistribution: retain the supplied
credits and license links. Personal or noncommercial intent is not treated as
permission for commercial hit recordings.

Primary permission sources:

- https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100301
- https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100787
- https://incompetech.com/music/royalty-free/pieces.json
- https://kimikoishizaka.bandcamp.com/album/bach-well-tempered-clavier-book-1
- https://welltemperedclavier.org/kimiko-ishizaka-releases-open-well-tempered-clavier.html
- https://www.joshwoodward.com/song/GoodbyeToSpring
- https://www.joshwoodward.com/song/ImLettingGo
- https://www.joshwoodward.com/faq

Archived recording source for the CC0 piano performance:

https://commons.wikimedia.org/wiki/File:Kimiko_Ishizaka_-_Bach_-_Well-Tempered_Clavier,_Book_1_-_01_Prelude_No._1_in_C_major,_BWV_846.ogg

Some direct author-page HTTP requests were blocked or returned interstitials.
The Bandcamp album was successfully read through the web tool; the direct
request's bot page is explicitly distinguished in the evidence JSON and is not
presented as licensing proof. The author album and official release statement
corroborate the specific archive recording.

## Encoding and actual decoding

The two Kevin MacLeod MP3s were converted to AAC at 192 kbps. The archived Bach
recording was converted from Ogg Vorbis at 96 kHz to AAC at 48 kHz / 192 kbps for
consistent browser support. Complete performances were retained, with no cuts,
remixes or loudness alteration. Original recording hashes, sizes and encoding
changes are documented in the manifest and `media-3.4-encoding.json`.

All ten runtime recordings were **fully decoded** using FFmpeg 7.1 with error
termination enabled, sending output to a null sink. Every decode completed
without error. This validates more than header recognition while avoiding
speaker playback. `media-3.4-acceptance.json` records codecs, durations, hashes,
integrated loudness and true peaks. The temporary decoder executable remains
outside the repository and is not included in the project or source archive.

The Bach performance measures about -31.1 LUFS, while mastered pop recordings
are around -9 to -11 LUFS. A fixed identical amplitude would produce a large
change on switching tracks. The optional `normalizationGainDb` field targets
-20 LUFS with a -1 dBFS true-peak ceiling, retaining the performances' internal
dynamics. Apply that as a smooth playback gain multiplied by the user's volume;
the files themselves were not loudness-normalized.

## Player integration

`manifest.json` is now schema version 2. Existing playback fields remain.
Every track has `collection` (`classical`, `pop`, `ambient`) and a human-readable
`genre`. Top-level `collections` contains Chinese labels. Classical tracks also
identify `composer`, `recordingLicense` and `compositionRights`; do not replace
the recording artist with the composer in the credit line.

Keep title, recording artist, license and a source/credits link visible while
playing. For CC0, credit is retained voluntarily. Josh Woodward requests game
credit at startup or while playing in every session. Gameplay uploads should
include recording credits in their descriptions. Local user imports remain
device-local and are not copied into the distributed source package.

This collection provides recognizable classical compositions and reusable
indie-pop recordings. It does not claim chart positions or a subjective listening
verdict, and explicit licensing does not guarantee an absence of erroneous
automated claims. No unlicensed commercial chart recording was acquired.
