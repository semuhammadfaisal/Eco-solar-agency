'use strict';

const mongoose = require('mongoose');
const Branch = require('../models/Branch');
const Brand = require('../models/Brand');
const Item = require('../models/Item');
const User = require('../models/User');
const Counter = require('../models/Counter');
const ApiError = require('../utils/ApiError');
const { text } = require('../utils/inputs');

async function nextBranchCode() {
  const seq = await Counter.next('branch');
  return `BR-${String(seq).padStart(3, '0')}`;
}

async function listBranches() {
  const [branches, userCounts] = await Promise.all([
    Branch.find().populate('manager', 'name').sort({ type: 1, name: 1 }).lean(),
    User.aggregate([
      { $match: { isActive: true, deletedAt: null, branch: { $ne: null } } },
      { $group: { _id: '$branch', count: { $sum: 1 } } },
    ]),
  ]);
  const countByBranch = new Map(userCounts.map((row) => [String(row._id), row.count]));
  return branches.map((branch) => ({
    ...branch,
    userCount: countByBranch.get(String(branch._id)) || 0,
  }));
}

async function getBranch(id) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound('Branch not found.');
  const branch = await Branch.findById(id);
  if (!branch) throw ApiError.notFound('Branch not found.');
  return branch;
}

async function saveBranch(id, input, actor) {
  const data = {
    name: text(input.name, 120), address: text(input.address, 250), city: text(input.city, 80),
    phone: text(input.phone, 20), notes: text(input.notes, 1000), isActive: String(input.isActive || '1') === '1',
    manager: mongoose.isValidObjectId(input.manager) ? input.manager : null,
  };
  if (!data.name) throw ApiError.badRequest('Branch name is required.');
  if (id) {
    const branch = await getBranch(id);
    Object.assign(branch, data);
    await branch.save();
    return branch;
  }
  return Branch.create({ ...data, code: await nextBranchCode(), type: 'branch', createdBy: actor._id });
}

async function listBrands() {
  const [brands, productCounts] = await Promise.all([
    Brand.find().sort({ name: 1 }).lean(),
    Item.aggregate([
      { $match: { deletedAt: null } },
      { $group: { _id: { brandRef: '$brandRef', brand: '$brand' }, count: { $sum: 1 } } },
    ]),
  ]);
  const byRef = new Map();
  const byName = new Map();
  productCounts.forEach((row) => {
    if (row._id.brandRef) byRef.set(String(row._id.brandRef), (byRef.get(String(row._id.brandRef)) || 0) + row.count);
    else if (row._id.brand) {
      const key = String(row._id.brand).toLowerCase();
      byName.set(key, (byName.get(key) || 0) + row.count);
    }
  });
  return brands.map((brand) => ({
    ...brand,
    productCount: (byRef.get(String(brand._id)) || 0) + (byName.get(brand.name.toLowerCase()) || 0),
  }));
}

async function getBrand(id) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound('Brand not found.');
  const brand = await Brand.findById(id);
  if (!brand) throw ApiError.notFound('Brand not found.');
  return brand;
}

async function saveBrand(id, input, actor) {
  const data = {
    name: text(input.name, 100), description: text(input.description, 500), contactName: text(input.contactName, 120),
    phone: text(input.phone, 20), isActive: String(input.isActive || '1') === '1',
  };
  if (!data.name) throw ApiError.badRequest('Brand name is required.');
  if (id) {
    const brand = await getBrand(id);
    const oldName = brand.name;
    Object.assign(brand, data);
    await brand.save();
    await Item.updateMany({ $or: [{ brandRef: brand._id }, { brand: oldName }] }, { $set: { brandRef: brand._id, brand: brand.name } });
    return brand;
  }
  const brand = await Brand.create({ ...data, createdBy: actor._id });
  await Item.updateMany({ brand: new RegExp(`^${data.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }, { $set: { brandRef: brand._id, brand: brand.name } });
  return brand;
}

async function brandOptions() { return Brand.find({ isActive: true }).sort({ name: 1 }).lean(); }

module.exports = { listBranches, getBranch, saveBranch, listBrands, getBrand, saveBrand, brandOptions };
