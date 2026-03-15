import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  celebioConnectUrl,
  celebioDisconnect,
  celebioExchangeCode,
  celebioPublishEbook,
  celebioStatus,
} from '../controllers/celebioIntegrationController';
import {
  gumroadStatus,
  gumroadConnectUrl,
  gumroadExchangeCode,
  gumroadDisconnect,
  gumroadPublishEbook,
  convertkitStatus,
  convertkitConnectUrl,
  convertkitExchangeCode,
  convertkitDisconnect,
  convertkitSyncEbook,
  zapierStatus,
  zapierConnect,
  zapierDisconnect,
  zapierTest,
  zapierPublishEbook,
} from '../controllers/providerIntegrationsController';

const router = Router();

router.use(authenticate);

router.get('/celebio/status', celebioStatus);
router.get('/celebio/connect-url', celebioConnectUrl);
router.post('/celebio/exchange-code', celebioExchangeCode);
router.delete('/celebio/disconnect', celebioDisconnect);
router.post('/celebio/publish/:ebookId', celebioPublishEbook);

router.get('/gumroad/status', gumroadStatus);
router.get('/gumroad/connect-url', gumroadConnectUrl);
router.post('/gumroad/exchange-code', gumroadExchangeCode);
router.delete('/gumroad/disconnect', gumroadDisconnect);
router.post('/gumroad/publish/:ebookId', gumroadPublishEbook);

router.get('/convertkit/status', convertkitStatus);
router.get('/convertkit/connect-url', convertkitConnectUrl);
router.post('/convertkit/exchange-code', convertkitExchangeCode);
router.delete('/convertkit/disconnect', convertkitDisconnect);
router.post('/convertkit/sync/:ebookId', convertkitSyncEbook);

router.get('/zapier/status', zapierStatus);
router.post('/zapier/connect', zapierConnect);
router.delete('/zapier/disconnect', zapierDisconnect);
router.post('/zapier/test', zapierTest);
router.post('/zapier/publish/:ebookId', zapierPublishEbook);

export default router;
