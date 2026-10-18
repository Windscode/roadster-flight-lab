"""Acquire only explicitly reusable audio and animal assets from their authors.

No preview is played and no third-party streaming ripper is used. Converts the
author's self-contained glTF files to GLB without altering their geometry.
"""
import base64
import hashlib
import json
from pathlib import Path
import re
import struct
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
HEADERS = {"User-Agent": "Mozilla/5.0"}


def fetch(url):
    request = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(request, timeout=90) as response:
        return response.read()


def sha(data):
    return hashlib.sha256(data).hexdigest()


def convert_glb(source, destination):
    doc = json.loads(source.read_bytes())
    assert len(doc["buffers"]) == 1
    uri = doc["buffers"][0].pop("uri")
    assert uri.startswith("data:application/octet-stream;base64,")
    binary = base64.b64decode(uri.split(",", 1)[1])
    assert len(binary) == doc["buffers"][0]["byteLength"]
    assert not any("uri" in item for item in doc.get("images", []))
    # Retain the author's generator, original node names, skins and animations.
    encoded = json.dumps(doc, separators=(",", ":"), ensure_ascii=False).encode()
    encoded += b" " * (-len(encoded) % 4)
    binary += b"\0" * (-len(binary) % 4)
    total = 12 + 8 + len(encoded) + 8 + len(binary)
    glb = struct.pack("<III", 0x46546C67, 2, total)
    glb += struct.pack("<II", len(encoded), 0x4E4F534A) + encoded
    glb += struct.pack("<II", len(binary), 0x004E4942) + binary
    destination.write_bytes(glb)
    return doc


if __name__ == "__main__":
    directory = ROOT / "dist/assets/characters"
    directory.mkdir(parents=True, exist_ok=True)
    for name, drive_id in [("fox", "1z-CWoUC2vJxrqgGFTYlMaywpE1ooV-bA"), ("shiba-inu", "1XWUVbmMbiG9E90OqrumueD_pBdnYdyHZ")]:
        original = directory / f"quaternius-{name}.gltf"
        destination = directory / f"quaternius-{name}.glb"
        original.write_bytes(fetch(f"https://drive.google.com/uc?export=download&id={drive_id}"))
        convert_glb(original, destination)
        original.unlink()  # Only the self-contained runtime GLB is distributed.
        print(destination.name, destination.stat().st_size)

    music_directory = ROOT / "dist/assets/music"
    music_directory.mkdir(parents=True, exist_ok=True)
    sources = [
        ("cylinder-five.m4a", "https://audio.chriszabriskie.com/cylinders/cylinders-05.m4a"),
        ("cylinder-seven.m4a", "https://audio.chriszabriskie.com/cylinders/cylinders-07.m4a"),
        ("swansong.mp3", "https://www.joshwoodward.com/mp3/Breadcrumbs/JoshWoodward-Breadcrumbs-01-Swansong.mp3"),
        ("learn-to-fly.mp3", "https://www.joshwoodward.com/mp3/HereToday/JoshWoodward-HereTodayRemixed-06-LearnToFly.mp3")
    ]
    for name, url in sources:
        data = fetch(url)
        assert len(data) > 100_000 and not data.startswith(b"<!DOCTYPE")
        (music_directory / name).write_bytes(data)
        print(name, len(data))

    # The FMA author-upload page explicitly covers this recording, not merely
    # lyrics or an article about it. It also discloses AI assistance.
    page = "https://freemusicarchive.org/music/adeline-yeo-hp/single/suiyuedehenji/"
    html = fetch(page).decode()
    assert "creativecommons.org/licenses/by/4.0" in html
    match = re.search(r'"fileUrl":"([^"]+)"', html)
    if not match:
        raise ValueError("Author page no longer exposes the recording URL")
    url = match.group(1).replace("\\/", "/")
    data = fetch(url)
    assert len(data) > 100_000 and not data.startswith(b"<!DOCTYPE")
    (ROOT / "dist/assets/music/traces-of-time.mp3").write_bytes(data)
    (ROOT / "qa/media-3.3-chinese-recording-source.json").write_text(
        json.dumps({"authorPage": page, "recordingURL": url, "bytes": len(data),
                    "sha256": sha(data), "license": "CC-BY-4.0",
                    "aiAssistedDisclosed": True}, indent=2), encoding="utf-8")
    print("traces-of-time.mp3", len(data))
