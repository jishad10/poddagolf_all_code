import { Router } from 'express';
import shotController from './shot.controller';

const router: Router = Router();

// Save a new shot (text already transcribed, or raw text)
router.post('/', shotController.saveShot);

// Get all shots
router.get('/', shotController.getAllShots);

// Get shots + hole summary for a specific round
router.get('/round/:roundId', shotController.getRoundShots);

// Get shots for a specific session
router.get('/session/:sessionId', shotController.getShotsBySession);

// Delete all shots belonging to a session (was in service but had no route)
router.delete('/session/:sessionId', shotController.deleteSessionShots);

// Delete a single shot by ID
router.delete('/:id', shotController.deleteShot);

export default router;