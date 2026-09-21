/**
 * Write public/audio/manifest.json — the list of script keys that have a
 * recorded clip.
 *
 * VoiceProvider reads this to know whether to play `/audio/<key>.mp3` or fall
 * back to the browser's speech synthesis. Without the manifest the app still
 * works, but every un-recorded step costs one failed request before it speaks.
 *
 * Run after adding or removing clips:
 *   npx tsx scripts/build-audio-manifest.ts
 *
 * Keys present in public/audio but unknown to lib/voice/scripts.ts are
 * reported and left out — a clip nothing can request is almost always a typo
 * in the filename.
 */
import { readdirSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { VOICE_SCRIPTS } from '../lib/voice/scripts';

const AUDIO_DIR = join(process.cwd(), 'public', 'audio');

function main() {
  if (!existsSync(AUDIO_DIR)) {
    mkdirSync(AUDIO_DIR, { recursive: true });
    console.log(`Created ${AUDIO_DIR}`);
  }

  // A script contributes its own clip plus, when it has one, its repeat cue.
  const knownKeys = new Set<string>();
  for (const [key, script] of Object.entries(VOICE_SCRIPTS) as [string, { cue?: string }][]) {
    knownKeys.add(key);
    if (script.cue) knownKeys.add(`${key}.cue`);
  }
  const files = readdirSync(AUDIO_DIR).filter((f) => f.toLowerCase().endsWith('.mp3'));
  const keys = files.map((f) => f.replace(/\.mp3$/i, ''));

  const recognised = keys.filter((k) => knownKeys.has(k)).sort();
  const unknown = keys.filter((k) => !knownKeys.has(k)).sort();
  const missing = [...knownKeys].filter((k) => !recognised.includes(k)).sort();

  writeFileSync(join(AUDIO_DIR, 'manifest.json'), `${JSON.stringify(recognised, null, 2)}\n`);

  console.log(`manifest.json: ${recognised.length} clip(s) of ${knownKeys.size} expected.`);
  if (unknown.length > 0) {
    console.warn(`\nIgnored — no script key matches these filenames:`);
    unknown.forEach((k) => console.warn(`  ${k}.mp3`));
  }
  if (missing.length > 0) {
    console.log(`\nNot yet recorded (the browser voice covers these):`);
    missing.forEach((k) => console.log(`  ${k}.mp3`));
  }
}

main();
