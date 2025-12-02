import { Router } from 'express';
import { auth, validate } from '../middlewares/index.js';
import { seoAuditController } from '../controllers/seoAudit.controller.js';

const router = Router();

router.use(auth);

router.post('/', validate.runSEOAudit, seoAuditController.runAudit);
router.get('/', seoAuditController.getUserAudits);
router.get('/:auditId', validate.auditIdParam, seoAuditController.getAuditById);
router.get('/:auditId/raw', validate.auditIdParam, seoAuditController.getAuditWithRawData);
router.delete('/:auditId', validate.auditIdParam, seoAuditController.deleteAudit);

// PDF download/view - supports ?view=true to open in browser
router.get('/:auditId/pdf', validate.auditIdParam, seoAuditController.downloadAuditPDF);

export default router;