// Vercel serverless entry — re-exports the compiled Express app
const app = require('../dist/index');
module.exports = app.default || app;
