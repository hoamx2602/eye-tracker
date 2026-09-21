/**
 * Generate the participant voice clips with Deepgram Aura-2.
 *
 * Reads lib/voice/scripts.ts — the single source of truth for the wording —
 * and writes one MP3 per key into public/audio/, which is exactly where
 * VoiceProvider looks for them. The browser's own speech synthesis stays as
 * the fallback for anything that fails to generate or fails to load.
 *
 * Voice: aura-2-pandora-en. Only two Aura-2 voices are British, and this is the
 * one Deepgram lists for informative content — the accent matters because every
 * line is written in British English ("centre", "whilst you rest"), and a US
 * voice reading UK spelling is the kind of small wrongness participants notice.
 * Use --model to try the other one (aura-2-draco-en, male) or any Aura voice.
 *
 * Usage:
 *   npm run voice:generate                    # only the clips that are missing
 *   npm run voice:generate -- --force         # regenerate everything
 *   npm run voice:generate -- --only=calib.intro,ex.wiggling
 *   npm run voice:generate -- --model=aura-2-draco-en --force
 *   npm run voice:generate -- --dry-run       # list what would be generated
 *
 * Rebuilds public/audio/manifest.json at the end, so the app picks the new
 * clips up with no further steps.
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { VOICE_SCRIPTS, getScript, type VoiceKey } from '../lib/voice/scripts';

/**
 * Every clip to generate: a script's full text, plus its repeat cue when it
 * has one. Cues get their own file because they are what a participant hears
 * most during a long task.
 */
function allClips(): { name: string; text: string }[] {
  const out: { name: string; text: string }[] = [];
  for (const key of Object.keys(VOICE_SCRIPTS) as VoiceKey[]) {
    const script = getScript(key);
    out.push({ name: key, text: script.text });
    if (script.cue) out.push({ name: `${key}.cue`, text: script.cue });
  }
  return out;
}

const API_URL = 'https://api.deepgram.com/v1/speak';
const AUDIO_DIR = join(process.cwd(), 'public', 'audio');

/** British, calm, and the voice Deepgram lists for informative content. */
const DEFAULT_MODEL = 'aura-2-pandora-en';
/** Deepgram rejects a request over this with 413. Our longest line is ~450. */
const MAX_CHARS = 2000;
/** Polite concurrency — this is a one-off batch of ~30 short requests. */
const CONCURRENCY = 3;
const MAX_ATTEMPTS = 3;

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

const MODEL = arg('model') ?? DEFAULT_MODEL;
const FORCE = process.argv.includes('--force');
const DRY_RUN = process.argv.includes('--dry-run');
const ONLY = arg('only')?.split(',').map((s) => s.trim()).filter(Boolean) ?? null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One clip. Retries on rate limits and server errors; a 4xx that is not 429 is
 * a bad request and retrying it would only repeat the same mistake.
 */
async function synthesise(apiKey: string, text: string): Promise<Buffer> {
  const url = `${API_URL}?model=${encodeURIComponent(MODEL)}&encoding=mp3&bit_rate=48000`;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Token ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
    });

    if (res.ok) {
      return Buffer.from(await res.arrayBuffer());
    }

    const retriable = res.status === 429 || res.status >= 500;
    const body = await res.text().catch(() => '');
    if (!retriable || attempt === MAX_ATTEMPTS) {
      throw new Error(`Deepgram ${res.status}: ${body.slice(0, 300)}`);
    }
    await sleep(attempt * 1500);
  }
  throw new Error('unreachable');
}

/** Rewrite manifest.json from what is actually on disk. */
function writeManifest(): number {
  const known = new Set(allClips().map((c) => c.name));
  const keys = readdirSync(AUDIO_DIR)
    .filter((f) => f.toLowerCase().endsWith('.mp3'))
    .map((f) => f.replace(/\.mp3$/i, ''))
    .filter((k) => known.has(k))
    .sort();
  writeFileSync(join(AUDIO_DIR, 'manifest.json'), `${JSON.stringify(keys, null, 2)}\n`);
  return keys.length;
}

async function main() {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    console.error('DEEPGRAM_API_KEY is not set. Add it to .env and try again.');
    process.exit(1);
  }

  mkdirSync(AUDIO_DIR, { recursive: true });

  const clips = allClips();
  if (ONLY) {
    const known = new Set(clips.map((c) => c.name));
    const unknown = ONLY.filter((k) => !known.has(k));
    if (unknown.length > 0) {
      console.error(`Not a clip name: ${unknown.join(', ')}`);
      process.exit(1);
    }
  }

  const candidates = clips.filter((c) => (ONLY ? ONLY.includes(c.name) : true));
  const todo = candidates.filter(
    (c) => FORCE || !existsSync(join(AUDIO_DIR, `${c.name}.mp3`))
  );
  const skipped = candidates.length - todo.length;

  const tooLong = todo.filter((c) => c.text.length > MAX_CHARS);
  if (tooLong.length > 0) {
    console.error(
      `Over ${MAX_CHARS} characters, Deepgram will reject: ${tooLong.map((c) => c.name).join(', ')}`
    );
    process.exit(1);
  }

  console.log(`Voice:  ${MODEL}`);
  console.log(`Output: ${AUDIO_DIR}`);
  console.log(`${todo.length} to generate${skipped > 0 ? `, ${skipped} already present` : ''}.\n`);

  if (DRY_RUN) {
    todo.forEach((c) => console.log(`  would generate ${c.name}.mp3 (${c.text.length} chars)`));
    return;
  }
  if (todo.length === 0) {
    console.log('Nothing to do. Pass --force to regenerate.');
    console.log(`manifest.json lists ${writeManifest()} clip(s).`);
    return;
  }

  let cursor = 0;
  let bytes = 0;
  const failures: { key: string; error: string }[] = [];

  const worker = async (): Promise<void> => {
    while (cursor < todo.length) {
      const { name, text } = todo[cursor++]!;
      try {
        const audio = await synthesise(apiKey, text);
        writeFileSync(join(AUDIO_DIR, `${name}.mp3`), audio);
        bytes += audio.length;
        console.log(`  ✓ ${name}.mp3  ${(audio.length / 1024).toFixed(0)} KB`);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        failures.push({ key: name, error: message });
        console.error(`  ✗ ${name}  ${message}`);
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, todo.length) }, () => worker())
  );

  const count = writeManifest();
  console.log(
    `\n${todo.length - failures.length}/${todo.length} generated, ` +
      `${(bytes / 1024 / 1024).toFixed(2)} MB. manifest.json lists ${count} clip(s).`
  );

  if (failures.length > 0) {
    console.error(
      `\n${failures.length} failed — those steps fall back to the browser voice. Retry with:\n` +
        `  npm run voice:generate -- --only=${failures.map((f) => f.key).join(',')}`
    );
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
