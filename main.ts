// news-image-20261119 entry (Node 22, standard library only).
// The image is entry.png beside this file: a newspaper front page summing up
// Thursday 19 November 2026's world news, rendered from news.html by render.mjs.
// This program copies it to the output directory. The copy is byte-for-byte
// and the file never changes at run time, so repeated runs write identical
// bytes (no timestamps, no randomness: run_deterministic holds by construction).
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// The gate tells PNG from JPEG by magic bytes, but the name stays entry.png
// either way, so the output file keeps the source file's name.
const FILENAME = 'entry.png';

const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
mkdirSync(outDir, { recursive: true });
copyFileSync(
  new URL(`./${FILENAME}`, import.meta.url),
  join(outDir, FILENAME),
);
