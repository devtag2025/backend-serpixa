import { Router } from 'express';
import { supportController } from '../controllers/index.js';
import { auth, validate } from '../middlewares/index.js';

const router = Router();

router.post('/', auth, validate.submitSupportRequest, supportController.submitSupportRequest);

export default router;
