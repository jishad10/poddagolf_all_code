import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import TranscribeController from './transcribe.controller';


// Store audio in a dedicated temp folder; deleted after Whisper call
const audioTempDir = path.resolve(process.cwd(), 'uploads', 'audio_temp');
if (!fs.existsSync(audioTempDir)) {
  fs.mkdirSync(audioTempDir, { recursive: true });
}

const audioStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, audioTempDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.webm';
    cb(null, `audio-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
  },
});

const audioUpload = multer({
  storage: audioStorage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB — Whisper's max
  fileFilter: (_req, file, cb) => {
    const allowed = ['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/ogg', 'audio/wav', 'video/webm'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported audio type: ${file.mimetype}`));
    }
  },
});

const router: Router = Router();


router.post('/', audioUpload.single('audio'), TranscribeController.transcribeAndSave);


export default router;
