import { Router } from 'express';
import { auth, validate, checkCredit } from '../middlewares/index.js';
import { geoAuditController } from '../controllers/geoAudit.controller.js';

const router = Router();

router.use(auth);

router.post('/', validate.runGeoAudit, checkCredit('geo_audits'), geoAuditController.runAudit);
router.get('/', geoAuditController.getUserAudits);
router.get('/:auditId', validate.auditIdParam, geoAuditController.getAuditById);
router.get('/:auditId/raw', validate.auditIdParam, geoAuditController.getAuditWithRawData);
router.delete('/:auditId', validate.auditIdParam, geoAuditController.deleteAudit);

// PDF download/view - supports ?view=true to open in browser
router.get('/:auditId/pdf', validate.auditIdParam, geoAuditController.downloadAuditPDF);

export default router;


