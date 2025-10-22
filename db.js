// db.js
const { MongoClient } = require('mongodb');

const MONGODB_URI = "mongodb+srv://agustinlinares2009_db_user:MARBc9wFwTzuLOWt@cluster0.ueyztsr.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";
const DB_NAME = "test";

let cachedClient = null;
let cachedDb = null;

async function connectMongo() {
  if (cachedClient && cachedDb) return { client: cachedClient, db: cachedDb };

  const client = new MongoClient(MONGODB_URI, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 10000,
  });
  await client.connect();
  const db = client.db(DB_NAME);

  cachedClient = client;
  cachedDb = db;
  return { client, db };
}

module.exports = { connectMongo };
