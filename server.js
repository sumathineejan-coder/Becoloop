const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const initSqlJs = require('sql.js');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const admin = require('firebase-admin');

// 1. Firebase Admin Initialization
let firestore = null;
function initFirebase() {
  try {
    let serviceAccount;
    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    } else if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH && fs.existsSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH)) {
      serviceAccount = require(path.resolve(process.env.FIREBASE_SERVICE_ACCOUNT_PATH));
    } else if (fs.existsSync(path.join(__dirname, 'serviceAccountKey.json'))) {
      serviceAccount = require(path.join(__dirname, 'serviceAccountKey.json'));
    }

    if (!serviceAccount) { 
      console.warn('Firebase profile sync disabled: configure FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_SERVICE_ACCOUNT_JSON'); 
      return; 
    }

    if (!admin.apps.length) {
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    }
    firestore = admin.firestore();
    console.log('Firebase Firestore profile connection ready');
  } catch (error) {
    console.error('Firebase initialization failed:', error.message);
  }
}

async function getFirebaseProfile(role, publicId) {
  if (!firestore) return null;
  try {
    const candidates = [
      firestore.collection('users').doc(`${role}_${publicId}`),
      firestore.collection('users').doc(String(publicId))
    ];
    for (const ref of candidates) {
      const snap = await ref.get();
      if (snap.exists) {
        const data = snap.data() || {};
        if (data.role && data.role !== role) continue;
        const name = role === 'merchant'
          ? (data.shopName || data.storeName || data.displayName || data.name || data.fullName)
          : (data.fullName || data.displayName || data.name || data.studentName);
        return { name: typeof name === 'string' ? name.trim() : '', role };
      }
    }
  } catch (e) {
    console.error('getFirebaseProfile
