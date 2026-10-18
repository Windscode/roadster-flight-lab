"""Reproducible local-source archive; never includes itself, backups or runtime files."""
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parent.parent
target = root / 'dist/assets/roadster-flight-lab-source.zip'
files = []
for item in root.rglob('*'):
    if not item.is_file() or item == target:
        continue
    parts = item.relative_to(root).parts
    if any(p in {'.git', '.audit-backups', '.runtime', '.pages-site', 'node_modules', '__pycache__'} for p in parts):
        continue
    if (parts[0] == 'qa' and 'city-references' in parts and item.suffix != '.json') or item.suffix in {'.log', '.zip'} or (parts[0] == 'qa' and item.suffix == '.png'):
        continue
    if parts[:3] == ('dist', 'assets', 'references') and item.suffix.lower() in {'.jpg', '.jpeg', '.png', '.webp'}:
        continue
    if item.relative_to(root).as_posix() == 'dist/assets/reference-roadster.jpg':
        continue
    files.append(item)
target.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
    for item in sorted(files):
        archive.write(item, Path('roadster-flight-lab') / item.relative_to(root))
with zipfile.ZipFile(target) as archive:
    assert archive.testzip() is None, 'Archive CRC check failed'
    assert 'roadster-flight-lab/dist/physics.js' in archive.namelist()
print(f'{target}\n{len(files)} files, {target.stat().st_size:,} bytes, CRC verified')

