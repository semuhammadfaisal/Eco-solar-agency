'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const AppNotification = require('../models/AppNotification');

const root = path.join(__dirname, '..');

test('layouts use local UI assets instead of external CDN dependencies', () => {
  for (const layout of ['admin.ejs', 'auth.ejs', 'bare.ejs']) {
    const source = fs.readFileSync(path.join(root, 'views', 'layouts', layout), 'utf8');
    assert.equal(source.includes('cdn.jsdelivr.net'), false, layout);
    assert.match(source, /\/vendor\/bootstrap\/bootstrap\.min\.css/);
    assert.match(source, /\/vendor\/bootstrap-icons\/bootstrap-icons\.min\.css/);
  }
});

test('required local vendor files are installed', () => {
  const files = [
    'node_modules/bootstrap/dist/css/bootstrap.min.css',
    'node_modules/bootstrap/dist/js/bootstrap.bundle.min.js',
    'node_modules/bootstrap-icons/font/bootstrap-icons.min.css',
    'node_modules/bootstrap-icons/font/fonts/bootstrap-icons.woff2',
    'node_modules/alpinejs/dist/cdn.min.js',
    'node_modules/chart.js/dist/chart.umd.js',
  ];
  files.forEach((file) => assert.equal(fs.existsSync(path.join(root, file)), true, file));
});

test('notification feed has a compound unread-user-time index', () => {
  const index = AppNotification.schema.indexes().find(([keys]) =>
    keys.forUser === 1 && keys.isRead === 1 && keys.createdAt === -1
  );
  assert.ok(index);
});
