// news-image-20261119: the entry program for make.fun's "Sum up 19 November's
// world news in one image" bounty. The finished front page ships in this
// repository as entry.png (a 1024x1024 JPEG, polished by the entrant from the
// programmatic render in news.html), and this program places an exact copy of
// it at /output/entry.png. Nothing is drawn or randomised at run time, so two
// runs always write the same bytes.
//
// Node's standard library only: nothing is installed before this runs.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { copyFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

// The grader sets MAKEFUN_OUTPUT_DIR when it runs outside its container;
// inside the container the output directory is /output.
const outDir = process.env['MAKEFUN_OUTPUT_DIR'] ?? '/output'
mkdirSync(outDir, { recursive: true })

// Same bytes in, same bytes out: the copy is exact, so the run is
// deterministic by construction.
const source = new URL('./entry.png', import.meta.url)
copyFileSync(source, join(outDir, 'entry.png'))
