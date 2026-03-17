/**
 * Admin Dashboard Controller – World-class admin capabilities
 * Provides comprehensive metrics, user management, revenue tracking, and analytics
 */
import { Request, Response } from 'express';
import pool from '../config/db';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { signToken } from '../utils/jwtUtils';

// ============================================================================
// DASHBOARD OVERVIEW - Real-time metrics
// ============================================================================

export const getDashboardStats = async (req: Request, res: Response): Promise<void> => {
  try {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const thisWeek = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const [
      totalUsers,
      newUsersToday,
      newUsersThisWeek,
      newUsersThisMonth,
      totalEbooks,
      ebooksThisWeek,
      totalRevenue,
      revenueThisMonth,
      revenueLastMonth,
      planBreakdown,
      activeUsers7d,
      conversionStats,
      topTemplates,
      recentPayments,
    ] = await Promise.all([
      // Total users
      pool.query('SELECT COUNT(*)::int AS count FROM users'),
      // New users today
      pool.query('SELECT COUNT(*)::int AS count FROM users WHERE created_at >= $1', [today]),
      // New users this week
      pool.query('SELECT COUNT(*)::int AS count FROM users WHERE created_at >= $1', [thisWeek]),
      // New users this month
      pool.query('SELECT COUNT(*)::int AS count FROM users WHERE created_at >= $1', [thisMonth]),
      // Total ebooks
      pool.query('SELECT COUNT(*)::int AS count FROM ebooks'),
      // Ebooks this week
      pool.query('SELECT COUNT(*)::int AS count FROM ebooks WHERE created_at >= $1', [thisWeek]),
      // Total revenue (completed payments)
      pool.query(`SELECT COALESCE(SUM(amount), 0)::int AS total FROM payments WHERE status = 'completed'`),
      // Revenue this month
      pool.query(`SELECT COALESCE(SUM(amount), 0)::int AS total FROM payments WHERE status = 'completed' AND created_at >= $1`, [thisMonth]),
      // Revenue last month
      pool.query(`SELECT COALESCE(SUM(amount), 0)::int AS total FROM payments WHERE status = 'completed' AND created_at >= $1 AND created_at < $2`, [lastMonth, thisMonth]),
      // Plan breakdown
      pool.query(`SELECT plan, COUNT(*)::int AS count FROM users GROUP BY plan ORDER BY count DESC`),
      // Active users (users with ebooks or events in 7 days)
      pool.query(`
        SELECT COUNT(DISTINCT user_id)::int AS count 
        FROM (
          SELECT user_id FROM ebooks WHERE updated_at >= $1
          UNION 
          SELECT user_id FROM analytics_events WHERE created_at >= $1 AND user_id IS NOT NULL
        ) active
      `, [thisWeek]),
      // Conversion stats
      pool.query(`
        SELECT 
          COUNT(*)::int AS total_users,
          COUNT(*) FILTER (WHERE plan != 'free')::int AS paid_users,
          COUNT(*) FILTER (WHERE plan = 'lifetime')::int AS lifetime_users,
          COUNT(*) FILTER (WHERE plan = 'annual')::int AS annual_users
        FROM users
      `),
      // Top templates
      pool.query(`
        SELECT template, COUNT(*)::int AS usage_count
        FROM ebooks
        GROUP BY template
        ORDER BY usage_count DESC
        LIMIT 5
      `),
      // Recent payments (last 10)
      pool.query(`
        SELECT p.*, u.email, u.name
        FROM payments p
        JOIN users u ON p.user_id = u.id
        ORDER BY p.created_at DESC
        LIMIT 10
      `),
    ]);

    const totalRevenueAmount = totalRevenue.rows[0]?.total ?? 0;
    const revenueThisMonthAmount = revenueThisMonth.rows[0]?.total ?? 0;
    const revenueLastMonthAmount = revenueLastMonth.rows[0]?.total ?? 0;
    const revenueGrowth = revenueLastMonthAmount > 0 
      ? ((revenueThisMonthAmount - revenueLastMonthAmount) / revenueLastMonthAmount * 100).toFixed(1)
      : revenueThisMonthAmount > 0 ? '100' : '0';

    const convStats = conversionStats.rows[0] || {};
    const conversionRate = convStats.total_users > 0 
      ? ((convStats.paid_users / convStats.total_users) * 100).toFixed(2)
      : '0';

    res.json({
      overview: {
        totalUsers: totalUsers.rows[0]?.count ?? 0,
        newUsersToday: newUsersToday.rows[0]?.count ?? 0,
        newUsersThisWeek: newUsersThisWeek.rows[0]?.count ?? 0,
        newUsersThisMonth: newUsersThisMonth.rows[0]?.count ?? 0,
        totalEbooks: totalEbooks.rows[0]?.count ?? 0,
        ebooksThisWeek: ebooksThisWeek.rows[0]?.count ?? 0,
        activeUsers7d: activeUsers7d.rows[0]?.count ?? 0,
      },
      revenue: {
        totalRevenueCents: totalRevenueAmount,
        totalRevenueFormatted: `$${(totalRevenueAmount / 100).toFixed(2)}`,
        thisMonthCents: revenueThisMonthAmount,
        thisMonthFormatted: `$${(revenueThisMonthAmount / 100).toFixed(2)}`,
        lastMonthCents: revenueLastMonthAmount,
        growthPercent: parseFloat(revenueGrowth),
      },
      conversion: {
        totalUsers: convStats.total_users ?? 0,
        paidUsers: convStats.paid_users ?? 0,
        lifetimeUsers: convStats.lifetime_users ?? 0,
        annualUsers: convStats.annual_users ?? 0,
        conversionRatePercent: parseFloat(conversionRate),
      },
      planBreakdown: planBreakdown.rows,
      topTemplates: topTemplates.rows,
      recentPayments: recentPayments.rows.map((p: Record<string, unknown>) => ({
        id: p.id,
        userEmail: p.email,
        userName: p.name,
        amount: p.amount,
        amountFormatted: `$${((p.amount as number) / 100).toFixed(2)}`,
        currency: p.currency,
        status: p.status,
        createdAt: p.created_at,
      })),
    });
  } catch (err) {
    console.error('getDashboardStats error:', err);
    res.status(500).json({ error: 'Failed to fetch dashboard stats' });
  }
};

// ============================================================================
// USER MANAGEMENT
// ============================================================================

export const getAllUsers = async (req: Request, res: Response): Promise<void> => {
  try {
    const search = ((req.query.search as string) || '').trim();
    const plan = req.query.plan as string;
    const sortBy = (req.query.sortBy as string) || 'created_at';
    const sortOrder = ((req.query.sortOrder as string) || 'desc').toUpperCase();
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 25));
    const offset = (page - 1) * limit;

    const validSortColumns = ['created_at', 'updated_at', 'email', 'name', 'plan'];
    const sortColumn = validSortColumns.includes(sortBy) ? sortBy : 'created_at';
    const sortDir = sortOrder === 'ASC' ? 'ASC' : 'DESC';

    let whereClause = 'WHERE 1=1';
    const params: (string | number)[] = [];
    let paramIdx = 1;

    if (search) {
      whereClause += ` AND (email ILIKE $${paramIdx} OR name ILIKE $${paramIdx})`;
      params.push(`%${search}%`);
      paramIdx++;
    }

    if (plan && ['free', 'lifetime', 'annual'].includes(plan)) {
      whereClause += ` AND plan = $${paramIdx}`;
      params.push(plan);
      paramIdx++;
    }

    const countQuery = `SELECT COUNT(*)::int AS total FROM users ${whereClause}`;
    const countResult = await pool.query(countQuery, params);
    const totalCount = countResult.rows[0]?.total ?? 0;

    const usersQuery = `
      SELECT 
        u.id, u.email, u.name, u.plan, u.created_at, u.updated_at,
        (SELECT COUNT(*)::int FROM ebooks WHERE user_id = u.id) AS ebook_count,
        (SELECT COUNT(*)::int FROM payments WHERE user_id = u.id AND status = 'completed') AS payment_count,
        (SELECT COALESCE(SUM(amount), 0)::int FROM payments WHERE user_id = u.id AND status = 'completed') AS total_spent
      FROM users u
      ${whereClause}
      ORDER BY ${sortColumn} ${sortDir}
      LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
    `;
    params.push(limit, offset);

    const usersResult = await pool.query(usersQuery, params);

    res.json({
      users: usersResult.rows.map((u: Record<string, unknown>) => ({
        ...u,
        totalSpentFormatted: `$${((u.total_spent as number) / 100).toFixed(2)}`,
      })),
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
        hasMore: page * limit < totalCount,
      },
    });
  } catch (err) {
    console.error('getAllUsers error:', err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
};

export const getUserDetails = async (req: Request, res: Response): Promise<void> => {
  const { userId } = req.params;

  try {
    const [user, ebooks, payments, events, socialIdentities, auditLogs] = await Promise.all([
      // User info
      pool.query(`
        SELECT id, email, name, plan, created_at, updated_at
        FROM users WHERE id = $1
      `, [userId]),
      // User's ebooks
      pool.query(`
        SELECT id, title, template, status, created_at, updated_at
        FROM ebooks 
        WHERE user_id = $1 
        ORDER BY updated_at DESC
        LIMIT 20
      `, [userId]),
      // User's payments
      pool.query(`
        SELECT id, stripe_session_id, amount, currency, status, created_at
        FROM payments 
        WHERE user_id = $1 
        ORDER BY created_at DESC
        LIMIT 20
      `, [userId]),
      // User's analytics events (recent 50)
      pool.query(`
        SELECT id, event_name, ebook_id, template, source, created_at
        FROM analytics_events 
        WHERE user_id = $1 
        ORDER BY created_at DESC
        LIMIT 50
      `, [userId]),
      // Social identities
      pool.query(`
        SELECT provider, provider_user_id, email, created_at
        FROM social_identities
        WHERE user_id = $1
      `, [userId]),
      // Audit logs related to this user
      pool.query(`
        SELECT id, actor_email, action, payload_json, created_at
        FROM admin_audit_logs
        WHERE target_id = $1
        ORDER BY created_at DESC
        LIMIT 20
      `, [userId]),
    ]);

    if (!user.rows.length) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const totalSpent = payments.rows.reduce(
      (sum: number, p: Record<string, unknown>) => sum + ((p.amount as number) || 0),
      0
    );

    res.json({
      user: user.rows[0],
      ebooks: ebooks.rows,
      payments: payments.rows.map((p: Record<string, unknown>) => ({
        ...p,
        amountFormatted: `$${((p.amount as number) / 100).toFixed(2)}`,
      })),
      totalSpentCents: totalSpent,
      totalSpentFormatted: `$${(totalSpent / 100).toFixed(2)}`,
      events: events.rows,
      socialIdentities: socialIdentities.rows,
      auditLogs: auditLogs.rows,
      stats: {
        ebookCount: ebooks.rows.length,
        paymentCount: payments.rows.length,
        eventCount: events.rows.length,
      },
    });
  } catch (err) {
    console.error('getUserDetails error:', err);
    res.status(500).json({ error: 'Failed to fetch user details' });
  }
};

export const updateUser = async (req: Request, res: Response): Promise<void> => {
  const { userId } = req.params;
  const { name, email, plan } = req.body as { name?: string; email?: string; plan?: string };
  const adminEmail = (req as unknown as { user?: { email?: string } }).user?.email || 'unknown';

  try {
    const updates: string[] = [];
    const params: (string | number)[] = [];
    let paramIdx = 1;

    if (name !== undefined) {
      updates.push(`name = $${paramIdx}`);
      params.push(name);
      paramIdx++;
    }

    if (email !== undefined) {
      updates.push(`email = $${paramIdx}`);
      params.push(email.toLowerCase().trim());
      paramIdx++;
    }

    if (plan !== undefined && ['free', 'lifetime', 'annual'].includes(plan)) {
      updates.push(`plan = $${paramIdx}`);
      params.push(plan);
      paramIdx++;
    }

    if (updates.length === 0) {
      res.status(400).json({ error: 'No valid fields to update' });
      return;
    }

    updates.push('updated_at = NOW()');
    params.push(String(userId));

    const query = `
      UPDATE users 
      SET ${updates.join(', ')}
      WHERE id = $${paramIdx}
      RETURNING id, email, name, plan, created_at, updated_at
    `;

    const result = await pool.query(query, params);

    if (!result.rows.length) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Audit log
    await pool.query(`
      INSERT INTO admin_audit_logs (actor_email, action, target_table, target_id, payload_json)
      VALUES ($1, 'user_updated', 'users', $2, $3)
    `, [adminEmail, userId, JSON.stringify({ name, email, plan })]);

    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error('updateUser error:', err);
    res.status(500).json({ error: 'Failed to update user' });
  }
};

export const deleteUser = async (req: Request, res: Response): Promise<void> => {
  const { userId } = req.params;
  const adminEmail = (req as unknown as { user?: { email?: string } }).user?.email || 'unknown';

  try {
    // Get user info for audit log
    const userResult = await pool.query('SELECT email, name FROM users WHERE id = $1', [userId]);
    if (!userResult.rows.length) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const deletedUser = userResult.rows[0];

    // Delete user (cascades to ebooks, payments, etc.)
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);

    // Audit log
    await pool.query(`
      INSERT INTO admin_audit_logs (actor_email, action, target_table, target_id, payload_json)
      VALUES ($1, 'user_deleted', 'users', $2, $3)
    `, [adminEmail, userId, JSON.stringify(deletedUser)]);

    res.json({ success: true, message: `User ${deletedUser.email} deleted` });
  } catch (err) {
    console.error('deleteUser error:', err);
    res.status(500).json({ error: 'Failed to delete user' });
  }
};

export const resetUserPassword = async (req: Request, res: Response): Promise<void> => {
  const { userId } = req.params;
  const { newPassword } = req.body as { newPassword?: string };
  const adminEmail = (req as unknown as { user?: { email?: string } }).user?.email || 'unknown';

  try {
    if (!newPassword || newPassword.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters' });
      return;
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);

    const result = await pool.query(`
      UPDATE users SET password_hash = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING id, email
    `, [passwordHash, userId]);

    if (!result.rows.length) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Audit log
    await pool.query(`
      INSERT INTO admin_audit_logs (actor_email, action, target_table, target_id, payload_json)
      VALUES ($1, 'password_reset_by_admin', 'users', $2, $3)
    `, [adminEmail, userId, JSON.stringify({ userEmail: result.rows[0].email })]);

    res.json({ success: true, message: 'Password reset successfully' });
  } catch (err) {
    console.error('resetUserPassword error:', err);
    res.status(500).json({ error: 'Failed to reset password' });
  }
};

export const impersonateUser = async (req: Request, res: Response): Promise<void> => {
  const userId = String(req.params.userId);
  const adminEmail = (req as unknown as { user?: { email?: string } }).user?.email || 'unknown';

  try {
    const result = await pool.query('SELECT id, email, name, plan FROM users WHERE id = $1', [userId]);
    
    if (!result.rows.length) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const user = result.rows[0];
    const token = signToken({ userId: user.id, email: user.email, impersonatedBy: adminEmail });

    // Audit log
    await pool.query(`
      INSERT INTO admin_audit_logs (actor_email, action, target_table, target_id, payload_json)
      VALUES ($1, 'user_impersonation', 'users', $2, $3)
    `, [adminEmail, userId, JSON.stringify({ userEmail: user.email })]);

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        plan: user.plan,
      },
      message: `Impersonating ${user.email}`,
    });
  } catch (err) {
    console.error('impersonateUser error:', err);
    res.status(500).json({ error: 'Failed to impersonate user' });
  }
};

// ============================================================================
// REVENUE & BILLING
// ============================================================================

export const getRevenueStats = async (req: Request, res: Response): Promise<void> => {
  try {
    const now = new Date();
    const months = [];
    
    // Get last 12 months data
    for (let i = 11; i >= 0; i--) {
      const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      months.push({ start: monthStart, end: monthEnd, label: monthStart.toLocaleString('default', { month: 'short', year: '2-digit' }) });
    }

    const monthlyRevenuePromises = months.map(m => 
      pool.query(`
        SELECT 
          COUNT(*)::int AS transaction_count,
          COALESCE(SUM(amount), 0)::int AS revenue
        FROM payments 
        WHERE status = 'completed' AND created_at >= $1 AND created_at < $2
      `, [m.start, m.end])
    );

    const monthlyResults = await Promise.all(monthlyRevenuePromises);

    const [
      totalRevenue,
      avgTransactionValue,
      refundStats,
      recentTransactions,
      topCustomers,
    ] = await Promise.all([
      pool.query(`SELECT COALESCE(SUM(amount), 0)::int AS total FROM payments WHERE status = 'completed'`),
      pool.query(`SELECT COALESCE(AVG(amount), 0)::int AS avg FROM payments WHERE status = 'completed'`),
      pool.query(`SELECT COUNT(*)::int AS count, COALESCE(SUM(amount), 0)::int AS total FROM payments WHERE status = 'refunded'`),
      pool.query(`
        SELECT p.*, u.email, u.name
        FROM payments p
        JOIN users u ON p.user_id = u.id
        ORDER BY p.created_at DESC
        LIMIT 50
      `),
      pool.query(`
        SELECT u.id, u.email, u.name, 
          COUNT(p.id)::int AS transaction_count,
          COALESCE(SUM(p.amount), 0)::int AS total_spent
        FROM users u
        JOIN payments p ON u.id = p.user_id AND p.status = 'completed'
        GROUP BY u.id
        ORDER BY total_spent DESC
        LIMIT 10
      `),
    ]);

    res.json({
      totals: {
        totalRevenueCents: totalRevenue.rows[0]?.total ?? 0,
        totalRevenueFormatted: `$${((totalRevenue.rows[0]?.total ?? 0) / 100).toFixed(2)}`,
        avgTransactionCents: avgTransactionValue.rows[0]?.avg ?? 0,
        avgTransactionFormatted: `$${((avgTransactionValue.rows[0]?.avg ?? 0) / 100).toFixed(2)}`,
        refundCount: refundStats.rows[0]?.count ?? 0,
        refundTotalCents: refundStats.rows[0]?.total ?? 0,
        refundTotalFormatted: `$${((refundStats.rows[0]?.total ?? 0) / 100).toFixed(2)}`,
      },
      monthly: months.map((m, idx) => ({
        month: m.label,
        revenueCents: monthlyResults[idx].rows[0]?.revenue ?? 0,
        revenueFormatted: `$${((monthlyResults[idx].rows[0]?.revenue ?? 0) / 100).toFixed(2)}`,
        transactionCount: monthlyResults[idx].rows[0]?.transaction_count ?? 0,
      })),
      recentTransactions: recentTransactions.rows.map((p: Record<string, unknown>) => ({
        id: p.id,
        userEmail: p.email,
        userName: p.name,
        userId: p.user_id,
        stripeSessionId: p.stripe_session_id,
        amount: p.amount,
        amountFormatted: `$${((p.amount as number) / 100).toFixed(2)}`,
        currency: p.currency,
        status: p.status,
        createdAt: p.created_at,
      })),
      topCustomers: topCustomers.rows.map((c: Record<string, unknown>) => ({
        id: c.id,
        email: c.email,
        name: c.name,
        transactionCount: c.transaction_count,
        totalSpentCents: c.total_spent,
        totalSpentFormatted: `$${((c.total_spent as number) / 100).toFixed(2)}`,
      })),
    });
  } catch (err) {
    console.error('getRevenueStats error:', err);
    res.status(500).json({ error: 'Failed to fetch revenue stats' });
  }
};

// ============================================================================
// ANALYTICS
// ============================================================================

export const getAnalyticsDashboard = async (req: Request, res: Response): Promise<void> => {
  try {
    const now = new Date();
    const last7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const last30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [
      eventCounts,
      dailySignups,
      funnelStats,
      templateUsage,
      aiUsageStats,
      topEvents,
      eventsByDay,
    ] = await Promise.all([
      // Event counts
      pool.query(`
        SELECT 
          COUNT(*)::int AS total_events,
          COUNT(*) FILTER (WHERE created_at >= $1)::int AS events_7d,
          COUNT(*) FILTER (WHERE created_at >= $2)::int AS events_30d
        FROM analytics_events
      `, [last7Days, last30Days]),
      // Daily signups (last 30 days)
      pool.query(`
        SELECT DATE(created_at) AS date, COUNT(*)::int AS signups
        FROM users
        WHERE created_at >= $1
        GROUP BY DATE(created_at)
        ORDER BY date
      `, [last30Days]),
      // Funnel stats
      pool.query(`
        SELECT 
          COUNT(*) FILTER (WHERE event_name = 'page_view')::int AS page_views,
          COUNT(*) FILTER (WHERE event_name = 'cta_click')::int AS cta_clicks,
          COUNT(*) FILTER (WHERE event_name = 'signup')::int AS signups,
          COUNT(*) FILTER (WHERE event_name = 'ebook_created')::int AS ebook_created,
          COUNT(*) FILTER (WHERE event_name = 'pdf_download')::int AS downloads,
          COUNT(*) FILTER (WHERE event_name = 'payment_completed')::int AS payments
        FROM analytics_events
      `),
      // Template usage
      pool.query(`
        SELECT template, COUNT(*)::int AS count
        FROM ebooks
        GROUP BY template
        ORDER BY count DESC
      `),
      // AI usage stats
      pool.query(`
        SELECT 
          COUNT(*) FILTER (WHERE (formatted_json->>'ai_applied')::boolean = true)::int AS ai_used,
          COUNT(*) FILTER (WHERE (formatted_json->>'ai_applied')::boolean = false OR formatted_json->>'ai_applied' IS NULL)::int AS manual
        FROM ebooks
      `),
      // Top events by count
      pool.query(`
        SELECT event_name, COUNT(*)::int AS count
        FROM analytics_events
        GROUP BY event_name
        ORDER BY count DESC
        LIMIT 10
      `),
      // Events by day (last 14 days)
      pool.query(`
        SELECT DATE(created_at) AS date, COUNT(*)::int AS event_count
        FROM analytics_events
        WHERE created_at >= $1
        GROUP BY DATE(created_at)
        ORDER BY date
      `, [new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)]),
    ]);

    const funnel = funnelStats.rows[0] || {};

    res.json({
      eventCounts: eventCounts.rows[0],
      funnel: {
        pageViews: funnel.page_views ?? 0,
        ctaClicks: funnel.cta_clicks ?? 0,
        signups: funnel.signups ?? 0,
        ebookCreated: funnel.ebook_created ?? 0,
        downloads: funnel.downloads ?? 0,
        payments: funnel.payments ?? 0,
        ctaToSignupRate: funnel.cta_clicks > 0 ? ((funnel.signups / funnel.cta_clicks) * 100).toFixed(2) : 0,
        signupToEbookRate: funnel.signups > 0 ? ((funnel.ebook_created / funnel.signups) * 100).toFixed(2) : 0,
        signupToPaymentRate: funnel.signups > 0 ? ((funnel.payments / funnel.signups) * 100).toFixed(2) : 0,
      },
      dailySignups: dailySignups.rows,
      templateUsage: templateUsage.rows,
      aiUsage: aiUsageStats.rows[0],
      topEvents: topEvents.rows,
      eventsByDay: eventsByDay.rows,
    });
  } catch (err) {
    console.error('getAnalyticsDashboard error:', err);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
};

// ============================================================================
// EBOOK MANAGEMENT
// ============================================================================

export const getAllEbooks = async (req: Request, res: Response): Promise<void> => {
  try {
    const search = ((req.query.search as string) || '').trim();
    const template = req.query.template as string;
    const status = req.query.status as string;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 25));
    const offset = (page - 1) * limit;

    let whereClause = 'WHERE 1=1';
    const params: (string | number)[] = [];
    let paramIdx = 1;

    if (search) {
      whereClause += ` AND (e.title ILIKE $${paramIdx} OR u.email ILIKE $${paramIdx})`;
      params.push(`%${search}%`);
      paramIdx++;
    }

    if (template && ['minimal', 'workbook', 'business'].includes(template)) {
      whereClause += ` AND e.template = $${paramIdx}`;
      params.push(template);
      paramIdx++;
    }

    if (status && ['draft', 'published'].includes(status)) {
      whereClause += ` AND e.status = $${paramIdx}`;
      params.push(status);
      paramIdx++;
    }

    const countQuery = `
      SELECT COUNT(*)::int AS total 
      FROM ebooks e 
      JOIN users u ON e.user_id = u.id 
      ${whereClause}
    `;
    const countResult = await pool.query(countQuery, params);
    const totalCount = countResult.rows[0]?.total ?? 0;

    const ebooksQuery = `
      SELECT 
        e.id, e.title, e.template, e.status, e.created_at, e.updated_at,
        e.user_id,
        u.email AS user_email,
        u.name AS user_name,
        (e.formatted_json->>'ai_applied')::boolean AS ai_applied
      FROM ebooks e
      JOIN users u ON e.user_id = u.id
      ${whereClause}
      ORDER BY e.updated_at DESC
      LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
    `;
    params.push(limit, offset);

    const ebooksResult = await pool.query(ebooksQuery, params);

    res.json({
      ebooks: ebooksResult.rows,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
        hasMore: page * limit < totalCount,
      },
    });
  } catch (err) {
    console.error('getAllEbooks error:', err);
    res.status(500).json({ error: 'Failed to fetch ebooks' });
  }
};

// ============================================================================
// AUDIT LOGS
// ============================================================================

export const getAuditLogs = async (req: Request, res: Response): Promise<void> => {
  try {
    const action = req.query.action as string;
    const actorEmail = req.query.actorEmail as string;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
    const offset = (page - 1) * limit;

    let whereClause = 'WHERE 1=1';
    const params: (string | number)[] = [];
    let paramIdx = 1;

    if (action) {
      whereClause += ` AND action = $${paramIdx}`;
      params.push(action);
      paramIdx++;
    }

    if (actorEmail) {
      whereClause += ` AND actor_email ILIKE $${paramIdx}`;
      params.push(`%${actorEmail}%`);
      paramIdx++;
    }

    const countQuery = `SELECT COUNT(*)::int AS total FROM admin_audit_logs ${whereClause}`;
    const countResult = await pool.query(countQuery, params);
    const totalCount = countResult.rows[0]?.total ?? 0;

    const logsQuery = `
      SELECT id, actor_user_id, actor_email, action, target_table, target_id, payload_json, created_at
      FROM admin_audit_logs
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
    `;
    params.push(limit, offset);

    const logsResult = await pool.query(logsQuery, params);

    res.json({
      logs: logsResult.rows,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
        hasMore: page * limit < totalCount,
      },
    });
  } catch (err) {
    console.error('getAuditLogs error:', err);
    res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
};

// ============================================================================
// SYSTEM STATUS
// ============================================================================

export const getSystemStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const dbStart = Date.now();
    await pool.query('SELECT 1');
    const dbLatency = Date.now() - dbStart;

    const [dbSize, tableStats] = await Promise.all([
      pool.query(`SELECT pg_database_size(current_database()) AS size`),
      pool.query(`
        SELECT 
          relname AS table_name,
          n_live_tup::int AS row_count
        FROM pg_stat_user_tables
        ORDER BY n_live_tup DESC
        LIMIT 10
      `),
    ]);

    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: {
        latencyMs: dbLatency,
        sizeBytes: dbSize.rows[0]?.size ?? 0,
        sizeFormatted: `${((dbSize.rows[0]?.size ?? 0) / 1024 / 1024).toFixed(2)} MB`,
      },
      tableStats: tableStats.rows,
      server: {
        nodeVersion: process.version,
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
      },
    });
  } catch (err) {
    console.error('getSystemStatus error:', err);
    res.status(500).json({ 
      status: 'unhealthy',
      error: 'Failed to check system status' 
    });
  }
};
