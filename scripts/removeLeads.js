'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const { connectDB } = require('../config/db');

async function collectionExists(name) {
  const rows = await mongoose.connection.db.listCollections({ name }).toArray();
  return rows.length > 0;
}

async function dropIfPresent(name) {
  if (!(await collectionExists(name))) return false;
  await mongoose.connection.db.collection(name).drop();
  return true;
}

async function dropIndexIfPresent(collectionName, indexName) {
  if (!(await collectionExists(collectionName))) return;
  const collection = mongoose.connection.db.collection(collectionName);
  const indexes = await collection.indexes();
  if (indexes.some((index) => index.name === indexName)) await collection.dropIndex(indexName);
}

async function run() {
  await connectDB();
  const db = mongoose.connection.db;
  const confirmed = process.argv.includes('--confirm');
  const confirmEmpty = process.argv.includes('--confirm-empty');

  const inspect = async () => {
    const leadsCount = (await collectionExists('leads'))
      ? await db.collection('leads').countDocuments()
      : 0;
    const followupsCount = (await collectionExists('followups'))
      ? await db.collection('followups').countDocuments()
      : 0;
    const auditCount = (await collectionExists('auditlogs'))
      ? await db.collection('auditlogs').countDocuments({
          $or: [
            { module: { $in: ['leads', 'followups'] } },
            { action: { $regex: /^(lead|followup)\./ } },
          ],
        })
      : 0;
    const referenceCounts = {};
    for (const name of ['surveys', 'systemconfigs', 'quotations', 'sales']) {
      referenceCounts[name] = (await collectionExists(name))
        ? await db.collection(name).countDocuments({ lead: { $exists: true, $ne: null } })
        : 0;
    }
    return { leadsCount, followupsCount, auditCount, referenceCounts };
  };

  if (!confirmed && !confirmEmpty) {
    const { leadsCount, followupsCount, auditCount, referenceCounts } = await inspect();
    console.log(`[remove leads] DRY RUN: ${leadsCount} lead(s), ${followupsCount} follow-up(s).`);
    console.log(`[remove leads] matching audit rows: ${auditCount}`);
    console.log(`[remove leads] references: ${JSON.stringify(referenceCounts)}`);
    console.log('[remove leads] No data changed. Re-run with --confirm after explicit approval.');
    await mongoose.connection.close();
    return;
  }

  if (confirmEmpty) {
    const state = await inspect();
    const total = state.leadsCount + state.followupsCount + state.auditCount
      + Object.values(state.referenceCounts).reduce((sum, count) => sum + count, 0);
    if (total !== 0) {
      throw new Error(`Empty-only cleanup refused because ${total} related record(s) now exist.`);
    }
    for (const name of ['surveys', 'systemconfigs', 'quotations', 'sales']) {
      await dropIndexIfPresent(name, 'lead_1');
      await dropIndexIfPresent(name, 'lead_1_createdAt_-1');
    }
    const followupsDropped = await dropIfPresent('followups');
    const leadsDropped = await dropIfPresent('leads');
    console.log(`[remove leads] empty followups collection dropped: ${followupsDropped}`);
    console.log(`[remove leads] empty leads collection dropped: ${leadsDropped}`);
    await mongoose.connection.close();
    return;
  }

  let relinkedSurveys = 0;
  let removedOrphanSurveys = 0;

  if (await collectionExists('leads')) {
    const surveys = db.collection('surveys');
    const orphaned = await surveys.find({
      $or: [{ customer: { $exists: false } }, { customer: null }],
      lead: { $exists: true, $ne: null },
    }).toArray();

    for (const survey of orphaned) {
      const lead = await db.collection('leads').findOne({ _id: survey.lead });
      const customer = lead && (lead.customer || lead.convertedCustomer);
      if (customer) {
        await surveys.updateOne({ _id: survey._id }, { $set: { customer }, $unset: { lead: '' } });
        relinkedSurveys += 1;
      } else {
        await surveys.deleteOne({ _id: survey._id });
        removedOrphanSurveys += 1;
      }
    }
  }

  const referenceCollections = ['surveys', 'systemconfigs', 'quotations', 'sales'];
  for (const name of referenceCollections) {
    if (await collectionExists(name)) {
      await db.collection(name).updateMany({ lead: { $exists: true } }, { $unset: { lead: '' } });
      await dropIndexIfPresent(name, 'lead_1');
      await dropIndexIfPresent(name, 'lead_1_createdAt_-1');
    }
  }

  if (await collectionExists('auditlogs')) {
    await db.collection('auditlogs').deleteMany({
      $or: [
        { module: { $in: ['leads', 'followups'] } },
        { action: { $regex: /^(lead|followup)\./ } },
      ],
    });
  }

  const followupsDropped = await dropIfPresent('followups');
  const leadsDropped = await dropIfPresent('leads');

  console.log(`[remove leads] CONFIRMED PURGE; surveys reassigned to customers: ${relinkedSurveys}`);
  console.log(`[remove leads] surveys removed because no customer existed: ${removedOrphanSurveys}`);
  console.log(`[remove leads] followups collection dropped: ${followupsDropped}`);
  console.log(`[remove leads] leads collection dropped: ${leadsDropped}`);
  await mongoose.connection.close();
}

run().catch(async (err) => {
  console.error('[remove leads] failed:', err.message);
  await mongoose.connection.close().catch(() => {});
  process.exit(1);
});
