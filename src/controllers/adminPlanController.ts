import { Request, Response } from 'express';
import pool from '../config/db';

const VALID_PLANS = new Set(['free', 'lifetime', 'annual']);

export const listUsers = async (req: Request, res: Response): Promise<void> => {
  const search = ((req.query.search as string) || '').trim();
  const limit = Math.min(Number(req.query.limit) || 25, 100);

  try {
    let result;

    if (search) {
      result = await pool.query(
        `SELECT id, email, name, plan, created_at, updated_at
         FROM users
         WHERE email ILIKE $1 OR name ILIKE $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [`%${search}%`, limit]
      );
    } else {
      result = await pool.query(
        `SELECT id, email, name, plan, created_at, updated_at
         FROM users
         ORDER BY created_at DESC
         LIMIT $1`,
        [limit]
      );
    }

    res.json({ users: result.rows });
  } catch (err) {
    console.error('listUsers error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const updateUserPlan = async (req: Request, res: Response): Promise<void> => {
  const { userId } = req.params;
  const plan = String((req.body as { plan?: string })?.plan || '').toLowerCase();

  if (!VALID_PLANS.has(plan)) {
    res.status(400).json({ error: 'Invalid plan. Allowed: free, lifetime, annual' });
    return;
  }

  try {
    const result = await pool.query(
      `UPDATE users
       SET plan = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, email, name, plan, created_at, updated_at`,
      [plan, userId]
    );

    if (!result.rows.length) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error('updateUserPlan error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};
