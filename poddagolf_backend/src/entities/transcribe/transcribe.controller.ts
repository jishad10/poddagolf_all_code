import fs from 'fs';
import { Request, Response } from 'express';
import catchAsync from '../../lib/catchAsync';
import { generateResponse } from '../../lib/responseFormate';
import ShotService from '../shot/shot.service';
import { transcribeAudio } from './transcribe.service';


// Multipart form-data: audio file in field "audio", optional "sessionId" text field
const transcribeAndSave = catchAsync(async (req: Request, res: Response) => {
  const file = req.file as Express.Multer.File | undefined;

  if (!file) {
    return generateResponse(res, 400, false, 'Audio file is required. Use field name "audio".');
  }

  const sessionId: string | undefined = req.body?.sessionId;
  const mimeType: string = file.mimetype || 'audio/webm';

  let rawText: string;

  try {
    rawText = await transcribeAudio(file.path, mimeType);
  } finally {
    // Always clean up the temp file
    fs.unlink(file.path, () => {});
  }

  if (!rawText || rawText.trim().length === 0) {
    return generateResponse(res, 422, false, 'Whisper returned an empty transcription. Please try again.');
  }

  // Extract club/distance/direction and save to DB
  const shot = await ShotService.saveShot(rawText, sessionId);

  return generateResponse(res, 201, true, 'Shot transcribed and saved', {
    transcript: rawText,
    shot,
  });
});


export default { transcribeAndSave };
