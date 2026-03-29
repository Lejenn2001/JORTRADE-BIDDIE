import { Router, type IRouter } from "express";
import healthRouter from "./health";
import whaleRouter from "./whale";
import breakoutRouter from "./breakout";
import alertsRouter from "./alerts";

const router: IRouter = Router();

router.use(healthRouter);
router.use(whaleRouter);
router.use(breakoutRouter);
router.use(alertsRouter);

export default router;
