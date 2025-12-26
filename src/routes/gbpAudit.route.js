import { Router } from 'express';
import { gbpAuditController } from '../controllers/index.js';
import { auth, validate, checkCredit } from '../middlewares/index.js';

const router = Router();

router.use(auth);

router.post('/', validate.runGBPAudit, checkCredit('gbp_audits'), gbpAuditController.runAudit);
router.get('/', gbpAuditController.getUserAudits);
router.get('/:auditId', validate.gbpAuditIdParam, gbpAuditController.getAuditById);
router.get('/:auditId/raw', validate.gbpAuditIdParam, gbpAuditController.getAuditWithRawData);
router.get('/:auditId/pdf', validate.gbpAuditIdParam, gbpAuditController.downloadAuditPDF);
router.delete('/:auditId', validate.gbpAuditIdParam, gbpAuditController.deleteAudit);

export default router;