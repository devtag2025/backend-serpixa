import { Router } from 'express';
import { auth, authorize } from '../middlewares/index.js';
import { USER_TYPES } from '../utils/enum.js';
import { locationController } from '../controllers/location.controller.js';

const router = Router();

// Protect this route: only authenticated admins can trigger a sync
router.use(auth);
router.use(authorize([USER_TYPES.ADMIN]));

// Single endpoint:
// POST /admin/locations/sync
// Body: { "countryIsoCode": "FR" }  or  { "countryIsoCode": "ALL" }
router.post('/sync', locationController.syncLocations);

export default router;

