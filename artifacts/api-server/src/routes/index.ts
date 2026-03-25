import { Router, type IRouter } from "express";
import healthRouter from "./health";
import whaleRouter from "./whale";

const router: IRouter = Router();

router.use(healthRouter);
router.use(whaleRouter);

export default router;
