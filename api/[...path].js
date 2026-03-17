// Vercel catch-all serverless entry for all /api/* routes
const app = require('../dist/index');
module.exports = app.default || app;
