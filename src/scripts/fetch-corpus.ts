import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { stripHtml } from "../core/tokenizer.js";

const TARGET = 100_000;
const PER_PAGE = 1000;
const OUT = "data/corpus.ndjson";

interface Hit {
  objectID: string;
  title?: string;
  story_text?: string;
  comment_text?: string;
  url?: string;
  created_at_i: number;
}

async function page(before: number, tag: string): Promise<Hit[]> {
  const url =
    `https://hn.algolia.com/api/v1/search_by_date` +
    `?tags=${tag}&hitsPerPage=${PER_PAGE}` +
    `&numericFilters=created_at_i<${before}`;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url);
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      const body = (await res.json()) as { hits: Hit[] };
      return body.hits ?? [];
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  return [];
}

async function main() {
  await mkdir("data", { recursive: true });
  const out = createWriteStream(OUT);

  const seenIds = new Set<number>();
  const seenContent = new Set<string>();

  let storyCursor = Math.floor(Date.now() / 1000);
  let commentCursor = storyCursor;
  let pageNum = 0;
  let written = 0;
  let skipped = 0;
  let stories = 0;
  let comments = 0;
  const started = Date.now();

  while (written < TARGET) {
    // alternate per PAGE, not per document — `written` jumps by ~1000
    // each iteration, so parity never flips if you key off it
    const isStory = pageNum % 2 === 0;
    const tag = isStory ? "story" : "comment";
    const cursor = isStory ? storyCursor : commentCursor;

    const hits = await page(cursor, tag);
    if (hits.length === 0) break;

    for (const h of hits) {
      const id = Number(h.objectID);
      if (seenIds.has(id)) {
        skipped++;
        continue;
      }
      seenIds.add(id);

      const title = stripHtml(h.title ?? "");
      const text = stripHtml(h.story_text ?? h.comment_text ?? "");

      // need something substantive to index
      if (!title && text.length < 40) {
        skipped++;
        continue;
      }

      // catch resubmissions of the same article. Guarded on `title`
      // because comments have none — without it every comment after
      // the first would collide on an identical empty fingerprint.
      if (title) {
        const fingerprint = `${title.toLowerCase()}|${h.url ?? ""}`;
        if (seenContent.has(fingerprint)) {
          skipped++;
          continue;
        }
        seenContent.add(fingerprint);
      }

      out.write(
        JSON.stringify({
          id,
          title,
          text,
          url: h.url ?? "",
          kind: tag,
        }) + "\n"
      );

      written++;
      if (isStory) stories++;
      else comments++;
      if (written >= TARGET) break;
    }

    // advance each cursor independently
    const oldest = hits[hits.length - 1]!.created_at_i;
    if (isStory) storyCursor = oldest;
    else commentCursor = oldest;
    pageNum++;

    const rate = written / ((Date.now() - started) / 1000);
    process.stdout.write(
      `\r  ${written}/${TARGET} written ` +
        `(${stories} stories, ${comments} comments), ` +
        `${skipped} skipped (${rate.toFixed(0)}/s)   `
    );
    await new Promise((r) => setTimeout(r, 150));
  }

  out.end();
  console.log(
    `\nWrote ${written} documents to ${OUT}` +
      `\n  stories:  ${stories}` +
      `\n  comments: ${comments}` +
      `\n  skipped:  ${skipped}`
  );
}

main();