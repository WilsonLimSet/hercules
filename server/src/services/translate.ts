// Free translation using Lingva Translate API
// Lingva is a free alternative frontend for Google Translate

const LINGVA_INSTANCES = [
  'https://lingva.ml',
  'https://lingva.garuber.workers.dev',
  'https://translate.plausibility.cloud',
];

export interface TranslationResult {
  original: string;
  translated: string;
  sourceLang: string;
  targetLang: string;
}

// Translate text using Lingva API
export const translateText = async (
  text: string,
  sourceLang: string = 'auto',
  targetLang: string = 'id'
): Promise<TranslationResult> => {
  if (!text.trim()) {
    return { original: text, translated: text, sourceLang, targetLang };
  }

  console.log(`[TRANSLATE] Translating ${text.length} chars to ${targetLang}`);

  // Try each Lingva instance until one works
  for (const instance of LINGVA_INSTANCES) {
    try {
      const encodedText = encodeURIComponent(text);
      const url = `${instance}/api/v1/${sourceLang}/${targetLang}/${encodedText}`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        console.warn(`[TRANSLATE] ${instance} returned ${response.status}`);
        continue;
      }

      const data = await response.json() as { translation?: string; info?: { detectedSource?: string } };

      if (data.translation) {
        console.log(`[TRANSLATE] Success via ${instance}`);
        return {
          original: text,
          translated: data.translation,
          sourceLang: data.info?.detectedSource || sourceLang,
          targetLang,
        };
      }
    } catch (error) {
      console.warn(`[TRANSLATE] ${instance} failed:`, error);
      continue;
    }
  }

  throw new Error('All translation services failed');
};

// Translate multiple segments in batch
export const translateSegments = async (
  segments: { text: string; offset: number; duration: number }[],
  targetLang: string
): Promise<{ text: string; translatedText: string; offset: number; duration: number }[]> => {
  // Combine all text for a single API call (more efficient)
  const combinedText = segments.map(s => s.text).join(' ||| ');

  try {
    const result = await translateText(combinedText, 'auto', targetLang);
    const translatedParts = result.translated.split(' ||| ');

    return segments.map((seg, i) => ({
      ...seg,
      translatedText: translatedParts[i] || seg.text,
    }));
  } catch (error) {
    console.error('[TRANSLATE] Batch translation failed, falling back to individual');

    // Fallback: translate each segment individually
    const results = [];
    for (const seg of segments) {
      try {
        const result = await translateText(seg.text, 'auto', targetLang);
        results.push({ ...seg, translatedText: result.translated });
      } catch {
        results.push({ ...seg, translatedText: seg.text });
      }
    }
    return results;
  }
};
