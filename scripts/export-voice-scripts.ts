/**
 * Export the recording sheet for the voice clips.
 *
 * One row per clip: the filename to save it as, and the exact words to speak.
 * Generated from lib/voice/scripts.ts, so the sheet can never drift from what
 * the app falls back to when a clip is missing.
 *
 * Usage:
 *   npx tsx scripts/export-voice-scripts.ts            # writes outputs/voice-scripts.csv + .txt
 *   npx tsx scripts/export-voice-scripts.ts --out=/tmp
 *
 * Save each recording as public/audio/<key>.mp3, then run
 * `npx tsx scripts/build-audio-manifest.ts` so the app starts using it.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { VOICE_SCRIPTS } from '../lib/voice/scripts';

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function main() {
  const outArg = process.argv.find((a) => a.startsWith('--out='));
  const outDir = outArg ? outArg.slice('--out='.length) : join(process.cwd(), 'outputs');
  mkdirSync(outDir, { recursive: true });

  const entries = Object.entries(VOICE_SCRIPTS) as [string, { text: string; cue?: string }][];

  const csv = [
    ['filename', 'key', 'text_to_record', 'repeat_cue_not_recorded'].join(','),
    ...entries.map(([key, script]) =>
      [
        csvCell(`${key}.mp3`),
        csvCell(key),
        csvCell(script.text),
        csvCell(script.cue ?? ''),
      ].join(',')
    ),
  ].join('\n');

  const txt = entries
    .map(([key, script]) => {
      const cue = script.cue ? `\n   (spoken reminder, browser voice only: ${script.cue})` : '';
      return `── ${key}.mp3 ──\n${script.text}${cue}`;
    })
    .join('\n\n');

  const csvPath = join(outDir, 'voice-scripts.csv');
  const txtPath = join(outDir, 'voice-scripts.txt');
  writeFileSync(csvPath, `${csv}\n`);
  writeFileSync(txtPath, `${txt}\n`);

  const words = entries.reduce((n, [, s]) => n + s.text.split(/\s+/).length, 0);
  console.log(`${entries.length} clips → ${csvPath}`);
  console.log(`${entries.length} clips → ${txtPath}`);
  console.log(`≈${words} words total, roughly ${Math.round(words / 150)} min of speech.`);
}

main();
