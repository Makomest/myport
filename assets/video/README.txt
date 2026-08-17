Put your hero background video here.

Required:
  hero.mp4    (H.264, 16:9, 4K or 1080p, seamless loop, 5-10s)
Optional (smaller file, loads first where supported):
  hero.webm   (VP9)

The site auto-plays it muted and looped behind the hero headline.
Until you add the file, a dark placeholder image shows instead.
Users with "reduce motion" enabled never download it.

Tip: keep it under ~6 MB. Compress with HandBrake or:
  ffmpeg -i input.mp4 -vf scale=1920:-2 -crf 28 -an hero.mp4
  ffmpeg -i input.mp4 -vf scale=1920:-2 -c:v libvpx-vp9 -crf 34 -an hero.webm
