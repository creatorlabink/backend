import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';

function parseAdminEmails(): string[] {
  return (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction): void {
  const currentEmail = req.user?.email?.toLowerCase();
  if (!currentEmail) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const adminEmails = parseAdminEmails();

  if (adminEmails.length === 0) {
    if (process.env.NODE_ENV !== 'production') {
      next();
      return;
    }

    res.status(403).json({ error: 'Admin access is not configured.' });
    return;
  }

  if (!adminEmails.includes(currentEmail)) {
    res.status(403).json({ error: 'Forbidden: Admin access required.' });
    return;
  }

  next();
}
