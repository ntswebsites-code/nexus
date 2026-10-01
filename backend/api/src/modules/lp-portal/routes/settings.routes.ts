import { Router } from 'express';
import { requireLp } from '../lp.context';
import { lpStubNotLive } from '../lp.http';

/** Domain `settings` (WS1). */
export const lpSettingsRoutes = Router();

lpSettingsRoutes.get('/settings', requireLp('lp.settings.view'), lpStubNotLive);
lpSettingsRoutes.get('/settings/mfa', requireLp('lp.settings.view'), lpStubNotLive);
lpSettingsRoutes.patch('/settings/notifications', requireLp('lp.settings.view'), lpStubNotLive);
lpSettingsRoutes.patch('/settings/display', requireLp('lp.settings.view'), lpStubNotLive);
