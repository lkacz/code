// Shared readability rules for world-space character speech. Brief combat barks
// may be delivered in motion; anything longer becomes a readable stop-and-talk
// moment and remains visible twice as long as its previous/base duration.
const BRIEF_SPEECH_MAX_CHARS = 36;
const BRIEF_SPEECH_MAX_WORDS = 5;

function normalizeCharacterSpeech(text){
  return String(text || '').replace(/\s+/g,' ').trim();
}

function isBriefCharacterSpeech(text){
  const line = normalizeCharacterSpeech(text);
  if(!line) return true;
  const words = line.split(' ').filter(Boolean).length;
  return line.length <= BRIEF_SPEECH_MAX_CHARS && words <= BRIEF_SPEECH_MAX_WORDS;
}

function isLongCharacterSpeech(text){
  return !isBriefCharacterSpeech(text);
}

function readableCharacterSpeechDuration(baseDuration,text){
  const base = Math.max(0,Number(baseDuration) || 0);
  return isLongCharacterSpeech(text) ? base * 2 : base;
}

export {
  BRIEF_SPEECH_MAX_CHARS,
  BRIEF_SPEECH_MAX_WORDS,
  isBriefCharacterSpeech,
  isLongCharacterSpeech,
  normalizeCharacterSpeech,
  readableCharacterSpeechDuration
};
