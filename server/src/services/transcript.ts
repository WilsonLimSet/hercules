import { execSync } from 'child_process';
import path from 'path';

export interface TranscriptSegment {
  text: string;
  offset: number; // start time in ms
  duration: number; // duration in ms
}

export interface TranscriptChunk {
  chunkIndex: number;
  startTime: number; // seconds
  endTime: number; // seconds
  segments: TranscriptSegment[];
  fullText: string;
}

// Extract video ID from YouTube URL
export const extractVideoId = (url: string): string | null => {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
};

// Fetch transcript using Python script (more reliable than npm package)
export const fetchTranscript = async (videoUrl: string): Promise<TranscriptSegment[]> => {
  const videoId = extractVideoId(videoUrl);
  if (!videoId) {
    throw new Error('Invalid YouTube URL');
  }

  console.log(`[TRANSCRIPT] Fetching transcript for video: ${videoId}`);

  try {
    const scriptPath = path.join(__dirname, '../../scripts/get_transcript.py');
    const output = execSync(`python3 "${scriptPath}" "${videoId}"`, {
      encoding: 'utf-8',
      timeout: 30000,
    });

    const result = JSON.parse(output);

    if (!result.success) {
      throw new Error(result.error || 'Failed to fetch transcript');
    }

    console.log(`[TRANSCRIPT] Got ${result.segments.length} segments`);
    return result.segments;
  } catch (error) {
    console.error('[TRANSCRIPT] Failed to fetch:', error);
    throw new Error('Failed to fetch transcript. Video may not have captions.');
  }
};

// Split transcript into chunks by time
export const getTranscriptChunk = (
  segments: TranscriptSegment[],
  chunkIndex: number,
  chunkDuration: number // in seconds
): TranscriptChunk => {
  const startTime = chunkIndex * chunkDuration;
  const endTime = startTime + chunkDuration;
  const startMs = startTime * 1000;
  const endMs = endTime * 1000;

  // Filter segments that fall within this chunk
  const chunkSegments = segments.filter(seg => {
    const segEnd = seg.offset + seg.duration;
    return seg.offset < endMs && segEnd > startMs;
  });

  const fullText = chunkSegments.map(s => s.text).join(' ');

  return {
    chunkIndex,
    startTime,
    endTime,
    segments: chunkSegments,
    fullText,
  };
};
