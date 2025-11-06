import express from 'express';
import expressLayouts from 'express-ejs-layouts';
import session from 'express-session';
import bcrypt from 'bcryptjs';
import mysql from 'mysql2/promise';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.set('view engine', 'ejs');
const port = process.env.PORT || 3000;

// --- DB POOL ---
const db = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: 'Pu@160307',
  database: process.env.DB_NAME || 'tourism',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// --- MIDDLEWARE ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(process.cwd(), 'public')));



// views
app.use(expressLayouts);
app.set('layout', 'layout');  // default layout file: views/layout.ejs
// sessions
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'change_this_secret',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }, // set true if behind HTTPS + proxy
  })
);

// expose user to all templates
app.use((req, res, next) => {
  res.locals.siteName = 'Tourism';
  res.locals.user = req.session.user || null;
  next();
});

// auth guard
function checkAuth(req, res, next) {
  if (req.session.user) return next();
  return res.redirect('/login');
}

// --- ROUTES ---

// Home
app.get('/', (req, res) => {
  res.render('index');
});

// Login (view)
app.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/travel_plan');
  res.render('login', { error: null });
});

// Login (submit)
app.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    const [rows] = await db.query('SELECT * FROM users WHERE username = ?', [
      username,
    ]);
    const user = rows[0];
    if (!user) {
      return res.status(401).render('login', { error: 'Invalid credentials' });
    }

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      return res.status(401).render('login', { error: 'Invalid credentials' });
    }

    req.session.user = { id: user.user_id, username: user.username };
    res.redirect('/');
  } catch (e) {
    console.error('Login Error:', e);
    res.status(500).render('login', { error: 'Server error. Try again.' });
  }
});

// Register (view)
app.get('/register', (req, res) => {
  if (req.session.user) return res.redirect('/travel_plan');
  res.render('register', { error: null });
});

// Register (submit)
app.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;

    // simple checks
    if (!username || !password) {
      return res.status(400).render('register', { error: 'All fields required' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const sql = 'INSERT INTO users(username, password) VALUES(?, ?)';
    const [result] = await db.query(sql, [username, hashedPassword]);

req.session.user = { id: result.insertId, username };


    res.redirect('/travel_plan');
  } catch (e) {
    console.error('Register Error:', e);
    let msg = 'Error registering user.';
    if (e.code === 'ER_DUP_ENTRY') msg = 'Username already taken.';
    res.status(500).render('register', { error: msg });
  }
});

// Search (view)
app.get('/search', (req, res) => {
  res.render('searched_place', { destinations: [], q: '' });
});

// Search (submit) — SINGLE correct POST route
app.post('/search', async (req, res) => {
  try {
    const { city_name } = req.body;
    const q = `%${city_name || ''}%`;

    const [rows] = await db.query(
      'SELECT * FROM destinations WHERE city_name LIKE ?',
      [q]
    );

    res.render('searched_place', { destinations: rows, q: city_name || '' });
  } catch (e) {
    console.error('Search Error:', e);
    res.status(500).send('An error occurred during the search.');
  }
});

// Travel plan (protected)
app.get('/travel_plan', checkAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;
console.log('User ID:', userId); // Debugging line
    const [rows] = await db.query(
      'SELECT * FROM trips WHERE user_id = ? ORDER BY trip_id DESC',
      [userId]
    );
console.log('Trips:', rows); // Debugging line
    res.render('travel_plan', { trips:rows });
  } catch (e) {
    console.error('Travel Plan Error:', e);
    res.status(500).send('Error loading travel plan.');
  }
});


// Logout
app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});
app.get('/trip/:id', checkAuth, async (req, res) => {
  const tripId = req.params.id;

  const [[trip]] = await db.query(
    `SELECT * FROM trips WHERE trip_id = ?`,
    [tripId]
  );

  const [destinations] = await db.query(
    `SELECT * FROM destinations WHERE trip_id = ?`,
    [tripId]
  );

  const [activities] = await db.query(
    `SELECT * FROM activities WHERE destination_id IN (SELECT destination_id FROM destinations WHERE trip_id=?)`,
    [tripId]
  );

  const [expenses] = await db.query(
    `SELECT * FROM expenses WHERE trip_id = ?`,
    [tripId]
  );

  res.render('trip_detail', { trip, destinations, activities, expenses });
});
app.post('/create_trip', checkAuth, async(req, res) => {const user_id=req.session.user.id;
  const {from_city,to_city,start_date,end_date,transport} = req.body;
  const sqlquery1=`insert into trips(user_id,trip_name,start_date,end_date) values(?,?,?,?)`;
  await db.query(sqlquery1,[user_id,from_city,start_date,end_date]);

res.redirect('/travel_plan');
});

app.use((req, res) => res.status(404).send('Not found'));

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});

export default app;
