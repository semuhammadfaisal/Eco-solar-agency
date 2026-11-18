/**
 * MongoDB connection (Mongoose).
 *
 * connect-mongo opens its own client from MONGODB_URI, so sessions keep
 * working even before this module finishes connecting.
 */
'use strict';

const mongoose = require('mongoose');
const config = require('./app');

mongoose.set('strictQuery', true);
// Filters are built from allow-listed request values in the service layer.
// Enabling Mongoose's global sanitizeFilter here also wraps trusted internal
// operators such as $in/$ne/$gte in $eq, which makes valid application queries
// fail with CastErrors. Keep strictQuery enabled and validate at the boundary.
mongoose.set('sanitizeFilter', false);

/** Hide credentials when logging the connection string. */
function safeUri(uri) {
  return uri.replace(/\/\/([^@/]+)@/, '//***:***@');
}

async function connectDB() {
  if (mongoose.connection.readyState === 1) return mongoose.connection;

  mongoose.connection.on('connected', () => {
    const { host, port, name } = mongoose.connection;
    console.log(`[db] connected to ${host}:${port}/${name}`);
  });

  mongoose.connection.on('error', (err) => {
    console.error('[db] connection error:', err.message);
  });

  mongoose.connection.on('disconnected', () => {
    console.warn('[db] disconnected');
  });

  try {
    await mongoose.connect(config.mongoUri, {
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000,
      socketTimeoutMS: 20000,
      maxPoolSize: 20,
      minPoolSize: 2,
      maxIdleTimeMS: 60000,
      autoIndex: !config.isProduction, // build indexes automatically in dev only
    });
  } catch (err) {
    console.error(`[db] unable to connect to ${safeUri(config.mongoUri)}`);
    throw err;
  }

  return mongoose.connection;
}

async function disconnectDB() {
  await mongoose.connection.close();
}

module.exports = { connectDB, disconnectDB };
