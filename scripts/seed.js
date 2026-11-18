#!/usr/bin/env node
/**
 * Seed the first owner account and the company settings document.
 *
 * Usage:
 *   npm run seed
 *   npm run seed -- --name "Ali Khan" --email owner@company.pk --password "Secret123"
 *   npm run seed -- --force        # reset the password of an existing owner
 *
 * Values fall back to SEED_OWNER_* in .env. If no password is supplied, a
 * strong temporary password is generated and printed once.
 */
'use strict';

require('dotenv').config();

const crypto = require('crypto');
const mongoose = require('mongoose');
const { connectDB } = require('../config/db');
const User = require('../models/User');
const Settings = require('../models/Settings');
const Item = require('../models/Item');
const Package = require('../models/Package');
const { ROLES } = require('../config/roles');

// ---------------------------------------------------------------------------
// CLI helpers
// ---------------------------------------------------------------------------

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index !== -1 && process.argv[index + 1] && !process.argv[index + 1].startsWith('--')) {
    return process.argv[index + 1];
  }
  return fallback;
}

function generatePassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(18);
  let password = '';
  for (let i = 0; i < bytes.length; i += 1) {
    password += alphabet[bytes[i] % alphabet.length];
  }
  // Guarantee the policy: at least one digit.
  return `${password}7`;
}

function isValidPassword(password) {
  return (
    typeof password === 'string' &&
    password.length >= 8 &&
    password.length <= 72 &&
    /[A-Za-z]/.test(password) &&
    /[0-9]/.test(password)
  );
}

function fail(message) {
  console.error(`\n  ✖ ${message}\n`);
  process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const force = process.argv.includes('--force');

  const name = arg('name', process.env.SEED_OWNER_NAME || 'Company Owner').trim();
  const email = arg('email', process.env.SEED_OWNER_EMAIL || 'owner@example.com')
    .trim()
    .toLowerCase();
  const phone = arg('phone', process.env.SEED_OWNER_PHONE || '').trim();
  const providedPassword = arg('password', process.env.SEED_OWNER_PASSWORD || '');
  const generated = !providedPassword;
  const password = generated ? generatePassword() : providedPassword;

  if (!name) return fail('Owner name cannot be empty.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail('Enter a valid owner email.');
  if (!isValidPassword(password)) {
    return fail(
      'Password must be 8–72 characters and contain at least one letter and one number.'
    );
  }

  await connectDB();

  const existing = await User.findOne({ email }).select('+passwordHash');
  let created = false;

  if (existing && !force) {
    console.log(`\n  ℹ An account with ${email} already exists (role: ${existing.role}).`);
    console.log('    Nothing changed. Use --force to reset its password and role to owner.\n');
  } else if (existing) {
    existing.name = name;
    existing.phone = phone;
    existing.role = ROLES.OWNER;
    existing.isActive = true;
    await existing.setPassword(password);
    await existing.save();
    console.log(`\n  ✔ Updated existing owner account: ${email}\n`);
  } else {
    const owner = new User({
      name,
      email,
      phone,
      role: ROLES.OWNER,
      isActive: true,
    });
    await owner.setPassword(password);
    await owner.save();
    created = true;
    console.log(`\n  ✔ Created owner account: ${email}\n`);
  }

  // Ensure the singleton settings document exists with sensible defaults.
  await Settings.getSingleton();

  // Wait for indexes (unique email, etc.) to be ready.
  await User.init();

  // Seed standard inventory items if catalog is empty
  const itemCount = await Item.countDocuments();
  if (itemCount === 0) {
    const items = await Item.create([
      {
        sku: 'PAN-550W-LONGI',
        name: 'Longi 550W Mono PERC Solar Panel',
        category: 'panel',
        brand: 'Longi',
        model: 'Hi-MO 6',
        wattage: 550,
        unit: 'pcs',
        purchasePricePaisa: 1550000,
        avgCostPaisa: 1550000,
        sellingPricePaisa: 1950000,
        currentStock: 200,
        hasSerial: false,
      },
      {
        sku: 'PAN-580W-JINKO',
        name: 'Jinko 580W N-Type Bifacial Panel',
        category: 'panel',
        brand: 'Jinko',
        model: 'Tiger Neo 72HL4-BDV',
        wattage: 580,
        unit: 'pcs',
        purchasePricePaisa: 1680000,
        avgCostPaisa: 1680000,
        sellingPricePaisa: 2150000,
        currentStock: 150,
        hasSerial: false,
      },
      {
        sku: 'INV-5KW-GROWATT',
        name: 'Growatt 5kW On-Grid Inverter',
        category: 'inverter',
        brand: 'Growatt',
        model: 'MIN 5000TL-X',
        capacityKw: 5,
        unit: 'pcs',
        purchasePricePaisa: 11000000,
        avgCostPaisa: 11000000,
        sellingPricePaisa: 14500000,
        currentStock: 15,
        hasSerial: false,
      },
      {
        sku: 'INV-10KW-HUAWEI',
        name: 'Huawei 10kW Three-Phase On-Grid Inverter',
        category: 'inverter',
        brand: 'Huawei',
        model: 'SUN2000-10KTL-M1',
        capacityKw: 10,
        unit: 'pcs',
        purchasePricePaisa: 21000000,
        avgCostPaisa: 21000000,
        sellingPricePaisa: 26500000,
        currentStock: 10,
        hasSerial: false,
      },
      {
        sku: 'INV-6KW-DEYE',
        name: 'Deye 6kW Hybrid Inverter (Single Phase)',
        category: 'inverter',
        brand: 'Deye',
        model: 'SUN-6K-SG04LP1-EU',
        capacityKw: 6,
        unit: 'pcs',
        purchasePricePaisa: 22000000,
        avgCostPaisa: 22000000,
        sellingPricePaisa: 27500000,
        currentStock: 12,
        hasSerial: false,
      },
      {
        sku: 'BAT-5KWH-PYLON',
        name: 'Pylontech 5.12kWh Lithium Battery',
        category: 'battery',
        brand: 'Pylontech',
        model: 'US5000 48V 100Ah',
        capacityKw: 5.12,
        unit: 'pcs',
        purchasePricePaisa: 28000000,
        avgCostPaisa: 28000000,
        sellingPricePaisa: 35000000,
        currentStock: 8,
        hasSerial: false,
      },
      {
        sku: 'STR-ALUM-L2',
        name: 'Elevated Aluminum Mounting Structure (L2)',
        category: 'structure',
        brand: 'Local',
        model: 'L2 Heavy-Duty 14 Gauge',
        unit: 'set',
        purchasePricePaisa: 500000,
        avgCostPaisa: 500000,
        sellingPricePaisa: 750000,
        currentStock: 100,
        hasSerial: false,
      },
      {
        sku: 'CAB-DC-4MM',
        name: '4mm Copper TUV Solar DC Cable',
        category: 'cable',
        brand: 'Pakistan Cables',
        model: 'EN 50618 Halogen Free',
        unit: 'meter',
        purchasePricePaisa: 18000,
        avgCostPaisa: 18000,
        sellingPricePaisa: 25000,
        currentStock: 1000,
        hasSerial: false,
      },
      {
        sku: 'DB-ACDC-6KW',
        name: 'AC/DC Distribution Protection Box (IP65)',
        category: 'breaker',
        brand: 'Schneider',
        model: 'Complete with SPD + Breakers',
        unit: 'set',
        purchasePricePaisa: 2500000,
        avgCostPaisa: 2500000,
        sellingPricePaisa: 3800000,
        currentStock: 25,
        hasSerial: false,
      },
      {
        sku: 'EAR-ROD-10FT',
        name: 'Pure Copper Earthing Bore & Chemical Rod',
        category: 'earthing',
        brand: 'Local',
        model: '10ft Heavy Copper Rod with Bentonite',
        unit: 'set',
        purchasePricePaisa: 1200000,
        avgCostPaisa: 1200000,
        sellingPricePaisa: 1800000,
        currentStock: 40,
        hasSerial: false,
      },
    ]);
    console.log(`  ✔ Seeded ${items.length} initial inventory catalog items.`);

    // Seed standard package templates
    const pkgCount = await Package.countDocuments();
    if (pkgCount === 0) {
      const panel550 = items[0];
      const panel580 = items[1];
      const invGrowatt = items[2];
      const invHuawei = items[3];
      const invDeye = items[4];
      const batPylon = items[5];
      const struct = items[6];
      const cable = items[7];
      const db = items[8];
      const earth = items[9];

      await Package.create([
        {
          code: 'PKG-0001',
          name: '5kW On-Grid Standard System',
          systemType: 'on_grid',
          capacityKw: 5.5,
          description: 'Standard 5.5kW residential on-grid solar system with net-metering readiness.',
          items: [
            { item: panel550._id, qty: 10, notes: '10 x 550W Tier 1 panels' },
            { item: invGrowatt._id, qty: 1, notes: '5kW on-grid inverter' },
            { item: struct._id, qty: 5, notes: 'L2 structure sets' },
            { item: cable._id, qty: 60, notes: '60 meters solar DC cable' },
            { item: db._id, qty: 1, notes: 'AC/DC DB protection' },
            { item: earth._id, qty: 1, notes: 'Copper earthing bore' },
          ],
          laborCostPaisa: 4500000,
          transportCostPaisa: 1500000,
          netMeteringCostPaisa: 10000000,
          defaultDiscountPercent: 2,
          isActive: true,
        },
        {
          code: 'PKG-0002',
          name: '10kW On-Grid Commercial / High-Load System',
          systemType: 'on_grid',
          capacityKw: 10.44,
          description: 'High efficiency 10.4kW system for large residential and commercial setups.',
          items: [
            { item: panel580._id, qty: 18, notes: '18 x 580W Bifacial panels' },
            { item: invHuawei._id, qty: 1, notes: 'Huawei 10kW three-phase inverter' },
            { item: struct._id, qty: 9, notes: 'L2 structure sets' },
            { item: cable._id, qty: 120, notes: '120 meters solar DC cable' },
            { item: db._id, qty: 1, notes: 'Three-phase protection DB' },
            { item: earth._id, qty: 2, notes: 'Dual earthing system' },
          ],
          laborCostPaisa: 8000000,
          transportCostPaisa: 2500000,
          netMeteringCostPaisa: 12000000,
          defaultDiscountPercent: 3,
          isActive: true,
        },
        {
          code: 'PKG-0003',
          name: '6kW Hybrid Storage System (Load-Shedding Proof)',
          systemType: 'hybrid',
          capacityKw: 6.05,
          description: '6kW hybrid solar system with lithium battery storage for 24/7 backup power.',
          items: [
            { item: panel550._id, qty: 11, notes: '11 x 550W Tier 1 panels' },
            { item: invDeye._id, qty: 1, notes: 'Deye 6kW hybrid inverter' },
            { item: batPylon._id, qty: 1, notes: '5.12kWh lithium storage battery' },
            { item: struct._id, qty: 6, notes: 'L2 structure sets' },
            { item: cable._id, qty: 80, notes: '80 meters solar DC cable' },
            { item: db._id, qty: 1, notes: 'Hybrid DB with changeover' },
            { item: earth._id, qty: 1, notes: 'Earthing system' },
          ],
          laborCostPaisa: 6000000,
          transportCostPaisa: 2000000,
          netMeteringCostPaisa: 0,
          defaultDiscountPercent: 0,
          isActive: true,
        },
      ]);
      console.log('  ✔ Seeded 3 standard reusable solar package templates.');
    }
  }

  if (created || force) {
    console.log('  ┌─────────────────────────────────────────────────────────────');
    console.log('  │ Sign in with these credentials:');
    console.log(`  │   Email    : ${email}`);
    console.log(`  │   Password : ${password}`);
    if (generated) {
      console.log('  │');
      console.log('  │ This password is shown only once. Change it after signing in.');
    }
    console.log('  └─────────────────────────────────────────────────────────────\n');
  }
}

main()
  .catch((err) => {
    console.error('\n  ✖ Seed failed:', err.message);
    if (err.code === 11000) {
      console.error('    A user with this email already exists (duplicate key).');
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close().catch(() => {});
  });
