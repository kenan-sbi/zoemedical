// Repair Arabic (and other RTL) text that a PDF text-layer extractor emitted as reversed,
// presentation-form glyphs (e.g. "مﺎﻈﻌﻟا ﻲﻓ..." instead of "لا تشكو..."). Only touches strings that
// actually contain Arabic Presentation Forms — clean/logical Arabic and non-Arabic pass through
// unchanged. Reverse the visual-order glyph runs FIRST, then NFKC-normalize (so ligatures like
// ﻻ land in correct logical order).
const PRESENTATION = /[ﭐ-﷿ﹰ-﻿]/;
const RTL_RUN = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿،؛؟ ]+/g;

export function fixArabic(input: string | null | undefined): string {
  if (!input) return input ?? '';
  if (!PRESENTATION.test(input)) return input; // already logical / not mangled
  return input.replace(RTL_RUN, (m) => [...m].reverse().join('')).normalize('NFKC');
}
