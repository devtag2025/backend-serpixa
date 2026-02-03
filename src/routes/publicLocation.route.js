import { Router } from 'express';
import { auth } from '../middlewares/index.js';
import { locationController } from '../controllers/location.controller.js';

const router = Router();

// Authenticated users can query locations for Geo Audit form
router.use(auth);

// GET /locations?country=France&search=paris&limit=20
router.get('/', locationController.getLocations);

export default router;

