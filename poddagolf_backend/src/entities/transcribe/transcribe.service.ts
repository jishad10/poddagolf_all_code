import fs from 'fs';
import FormData from 'form-data';
import fetch from 'node-fetch';
import config from '../../core/config/config';

/**
 * Sends an audio buffer to OpenAI Whisper and returns the transcript.
 */

export async function transcribeAudio(filePath: string, mimeType: string): Promise<string> {
  const apiKey = config.openAiApiKey;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set in environment variables');
  }

  const form = new FormData();
  form.append('file', fs.createReadStream(filePath), {
    contentType: mimeType,
    filename: 'recording.webm', // Whisper accepts any supported extension
  });
  form.append('model', 'whisper-1');
  form.append('response_format', 'text');

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...form.getHeaders(),
    },
    body: form,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Whisper API error (${response.status}): ${errorText}`);
  }

  // response_format=text returns a plain string
  const transcript = await response.text();
  return transcript.trim();
}
