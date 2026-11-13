import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const gPath = `
  M 752 327
  A 300 300 0 1 0 813 472
  L 504 472
  L 504 584
  L 681 584
  A 180 180 0 1 1 658 401
  Z
`;

const highlightPath = `
  M 752 327
  A 300 300 0 0 0 258 360
`;

const crossbarHighlightPath = `
  M 504 474 L 811 474
`;

const fullSvg = `<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="blueG" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#32D6FF"/>
      <stop offset="45%" stop-color="#0A84FF"/>
      <stop offset="100%" stop-color="#0044E0"/>
    </linearGradient>

    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0B101B"/>
      <stop offset="100%" stop-color="#02040A"/>
    </linearGradient>

    <radialGradient id="ambientGlow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#0A84FF" stop-opacity="0.22"/>
      <stop offset="65%" stop-color="#0044E0" stop-opacity="0.06"/>
      <stop offset="100%" stop-color="#02040A" stop-opacity="0"/>
    </radialGradient>

    <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="10" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>

  <!-- Dark rounded background -->
  <rect
    x="12"
    y="12"
    width="1000"
    height="1000"
    rx="160"
    fill="url(#bg)"
    stroke="#1B263B"
    stroke-width="6"
  />

  <!-- Subtle ambient blue radial glow -->
  <circle cx="512" cy="512" r="420" fill="url(#ambientGlow)"/>

  <!-- Blue G -->
  <path
    d="${gPath.trim()}"
    fill="url(#blueG)"
    filter="url(#glow)"
  />

  <!-- Crisp specular highlights -->
  <path
    d="${highlightPath.trim()}"
    fill="none"
    stroke="#6BE4FF"
    stroke-width="6"
    stroke-linecap="round"
    opacity="0.7"
  />
  <path
    d="${crossbarHighlightPath.trim()}"
    fill="none"
    stroke="#6BE4FF"
    stroke-width="5"
    stroke-linecap="round"
    opacity="0.55"
  />
</svg>`;

// Circular version for round launcher icon
const roundSvg = `<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="blueG" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#32D6FF"/>
      <stop offset="45%" stop-color="#0A84FF"/>
      <stop offset="100%" stop-color="#0044E0"/>
    </linearGradient>

    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0B101B"/>
      <stop offset="100%" stop-color="#02040A"/>
    </linearGradient>

    <radialGradient id="ambientGlow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#0A84FF" stop-opacity="0.22"/>
      <stop offset="65%" stop-color="#0044E0" stop-opacity="0.06"/>
      <stop offset="100%" stop-color="#02040A" stop-opacity="0"/>
    </radialGradient>

    <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="10" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>

    <clipPath id="circleClip">
      <circle cx="512" cy="512" r="500"/>
    </clipPath>
  </defs>

  <g clip-path="url(#circleClip)">
    <circle cx="512" cy="512" r="506" fill="url(#bg)" stroke="#1B263B" stroke-width="12"/>
    <circle cx="512" cy="512" r="420" fill="url(#ambientGlow)"/>
    <path
      d="${gPath.trim()}"
      fill="url(#blueG)"
      filter="url(#glow)"
    />
    <path
      d="${highlightPath.trim()}"
      fill="none"
      stroke="#6BE4FF"
      stroke-width="6"
      stroke-linecap="round"
      opacity="0.7"
    />
    <path
      d="${crossbarHighlightPath.trim()}"
      fill="none"
      stroke="#6BE4FF"
      stroke-width="5"
      stroke-linecap="round"
      opacity="0.55"
    />
  </g>
</svg>`;

// Foreground for adaptive icons (scaled to safe center area inside 108dp canvas)
const foregroundSvg = `<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="blueG" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#32D6FF"/>
      <stop offset="45%" stop-color="#0A84FF"/>
      <stop offset="100%" stop-color="#0044E0"/>
    </linearGradient>

    <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="10" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>

  <g transform="translate(143, 143) scale(0.72)">
    <path
      d="${gPath.trim()}"
      fill="url(#blueG)"
      filter="url(#glow)"
    />
    <path
      d="${highlightPath.trim()}"
      fill="none"
      stroke="#6BE4FF"
      stroke-width="6"
      stroke-linecap="round"
      opacity="0.7"
    />
    <path
      d="${crossbarHighlightPath.trim()}"
      fill="none"
      stroke="#6BE4FF"
      stroke-width="5"
      stroke-linecap="round"
      opacity="0.55"
    />
  </g>
</svg>`;

async function main() {
  const publicDir = path.resolve('public');
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
  }

  // Save SVGs
  fs.writeFileSync(path.join(publicDir, 'icon.svg'), fullSvg);
  fs.writeFileSync(path.join(publicDir, 'favicon.svg'), fullSvg);

  const fullSvgBuffer = Buffer.from(fullSvg);
  const roundSvgBuffer = Buffer.from(roundSvg);
  const foregroundSvgBuffer = Buffer.from(foregroundSvg);

  // Generate web icons
  await sharp(fullSvgBuffer).resize(512, 512).png().toFile(path.join(publicDir, 'icon-512.png'));
  await sharp(fullSvgBuffer).resize(192, 192).png().toFile(path.join(publicDir, 'icon-192.png'));
  await sharp(fullSvgBuffer).resize(180, 180).png().toFile(path.join(publicDir, 'apple-touch-icon.png'));
  await sharp(fullSvgBuffer).resize(32, 32).png().toFile(path.join(publicDir, 'favicon-32x32.png'));
  await sharp(fullSvgBuffer).resize(16, 16).png().toFile(path.join(publicDir, 'favicon-16x16.png'));

  // Android mipmap densities
  const densities = [
    { name: 'mipmap-mdpi', size: 48, fgSize: 108 },
    { name: 'mipmap-hdpi', size: 72, fgSize: 162 },
    { name: 'mipmap-xhdpi', size: 96, fgSize: 216 },
    { name: 'mipmap-xxhdpi', size: 144, fgSize: 324 },
    { name: 'mipmap-xxxhdpi', size: 192, fgSize: 432 },
  ];

  const resDir = path.resolve('android/app/src/main/res');

  for (const d of densities) {
    const targetDir = path.join(resDir, d.name);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    await sharp(fullSvgBuffer).resize(d.size, d.size).png().toFile(path.join(targetDir, 'ic_launcher.png'));
    await sharp(roundSvgBuffer).resize(d.size, d.size).png().toFile(path.join(targetDir, 'ic_launcher_round.png'));
    await sharp(foregroundSvgBuffer).resize(d.fgSize, d.fgSize).png().toFile(path.join(targetDir, 'ic_launcher_foreground.png'));
    console.log(`Generated ${d.name} (${d.size}x${d.size}, fg: ${d.fgSize}x${d.fgSize})`);
  }

  console.log('App icons generated successfully!');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
