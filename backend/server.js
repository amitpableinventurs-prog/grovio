require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');

const { connectDB } = require('./src/config/db');
require('./src/models'); // registers all Mongoose models

const { initSocket } = require('./src/sockets');
const { notFoundHandler, errorHandler } = require('./src/middleware/error.middleware');
const swaggerUi = require('swagger-ui-express');
const openapiSpec = require('./src/docs/openapi');

const app = express();

app.use(cors());
app.use(morgan('dev'));

// Interactive API docs — http://localhost:5000/api-docs (raw spec at /api-docs.json,
// handy for handing to a Flutter dev or feeding to an OpenAPI codegen tool).
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openapiSpec, { customSiteTitle: 'Grovio API Docs' }));
app.get('/api-docs.json', (req, res) => res.json(openapiSpec));

// Mounted before express.json() so the Razorpay webhook route can read the raw body.
app.use('/api/v1/payments', require('./src/routes/payments.routes'));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Standalone public vendor-signup page (calls POST /api/v1/auth/register-vendor directly) —
// deliberately kept as a separate plain-HTML directory rather than a route inside admin-panel's
// React app, since it needs to be reachable without logging in.
app.use('/vendor-signup', express.static(path.join(__dirname, '../vendor-signup')));

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.get('/', (req, res) => {
  res.json({
    name: 'Grovio API',
    status: 'ok',
    docs: '/api-docs',
    openapiSpec: '/api-docs.json',
    apiBase: '/api/v1',
  });
});
app.use('/api/v1', require('./src/routes'));

app.use(notFoundHandler);
app.use(errorHandler);

const PORT = process.env.PORT || 5000;
const server = http.createServer(app);
initSocket(server);

connectDB()
  .then(() => {
    server.listen(PORT, () => console.log(`Grovio backend running on port ${PORT}`));
  })
  .catch((err) => {
    console.error('Failed to connect to MongoDB:', err.message);
    process.exit(1);
  });
