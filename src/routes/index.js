import { Router } from 'express';
import authRoutes from './auth.route.js';
import claudeRoutes from './claude.route.js';

const router = Router();

router.use('/auth', authRoutes);
router.use('/claude', claudeRoutes);

export default router;
