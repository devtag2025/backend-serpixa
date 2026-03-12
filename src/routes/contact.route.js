import { Router } from 'express';
import { submitContactForm } from '../controllers/contact.controller.js';
import { validate } from '../middlewares/index.js';

const router = Router();

router.post('/', validate.submitContact, submitContactForm);

export default router;
