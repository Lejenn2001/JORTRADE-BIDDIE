import { Router, type IRouter } from "express";
import healthRouter from "./health";
import whaleRouter from "./whale";
import breakoutRouter from "./breakout";

const router: IRouter = Router();

router.use(healthRouter);
router.use(whaleRouter);
router.use(breakoutRouter);

export default router;
