require('dotenv').config();
const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Supabase Client with Service Role Key to bypass strict RLS
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

app.use(express.json());
app.use(express.static(path.join(__dirname)));

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// ----------------------------------------------------
// Auth & Verification Endpoints
// ----------------------------------------------------

// Request verification code for registration/login
app.post('/api/request-code', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) {
      return res.status(400).json({ error: 'Phone number is required' });
    }

    const code = generateCode();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 minutes

    const { error } = await supabase
      .from('verification_codes')
      .insert([{ phone, code, expires_at: expiresAt }]);

    if (error) throw error;

    console.log(`[SMS Simulation] Verification code for ${phone}: ${code}`);
    res.json({ message: 'Verification code sent successfully', code });
  } catch (error) {
    console.error('Error requesting code:', error);
    res.status(500).json({ error: 'Failed to send verification code' });
  }
});

// Verify code and authenticate user
app.post('/api/verify-code', async (req, res) => {
  try {
    const { phone, code } = req.body;
    if (!phone || !code) {
      return res.status(400).json({ error: 'Phone number and code are required' });
    }

    // Find latest active code
    const { data: record, error: codeErr } = await supabase
      .from('verification_codes')
      .select('*')
      .eq('phone', phone)
      .eq('code', code)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (codeErr) throw codeErr;
    if (!record) {
      return res.status(400).json({ error: 'Invalid or expired verification code' });
    }

    // Delete used code
    await supabase.from('verification_codes').delete().eq('id', record.id);

    // Get or create user
    let { data: user, error: userErr } = await supabase
      .from('users')
      .select('*')
      .eq('phone', phone)
      .maybeSingle();

    if (userErr) throw userErr;

    if (!user) {
      const { data: newUser, error: createErr } = await supabase
        .from('users')
        .insert([{ phone, points: 0 }])
        .select()
        .single();
      
      if (createErr) throw createErr;
      user = newUser;
    }

    // Create session token
    const token = 'token_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
    const sessionExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days

    const { error: sessionErr } = await supabase
      .from('sessions')
      .insert([{ token, user_id: user.id, expires_at: sessionExpiresAt }]);

    if (sessionErr) throw sessionErr;

    res.json({
      token,
      user: {
        id: user.id,
        phone: user.phone,
        points: user.points
      }
    });
  } catch (error) {
    console.error('Error verifying code:', error);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// Middleware to authenticate session requests
async function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const { data: session, error: sessionErr } = await supabase
      .from('sessions')
      .select('*, users(*)')
      .eq('token', token)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    if (sessionErr || !session) {
      return res.status(403).json({ error: 'Invalid or expired session' });
    }

    req.user = session.users;
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// Get current user profile
app.get('/api/me', authenticateToken, (req, res) => {
  res.json({
    id: req.user.id,
    phone: req.user.phone,
    points: req.user.points
  });
});

// Logout
app.post('/api/logout', authenticateToken, async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    await supabase.from('sessions').delete().eq('token', token);
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Logout failed' });
  }
});

// ----------------------------------------------------
// Transaction & Points Endpoints
// ----------------------------------------------------

// Submit transaction (awards 100 points per confirmed transaction)
app.post('/api/transactions', authenticateToken, async (req, res) => {
  try {
    const { amount, description } = req.body;

    // 1. Insert confirmed transaction
    const { data: transaction, error: txErr } = await supabase
      .from('transactions')
      .insert([{
        user_id: req.user.id,
        amount: amount || 0,
        description: description || 'EcoLoop activity',
        status: 'confirmed'
      }])
      .select()
      .single();

    if (txErr) throw txErr;

    // 2. Award 100 points to user
    const newPoints = (req.user.points || 0) + 100;

    const { error: updateErr } = await supabase
      .from('users')
      .update({ points: newPoints })
      .eq('id', req.user.id);

    if (updateErr) throw updateErr;

    res.json({
      message: 'Transaction confirmed successfully',
      transaction,
      pointsEarned: 100,
      totalPoints: newPoints
    });
  } catch (error) {
    console.error('Error creating transaction:', error);
    res.status(500).json({ error: 'Failed to process transaction' });
  }
});

// Get transaction history
app.get('/api/transactions', authenticateToken, async (req, res) => {
  try {
    const { data: transactions, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(transactions);
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
