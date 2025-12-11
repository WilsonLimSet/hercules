#!/usr/bin/env python3
"""Fetch YouTube transcript using youtube_transcript_api"""

import sys
import json
from youtube_transcript_api import YouTubeTranscriptApi

def get_transcript(video_id: str):
    try:
        api = YouTubeTranscriptApi()
        transcript = api.fetch(video_id)

        segments = []
        for entry in transcript:
            segments.append({
                "text": entry.text,
                "offset": int(entry.start * 1000),  # Convert to ms
                "duration": int(entry.duration * 1000)  # Convert to ms
            })

        return {"success": True, "segments": segments}
    except Exception as e:
        return {"success": False, "error": str(e)}

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "No video ID provided"}))
        sys.exit(1)

    video_id = sys.argv[1]
    result = get_transcript(video_id)
    print(json.dumps(result))
