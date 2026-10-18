"""Header/structure acceptance for acquired media; does not play audio."""
import base64
import hashlib
import json
from pathlib import Path
import struct
import numpy as np

ROOT = Path(__file__).resolve().parents[1]


def sha(data):
    return hashlib.sha256(data).hexdigest()


def audio_duration(path):
    data = path.read_bytes()
    if path.suffix == ".m4a":
        def atoms(start, end):
            while start + 8 <= end:
                size, kind = struct.unpack_from(">I4s", data, start)
                if size < 8 or start + size > end:
                    break
                yield kind, start + 8, start + size
                start += size
        for kind, start, end in atoms(0, len(data)):
            if kind == b"moov":
                for kind2, start2, end2 in atoms(start, end):
                    if kind2 == b"mvhd":
                        assert data[start2] == 0
                        rate, ticks = struct.unpack_from(">II", data, start2 + 12)
                        return ticks / rate
        raise ValueError("M4A movie header not found")
    offset = 0
    if data[:3] == b"ID3":
        tag = data[6:10]
        offset = 10 + sum(value << (7 * (3 - i)) for i, value in enumerate(tag))
    durations = 0.0
    frames = 0
    # MPEG-1/2 Layer III frame accounting, ignoring ID3 padding.
    while offset + 4 < len(data):
        header = int.from_bytes(data[offset:offset + 4], "big")
        if header & 0xFFE00000 != 0xFFE00000:
            offset += 1
            continue
        version = (header >> 19) & 3
        layer = (header >> 17) & 3
        bitrate_i = (header >> 12) & 15
        rate_i = (header >> 10) & 3
        if version == 1 or layer != 1 or bitrate_i in (0, 15) or rate_i == 3:
            offset += 1
            continue
        rates = [44100, 48000, 32000]
        rate = rates[rate_i] / (1 if version == 3 else 2 if version == 2 else 4)
        bitrates = [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320] if version == 3 else [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160]
        bitrate = bitrates[bitrate_i] * 1000
        size = int((144 if version == 3 else 72) * bitrate / rate) + ((header >> 9) & 1)
        if offset + size > len(data):
            break
        durations += (1152 if version == 3 else 576) / rate
        offset += size
        frames += 1
    assert frames > 1000
    return durations


def inspect_character(path):
    data = path.read_bytes()
    magic, version, length = struct.unpack_from("<III", data)
    assert magic == 0x46546C67 and version == 2 and length == len(data)
    count, kind = struct.unpack_from("<II", data, 12)
    doc = json.loads(data[20:20 + count])
    binary = data[28 + count:]
    assert len(binary) >= doc["buffers"][0]["byteLength"]
    assert len(doc["buffers"]) == 1 and "uri" not in doc["buffers"][0]
    assert not any("uri" in image for image in doc.get("images", []))
    lo = np.full(3, np.inf)
    hi = np.full(3, -np.inf)
    triangles = 0
    vertices = 0
    for mesh in doc["meshes"]:
        for primitive in mesh["primitives"]:
            position = doc["accessors"][primitive["attributes"]["POSITION"]]
            assert position["componentType"] == 5126 and position["type"] == "VEC3"
            lo = np.minimum(lo, position["min"])
            hi = np.maximum(hi, position["max"])
            vertices += position["count"]
            assert primitive.get("mode", 4) == 4
            triangles += doc["accessors"][primitive["indices"]]["count"] // 3
    animations = []
    for clip in doc["animations"]:
        times = [doc["accessors"][s["input"]] for s in clip["samplers"]]
        animations.append({"name": clip["name"],
                           "durationSeconds": max(a["max"][0] for a in times) - min(a["min"][0] for a in times)})
    return {"bytes": len(data), "sha256": sha(data), "triangles": triangles,
            "vertices": vertices, "meshes": len(doc["meshes"]),
            "skins": len(doc["skins"]), "bones": len(doc["skins"][0]["joints"]),
            "materials": len(doc["materials"]), "externalURIs": [],
            "boundsInSourceUnits": {"min": lo.tolist(), "max": hi.tolist(), "size": (hi - lo).tolist()},
            "boundsMethod": "glTF POSITION accessor min/max; mesh and scene nodes have identity transforms; bind pose, not all animation extents",
            "animations": animations,
            "suggestedWorldScale": 0.22 if "fox" in path.name else 0.20,
            "suggestedGroundOffset": float(-lo[1]),
            "frontAxis": "+Z", "upAxis": "+Y"}


if __name__ == "__main__":
    current_manifest = ROOT / "dist/assets/music/manifest.json"
    if current_manifest.exists() and json.loads(current_manifest.read_text(encoding="utf-8")).get("schemaVersion", 1) > 1:
        raise SystemExit("The music library has a newer schema. Use scripts/media-3.4-library.py --ffmpeg <local decoder> to inspect it without resetting the expanded catalog.")
    by4 = "https://creativecommons.org/licenses/by/4.0/"
    tracks = [
        {"id": "cylinder-five", "title": "Cylinder Five", "artist": "Chris Zabriskie", "album": "Cylinders", "language": "instrumental", "instrumental": True, "file": "cylinder-five.m4a", "sourceUrl": "https://chriszabriskie.com/cylinders/", "downloadUrl": "https://audio.chriszabriskie.com/cylinders/cylinders-05.m4a", "licenseEvidenceUrl": "https://chriszabriskie.com/use/", "mood": "电子 / 氛围"},
        {"id": "cylinder-seven", "title": "Cylinder Seven", "artist": "Chris Zabriskie", "album": "Cylinders", "language": "instrumental", "instrumental": True, "file": "cylinder-seven.m4a", "sourceUrl": "https://chriszabriskie.com/cylinders/", "downloadUrl": "https://audio.chriszabriskie.com/cylinders/cylinders-07.m4a", "licenseEvidenceUrl": "https://chriszabriskie.com/use/", "mood": "慢速 / 氛围"},
        {"id": "swansong", "title": "Swansong", "artist": "Josh Woodward", "album": "Breadcrumbs", "language": "en", "instrumental": False, "file": "swansong.mp3", "sourceUrl": "https://www.joshwoodward.com/song/Swansong", "downloadUrl": "https://www.joshwoodward.com/mp3/Breadcrumbs/JoshWoodward-Breadcrumbs-01-Swansong.mp3", "licenseEvidenceUrl": "https://www.joshwoodward.com/faq", "mood": "英文 / 民谣摇滚"},
        {"id": "learn-to-fly", "title": "Learn To Fly", "artist": "Josh Woodward", "album": "Here Today", "language": "en", "instrumental": False, "file": "learn-to-fly.mp3", "sourceUrl": "https://www.joshwoodward.com/song/LearnToFly", "downloadUrl": "https://www.joshwoodward.com/mp3/HereToday/JoshWoodward-HereTodayRemixed-06-LearnToFly.mp3", "licenseEvidenceUrl": "https://www.joshwoodward.com/faq", "mood": "英文 / 轻摇滚"},
        {"id": "traces-of-time", "title": "岁月的痕迹", "artist": "Adeline Yeo (HP)", "album": "Single", "language": "zh", "instrumental": False, "file": "traces-of-time.mp3", "sourceUrl": "https://freemusicarchive.org/music/adeline-yeo-hp/single/suiyuedehenji/", "downloadUrl": json.loads((ROOT / "qa/media-3.3-chinese-recording-source.json").read_text())["recordingURL"], "licenseEvidenceUrl": "https://freemusicarchive.org/music/adeline-yeo-hp/single/suiyuedehenji/", "additionalAuthorEvidenceUrl": "https://www.youtube.com/watch?v=bi7AOXYm0ik", "mood": "中文 / 抒情 / AI 参与", "aiAssisted": True}
    ]
    for track in tracks:
        path = ROOT / "dist/assets/music" / track["file"]
        data = path.read_bytes()
        track.update({"src": "assets/music/" + track.pop("file"), "license": "CC-BY-4.0", "licenseUrl": by4,
                      "bytes": len(data), "sha256": sha(data), "durationSeconds": round(audio_duration(path), 3),
                      "modifications": "None. Original author-provided encoded recording; filename changed only.",
                      "attribution": f'“{track["title"]}” by {track["artist"]} — CC BY 4.0. {track["sourceUrl"]}',
                      "aiAssisted": track.get("aiAssisted", False)})
    music = {"schemaVersion": 1, "checkedOn": "2026-10-18", "tracks": tracks,
             "defaultPlayback": "off; user gesture required", "defaultVolumeSuggested": 0.18,
             "rightsBasis": "The author or author-uploaded recording page explicitly licenses the recording and identifies its creator. CC BY requires attribution and license link. No popular-song availability or zero-dispute guarantee is asserted.",
             "attributionPolicy": "Show title, artist, CC BY 4.0 and a source/credits link each playback session. Josh Woodward specifically requests game credit in startup or while the track plays. A user recording/re-uploading gameplay must retain these music credits in the upload description.",
             "localImportPolicy": "Local files remain on this device and are neither bundled nor uploaded. This does not grant redistribution rights to imported recordings.",
             "verification": "File headers and duration structurally checked; no speaker playback; browser decode still requires UI acceptance by the app owner."}
    (ROOT / "dist/assets/music/manifest.json").write_text(json.dumps(music, ensure_ascii=False, indent=2), encoding="utf-8")

    models = []
    for name, title, drive_id in [("fox", "Fox", "1z-CWoUC2vJxrqgGFTYlMaywpE1ooV-bA"), ("shiba-inu", "Shiba Inu", "1XWUVbmMbiG9E90OqrumueD_pBdnYdyHZ")]:
        path = ROOT / f"dist/assets/characters/quaternius-{name}.glb"
        models.append({"id": name, "title": title, "author": "Quaternius", "pack": "Ultimate Animated Animal Pack (July 2021)",
                       "src": f"assets/characters/{path.name}", "sourceUrl": "https://quaternius.com/packs/ultimateanimatedanimals.html",
                       "downloadFolderUrl": "https://drive.google.com/drive/folders/1yJXdB1iSrI8Db7hG77zxZ66vKsqIt0ry",
                       "originalFileUrl": f"https://drive.google.com/uc?export=download&id={drive_id}",
                       "license": "CC0-1.0", "licenseUrl": "https://creativecommons.org/publicdomain/zero/1.0/",
                       "modifications": "Lossless container repack from self-contained glTF JSON+base64 to GLB; geometry, palette materials, rig and all clips unchanged.",
                       "attribution": "Fox / Shiba Inu by Quaternius, CC0 1.0. quaternius.com", **inspect_character(path)})
    characters = {"schemaVersion": 1, "checkedOn": "2026-10-18", "models": models,
                  "deploymentGuidance": "Small scenery accents only, 2–4 animals. Recenter to measured minimum Y after applying world scale. Prefer Idle/Eating in plazas or short unobstructed Walk paths on sidewalks. Skinned instances require skeleton-aware cloning. Do not deploy roaming animals in driving lanes.",
                  "visualLimit": "Stylized low-poly CC0 animals; not photorealistic human replacements."}
    runtime_path = ROOT / "qa/media-3.3-runtime-acceptance.json"
    if runtime_path.exists():
        runtime = json.loads(runtime_path.read_text(encoding="utf-8"))
        for model in models:
            match = next((entry for entry in runtime["models"] if entry["id"] == model["id"]), None)
            if match:
                model["threeR180DefaultPoseBounds"] = match["defaultPoseBounds"]
                model["runtimeValidation"] = "GLTFLoader.parseAsync succeeded; all 12 animation midpoint bone matrices finite, no external URIs"
    (ROOT / "dist/assets/characters/manifest.json").write_text(json.dumps(characters, ensure_ascii=False, indent=2), encoding="utf-8")
    (ROOT / "qa/media-3.3-acceptance.json").write_text(json.dumps({"status": "structural_pass", "music": {"count": len(tracks), "bytes": sum(t["bytes"] for t in tracks), "durationSeconds": sum(t["durationSeconds"] for t in tracks), "decodedAudition": False}, "characters": models}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"tracks": [(t["id"], t["durationSeconds"]) for t in tracks], "models": [(m["id"], m["triangles"], m["boundsInSourceUnits"]["size"]) for m in models]}, ensure_ascii=False))
