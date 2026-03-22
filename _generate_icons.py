#!/usr/bin/env python3
"""Generate all PWA/favicon icons from the Thelemar symbol ICO."""
from PIL import Image

# Load the best frame (64x64) from the ICO
ico = Image.open('thelemar_symbol_wip_2_icon.ico')
ico.seek(0)  # Frame 0 is 64x64
source = ico.copy().convert('RGBA')
print(f"Source: {source.size}")

RESAMPLE = Image.Resampling.LANCZOS

# Favicon PNGs
for s in [16, 32, 48, 64, 128, 144, 256]:
    source.resize((s, s), RESAMPLE).save(f'favicon-{s}x{s}.png', 'PNG')
    print(f"  favicon-{s}x{s}.png")

# Android Chrome PNGs
for s in [192, 256, 384, 512]:
    source.resize((s, s), RESAMPLE).save(f'android-chrome-{s}x{s}.png', 'PNG')
    print(f"  android-chrome-{s}x{s}.png")

# Apple Touch Icons
for s in [120, 152, 167, 180, 360]:
    source.resize((s, s), RESAMPLE).save(f'apple-touch-icon-{s}x{s}.png', 'PNG')
    print(f"  apple-touch-icon-{s}x{s}.png")

# MS Tiles (square)
for s in [70, 144, 150, 310]:
    source.resize((s, s), RESAMPLE).save(f'mstile-{s}x{s}.png', 'PNG')
    print(f"  mstile-{s}x{s}.png")

# MS Tile wide (310x150) - centered
wide = Image.new('RGBA', (310, 150), (0, 0, 0, 0))
icon_w = source.resize((130, 130), RESAMPLE)
wide.paste(icon_w, (90, 10), icon_w)
wide.save('mstile-310x150.png', 'PNG')
print("  mstile-310x150.png")

# icon/ directory
for s in [192, 512, 1024]:
    source.resize((s, s), RESAMPLE).save(f'icon/icon-{s}.png', 'PNG')
    print(f"  icon/icon-{s}.png")

# Maskable icon (1024x1024 with safe zone padding)
maskable_size = 1024
safe_icon_size = int(maskable_size * 0.7)
maskable = Image.new('RGBA', (maskable_size, maskable_size), (255, 255, 255, 255))
icon_m = source.resize((safe_icon_size, safe_icon_size), RESAMPLE)
offset = (maskable_size - safe_icon_size) // 2
maskable.paste(icon_m, (offset, offset), icon_m)
maskable.save('maskable_icon.png', 'PNG')
print("  maskable_icon.png")

# favicon.ico (multi-size from original ICO frames)
ico_images = []
for s in [16, 24, 32, 48, 64]:
    ico_orig = Image.open('thelemar_symbol_wip_2_icon.ico')
    found = False
    for i in range(ico_orig.n_frames):
        ico_orig.seek(i)
        if ico_orig.size == (s, s):
            ico_images.append(ico_orig.copy().convert('RGBA'))
            found = True
            break
    if not found:
        ico_images.append(source.resize((s, s), RESAMPLE))

ico_images[0].save(
    'favicon.ico',
    format='ICO',
    sizes=[(img.size[0], img.size[1]) for img in ico_images],
    append_images=ico_images[1:]
)
print("  favicon.ico (multi-size)")

# favicon_preview.png
source.resize((32, 32), RESAMPLE).save('favicon_preview.png', 'PNG')
print("  favicon_preview.png")

print("\nAll icons generated!")
