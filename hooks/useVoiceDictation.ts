/**
 * useVoiceDictation hook — inserts voice transcript into a text field.
 * QNBS-v3: Watches Redux voice transcript and appends to controlled content.
 */

import { useEffect, useRef } from 'react';
import { useAppSelector } from '../app/hooks';
import { selectDictationActive, selectVoiceTranscript } from '../features/voice/voiceSlice';

export const useVoiceDictation = (
  getContent: () => string,
  setContent: (content: string) => void,
) => {
  const dictationActive = useAppSelector(selectDictationActive);
  const transcript = useAppSelector(selectVoiceTranscript);
  const lastTranscriptRef = useRef(transcript);

  useEffect(() => {
    if (!dictationActive) {
      lastTranscriptRef.current = '';
      return;
    }

    // When transcript grows, append the new portion
    const current = transcript;
    const last = lastTranscriptRef.current;
    lastTranscriptRef.current = current;
    // QNBS-v3 (#556): appendVoiceTranscript already joins results with a space; trim it so the text gets one.
    const added = current.length > last.length ? current.slice(last.length).trimStart() : '';
    if (!added) return;
    const prefix = getContent();
    const separator =
      prefix.length > 0 && !prefix.endsWith(' ') && !prefix.endsWith('\n') ? ' ' : '';
    setContent(prefix + separator + added);
  }, [dictationActive, transcript, getContent, setContent]);
};
