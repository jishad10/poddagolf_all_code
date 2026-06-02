import { Router } from "express";
import shotRoutes from "../../entities/shot/shot.routes";
import transcribeRoutes from "../../entities/transcribe/transcribe.routes";


const router: Router = Router();


router.use("/v1/shots", shotRoutes);
router.use("/v1/transcribe", transcribeRoutes);


export default router;