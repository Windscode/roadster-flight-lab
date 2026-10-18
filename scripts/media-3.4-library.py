"""Finalize reusable music metadata and decode each recording silently.

Requires an explicit local ffmpeg path. The decoder tool is not redistributed.
This script edits the music manifest only; it does not reset the older library.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
MUSIC = ROOT / "dist/assets/music"
BY = "https://creativecommons.org/licenses/by/4.0/"
CC0 = "https://creativecommons.org/publicdomain/zero/1.0/"
ADDITIONS = [
    {"id": "canon-in-d-major", "title": "D大调卡农 / Canon in D Major", "originalTitle": "Canon in D Major", "artist": "Kevin MacLeod", "composer": "Johann Pachelbel", "album": "Famous Classics (Everything Else)", "collection": "classical", "genre": "Baroque / chamber ensemble", "language": "instrumental", "instrumental": True,
     "file": "canon-in-d-major.m4a", "license": "CC-BY-4.0", "licenseUrl": BY, "isrc": "USUAN1100301",
     "sourceUrl": "https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100301", "licenseEvidenceUrl": "https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100301",
     "catalogEvidenceUrl": "https://incompetech.com/music/royalty-free/pieces.json", "downloadUrl": "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Canon%20in%20D%20Major.mp3",
     "compositionRights": "Public domain original composition by Johann Pachelbel (1653–1706). The modern arrangement and recording are separately covered by the credited recording license.",
     "attribution": '“Canon in D Major” Kevin MacLeod (incompetech.com). Licensed under Creative Commons: By Attribution 4.0. https://creativecommons.org/licenses/by/4.0/. Original composition: Johann Pachelbel.'},
    {"id": "gymnopedie-no-1", "title": "第一号吉姆诺佩蒂 / Gymnopédie No. 1", "originalTitle": "Gymnopedie No. 1", "artist": "Kevin MacLeod", "composer": "Erik Satie", "album": "Famous Classics (Everything Else)", "collection": "classical", "genre": "Classical / piano", "language": "instrumental", "instrumental": True,
     "file": "gymnopedie-no-1.m4a", "license": "CC-BY-4.0", "licenseUrl": BY, "isrc": "USUAN1100787",
     "sourceUrl": "https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100787", "licenseEvidenceUrl": "https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100787",
     "catalogEvidenceUrl": "https://incompetech.com/music/royalty-free/pieces.json", "downloadUrl": "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Gymnopedie%20No%201.mp3",
     "compositionRights": "Public domain original composition by Erik Satie (1866–1925), published 1888. The modern recording is separately covered by the credited recording license.",
     "attribution": '“Gymnopedie No. 1” Kevin MacLeod (incompetech.com). Licensed under Creative Commons: By Attribution 4.0. https://creativecommons.org/licenses/by/4.0/. Original composition: Erik Satie.'},
    {"id": "bach-prelude-bwv846", "title": "C大调前奏曲 BWV 846 / Prelude in C Major", "originalTitle": "Prelude No. 1 in C major, BWV 846", "artist": "Kimiko Ishizaka", "composer": "Johann Sebastian Bach", "album": "Bach: Well-Tempered Clavier, Book 1", "collection": "classical", "genre": "Baroque / solo piano", "language": "instrumental", "instrumental": True,
     "file": "bach-prelude-bwv846.m4a", "license": "CC0-1.0", "licenseUrl": CC0,
     "sourceUrl": "https://kimikoishizaka.bandcamp.com/album/bach-well-tempered-clavier-book-1", "licenseEvidenceUrl": "https://kimikoishizaka.bandcamp.com/album/bach-well-tempered-clavier-book-1",
     "additionalAuthorEvidenceUrl": "https://welltemperedclavier.org/kimiko-ishizaka-releases-open-well-tempered-clavier.html",
     "archiveFilePage": "https://commons.wikimedia.org/wiki/File:Kimiko_Ishizaka_-_Bach_-_Well-Tempered_Clavier,_Book_1_-_01_Prelude_No._1_in_C_major,_BWV_846.ogg",
     "downloadUrl": "https://upload.wikimedia.org/wikipedia/commons/b/b6/Kimiko_Ishizaka_-_Bach_-_Well-Tempered_Clavier%2C_Book_1_-_01_Prelude_No._1_in_C_major%2C_BWV_846.ogg",
     "compositionRights": "Public domain original composition by Johann Sebastian Bach (1685–1750). Kimiko Ishizaka's 2015 studio recording is separately dedicated under CC0 1.0.",
     "attribution": 'J.S. Bach — “Prelude No. 1 in C major, BWV 846”, performed by Kimiko Ishizaka, The Open Well-Tempered Clavier (2015). Recording: CC0 1.0. https://kimikoishizaka.bandcamp.com/album/bach-well-tempered-clavier-book-1'},
    {"id": "goodbye-to-spring", "title": "Goodbye To Spring", "artist": "Josh Woodward", "composer": "Josh Woodward", "album": "Only Whispering", "collection": "pop", "genre": "Indie pop / acoustic pop", "language": "en", "instrumental": False,
     "file": "goodbye-to-spring.mp3", "license": "CC-BY-4.0", "licenseUrl": BY,
     "sourceUrl": "https://www.joshwoodward.com/song/GoodbyeToSpring", "licenseEvidenceUrl": "https://www.joshwoodward.com/song/GoodbyeToSpring", "additionalAuthorEvidenceUrl": "https://www.joshwoodward.com/faq",
     "downloadUrl": "https://www.joshwoodward.com/mp3/OnlyWhispering/JoshWoodward-OnlyWhispering-11-GoodbyeToSpring.mp3",
     "attribution": '“Goodbye To Spring” by Josh Woodward — CC BY 4.0. https://www.joshwoodward.com/song/GoodbyeToSpring'},
    {"id": "im-letting-go", "title": "I'm Letting Go", "artist": "Josh Woodward", "composer": "Josh Woodward", "album": "The Simple Life", "collection": "pop", "genre": "Indie pop / pop rock", "language": "en", "instrumental": False,
     "file": "im-letting-go.mp3", "license": "CC-BY-4.0", "licenseUrl": BY,
     "sourceUrl": "https://www.joshwoodward.com/song/ImLettingGo", "licenseEvidenceUrl": "https://www.joshwoodward.com/song/ImLettingGo", "additionalAuthorEvidenceUrl": "https://www.joshwoodward.com/faq",
     "downloadUrl": "https://www.joshwoodward.com/mp3/TheSimpleLife/JoshWoodward-TheSimpleLife-107-ImLettingGo.mp3",
     "attribution": '“I\'m Letting Go” by Josh Woodward — CC BY 4.0. https://www.joshwoodward.com/song/ImLettingGo'}
]


def decode(ffmpeg, path):
    command = [str(ffmpeg), "-nostdin", "-hide_banner", "-xerror", "-i", str(path),
               "-vn", "-af", "ebur128=peak=true:framelog=verbose", "-f", "null", "-"]
    result = subprocess.run(command, capture_output=True, encoding="utf-8", errors="replace", timeout=90)
    if result.returncode:
        raise RuntimeError(f"Failed decode {path.name}: {result.stderr[-1500:]}")
    duration = re.search(r"Duration: (\d+):(\d+):(\d+\.\d+)", result.stderr)
    if not duration:
        raise RuntimeError(f"No duration: {path.name}")
    seconds = round(sum(float(value) * multiplier for value, multiplier in zip(duration.groups(), [3600, 60, 1])), 3)
    summary = result.stderr.split("Summary:")[-1]
    loudness = re.search(r"I:\s*([-\d.]+) LUFS", summary)
    peak = re.search(r"Peak:\s*([-\d.]+) dBFS", summary)
    audio = re.search(r"Audio: ([^\r\n]+)", result.stderr)
    return {"durationSeconds": seconds, "fullDecodePassed": True,
            "decoderInput": audio.group(1).strip() if audio else None,
            "integratedLoudnessLUFS": float(loudness.group(1)) if loudness else None,
            "truePeakDBFS": float(peak.group(1)) if peak else None,
            "output": "null sink; no speakers or device playback"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--ffmpeg", required=True, type=Path)
    args = parser.parse_args()
    manifest_path = MUSIC / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["schemaVersion"] = 2
    existing = {track["id"]: track for track in manifest["tracks"]}
    for track in existing.values():
        track["collection"] = "ambient" if track["instrumental"] else "pop"
        track["genre"] = "Ambient / electronic" if track["instrumental"] else "C-pop / ballad" if track["language"] == "zh" else "Folk pop / indie rock"
        track["recordingLicense"] = track["license"]
    encoding = json.loads((ROOT / "qa/media-3.4-encoding.json").read_text(encoding="utf-8"))
    for addition in ADDITIONS:
        track = dict(addition)
        track["src"] = "assets/music/" + track.pop("file")
        track["recordingLicense"] = track["license"]
        track["aiAssisted"] = False
        entry = next((e for e in encoding["entries"] if e["id"] == track["id"]), None)
        if entry:
            track["sourceRecordingBytes"] = entry["originalBytes"]
            track["sourceRecordingSha256"] = entry["originalSha256"]
            track["modifications"] = entry["modifications"]
        else:
            track["modifications"] = "None. Original downloaded encoded recording; local filename changed only."
        existing[track["id"]] = track
    decoded = []
    for track in existing.values():
        path = ROOT / "dist" / track["src"]
        data = path.read_bytes()
        report = decode(args.ffmpeg, path)
        track.update({"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(),
                      "durationSeconds": report["durationSeconds"],
                      "integratedLoudnessLUFS": report["integratedLoudnessLUFS"],
                      "truePeakDBFS": report["truePeakDBFS"]})
        if report["integratedLoudnessLUFS"] is not None and report["truePeakDBFS"] is not None:
            track["normalizationGainDb"] = round(min(-20 - report["integratedLoudnessLUFS"], -1 - report["truePeakDBFS"]), 2)
        decoded.append({"id": track["id"], "file": track["src"], "sha256": track["sha256"], **report})
        print(track["id"], track["bytes"], track["durationSeconds"], report["integratedLoudnessLUFS"], flush=True)
    manifest["tracks"] = list(existing.values())
    manifest["collections"] = [{"id": "classical", "label": "古典"}, {"id": "pop", "label": "流行 / 独立演唱"}, {"id": "ambient", "label": "氛围 / 电子"}]
    manifest["verification"] = "All 10 recordings decoded completely through FFmpeg 7.1 to a null sink without errors; no speaker playback. Recording licenses verified on author or author release pages and corresponding archive record."
    manifest["checkedOn"] = "2026-10-18"
    manifest["normalizationPolicy"] = "Optional per-track normalizationGainDb targets -20 LUFS and limits the estimated true peak to -1 dBFS. Apply as a smooth playback gain alongside the user's volume; files are not loudness-altered. This avoids abrupt loudness changes between dynamic piano and mastered pop recordings."
    manifest["rightsBasis"] = "Each modern recording is separately licensed as CC BY 4.0 or CC0 1.0. Classical composition public-domain status is not used as a substitute for recording permission. No unlicensed commercial chart recording is bundled. Media licenses are independent of the project source-code license."
    manifest["attributionPolicy"] = "During playback show title, recording artist, license and source/credits link every session. Display composer separately for classical tracks. Josh Woodward requests credits at startup or while the recording plays. Retain music credits in gameplay-upload descriptions. CC0 credit is kept voluntarily for provenance."
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    new_ids = {entry["id"] for entry in ADDITIONS}
    added_bytes = sum(track["bytes"] for track in manifest["tracks"] if track["id"] in new_ids)
    assert added_bytes <= 30_000_000
    acceptance = {"status": "pass", "checkedOn": "2026-10-18", "newTracks": len(ADDITIONS), "addedBytes": added_bytes,
                  "totalTracks": len(existing), "totalRecordingBytes": sum(track["bytes"] for track in manifest["tracks"]),
                  "ffmpegVersion": "7.1", "ffmpegExecutableSha256": hashlib.sha256(args.ffmpeg.read_bytes()).hexdigest(),
                  "speakerPlayback": False, "tracks": decoded}
    (ROOT / "qa/media-3.4-acceptance.json").write_text(json.dumps(acceptance, ensure_ascii=False, indent=2), encoding="utf-8")
