import { Request, Response } from 'express';
import catchAsync from '../../lib/catchAsync';
import { generateResponse } from '../../lib/responseFormate';
import ShotService from './shot.service';


const saveShot = catchAsync(async (req: Request, res: Response) => {
  const { rawText, sessionId, holePar } = req.body;

  if (!rawText || typeof rawText !== 'string' || rawText.trim().length === 0) {
    return generateResponse(res, 400, false, 'rawText is required');
  }

  if (sessionId !== undefined && typeof sessionId !== 'string') {
    return generateResponse(res, 400, false, 'sessionId must be a string');
  }

  const parsedPar = holePar !== undefined ? Number(holePar) : undefined;
  if (parsedPar !== undefined && (isNaN(parsedPar) || parsedPar < 1 || parsedPar > 5)) {
    return generateResponse(res, 400, false, 'holePar must be a number between 1 and 5');
  }

  // Build options without undefined properties — required by exactOptionalPropertyTypes
  const shotOptions = {
    ...(typeof sessionId === 'string' && { sessionId }),
    ...(parsedPar !== undefined && { holePar: parsedPar }),
  };

  const shot = await ShotService.saveShot(rawText.trim(), shotOptions);

  return generateResponse(res, 201, true, 'Shot saved successfully', shot);
});


const getAllShots = catchAsync(async (req: Request, res: Response) => {
  const shots = await ShotService.getAllShots();
  return generateResponse(res, 200, true, 'Shots fetched successfully', shots);
});


const getShotsBySession = catchAsync(async (req: Request, res: Response) => {
  const { sessionId } = req.params;

  if (!sessionId) {
    return generateResponse(res, 400, false, 'sessionId is required');
  }

  const shots = await ShotService.getShotsBySession(sessionId);
  return generateResponse(res, 200, true, 'Session shots fetched', shots);
});


const deleteShot = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;

  if (!id) {
    return generateResponse(res, 400, false, 'Shot id is required');
  }

  const deleted = await ShotService.deleteShot(id);

  if (!deleted) {
    return generateResponse(res, 404, false, 'Shot not found');
  }

  return generateResponse(res, 200, true, 'Shot deleted successfully');
});


const getRoundShots = catchAsync(async (req: Request, res: Response) => {
  const { roundId } = req.params;

  if (!roundId) {
    return generateResponse(res, 400, false, 'roundId is required');
  }

  const data = await ShotService.getShotsByRound(roundId);
  return generateResponse(res, 200, true, 'Round shots fetched', data);
});


const deleteSessionShots = catchAsync(async (req: Request, res: Response) => {
  const { sessionId } = req.params;

  if (!sessionId) {
    return generateResponse(res, 400, false, 'sessionId is required');
  }

  const deletedCount = await ShotService.deleteSessionShots(sessionId);
  return generateResponse(res, 200, true, `${deletedCount} shots deleted`, { deletedCount });
});


export default {
  saveShot,
  getAllShots,
  getShotsBySession,
  deleteShot,
  getRoundShots,
  deleteSessionShots,  
}; 