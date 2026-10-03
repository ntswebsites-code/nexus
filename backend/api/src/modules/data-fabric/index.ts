import { Router } from 'express';
import { dataRoutes as baseRoutes } from './data.routes';
import { dataEnforceRoutes } from './data.enforce.routes';

/** `/api/v1/data`: the core routes, then the scheduling, exception-queue and lineage routes (R4-9). */
export const dataRoutes = Router();
dataRoutes.use(baseRoutes);
dataRoutes.use(dataEnforceRoutes);
export { DATASETS, DATASET_MAP, compile, validateRule } from './data.engine';
export { dqTick, runDueSchedules, escalateExceptions, nextDqRun } from './data.schedule';
