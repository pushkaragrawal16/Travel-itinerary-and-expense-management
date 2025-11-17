import express from 'express';
import expressLayouts from 'express-ejs-layouts';
import session from 'express-session';
import bcrypt from 'bcryptjs';
import mysql from 'mysql2/promise';
import path from 'path';
import dotenv from 'dotenv';
import multer from "multer";
import { start } from 'repl';

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "public/uploads/"),
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname)
});

const upload = multer({ storage });

dotenv.config();

const app = express();
app.set('view engine', 'ejs');
const port = process.env.PORT || 3000;

const db = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS,

  database: process.env.DB_NAME || 'tourism',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});


app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(process.cwd(), 'public')));




app.use(expressLayouts);
app.set('layout', 'layout'); 

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'change_this_secret',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }, 
  })
);


app.use((req, res, next) => {
  res.locals.siteName = 'TripEasy';
  res.locals.user = req.session.user || null;
  next();
});

function checkAuth(req, res, next) {
  if (req.session.user) return next();
  return res.redirect('/login');
}


app.get('/', (req, res) => {
  res.render('index');
});


app.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/travel_plan');
  res.render('login', { error: null });
});


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

app.get('/register', (req, res) => {
  if (req.session.user) return res.redirect('/travel_plan');
  res.render('register', { error: null });
});


app.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;

 
    if (!username || !password) {
      return res.status(400).render('register', { error: 'All fields required' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const sql = 'INSERT INTO users(username, password) VALUES(?, ?)';
    const [result] = await db.query(sql, [username, hashedPassword]);

req.session.user = { id: result.insertId, username };


    res.redirect('/');
  } catch (e) {
    console.error('Register Error:', e);
    let msg = 'Error registering user.';
    if (e.code === 'ER_DUP_ENTRY') msg = 'Username already taken.';
    res.status(500).render('register', { error: msg });
  }
});

app.get('/search', (req, res) => {
  res.render('searched_place', { destinations: [], q: '' });
});
app.post('/search', async (req, res) => {
  try {
    let { city_name } = req.body;

    if (!city_name) {
      return res.render("searched_place", { q: "", results: [], acost: [], tcost: [] });
    }


    const tokens = city_name.toLowerCase().trim().split(/\s+/);


    let conditions = tokens
      .map(t => `
        (
          LOWER(city_name) LIKE ? 
          OR LOWER(country) LIKE ?
          OR SOUNDEX(city_name) = SOUNDEX(?)
          OR SOUNDEX(country) = SOUNDEX(?)
        )
      `)
      .join(" AND ");

    let values = [];
    tokens.forEach(t => {
      values.push(`%${t}%`);
      values.push(`%${t}%`);
      values.push(t);
      values.push(t);
    });

    const sql = `SELECT * FROM destinations WHERE ${conditions}`;
    const [results] = await db.query(sql, values);


    if (!results || results.length === 0) {
      return res.render("searched_place", {
        q: city_name,
        results: [],
        acost: [],
        tcost: []
      });
    }

    const destinationId = results[0].destination_id;
    const tripId = results[0].trip_id;

    const [acost] = await db.execute(
      `SELECT SUM(booking_cost) AS activitycost FROM activities WHERE destination_id = ?`,
      [destinationId]
    );

    const [tcost] = await db.execute(
      `SELECT SUM(amount) AS totalcost FROM expenses WHERE trip_id = ?`,
      [tripId]
    );

    res.render("searched_place", { q: city_name, results, acost, tcost });

  } catch (err) {
    console.log(err);
    res.status(500).send("Server error");
  }
});




app.get('/travel_plan', checkAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;

    const [rows] = await db.query(
      'SELECT * FROM trips WHERE user_id = ? ORDER BY trip_id DESC',
      [userId]
    );

    if (!rows || rows.length === 0) {
      return res.render('travel_plan', { trips: [], expenses: [] });
    }

    const latestTripId = rows[0].trip_id;

    const [rows2] = await db.query(
      `SELECT SUM(amount) AS totalcost FROM expenses WHERE trip_id = ?`,
      [latestTripId]
    );

    res.render('travel_plan', { trips: rows, expenses: rows2 });

  } catch (e) {
    console.error('Travel Plan Error:', e);
    res.status(500).send('Error loading travel plan.');
  }
});



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
  `SELECT 
      d.*, 
      DATE_FORMAT(d.arrival_date, '%d %b, %Y') AS arrival_date,
      DATE_FORMAT(d.departure_date, '%d %b, %Y') AS dep_date,
      (
        SELECT SUM(booking_cost) 
        FROM activities 
        WHERE destination_id = d.destination_id
      ) AS activity_cost
   FROM destinations d
   WHERE d.trip_id = ?`,
  [tripId]
);

console.log(destinations);
  const [activities] = await db.query(
    `SELECT * FROM activities WHERE destination_id IN (SELECT destination_id FROM destinations WHERE trip_id=?)`,
    [tripId]
  );

  const [expenses] = await db.query(
    `SELECT e.*,ec.category_name FROM expenses e join expense_category ec on e.category_id=ec.category_id WHERE trip_id = ?`,
    [tripId]
  );
  const q1=`select sum(booking_cost) as activitycost from activities where destination_id IN (SELECT destination_id FROM destinations WHERE trip_id=?)`;

  
  const [acost]=await db.query(q1,[tripId]);

  
   
   const [imageRows] = await db.query("SELECT * FROM trip_images WHERE trip_id=?", [tripId]);

  res.render('trip_detail', { trip, destinations, activities, expenses,images:imageRows,acost });
});
app.post('/create_trip', checkAuth, async(req, res) => {const user_id=req.session.user.id;
  const {from_city,to_city,trip_name,start_date,end_date,country} = req.body;
  const sqlquery1=`insert into trips(user_id,trip_name,start_date,end_date) values(?,?,?,?)`;
  await db.query(sqlquery1,[user_id,trip_name,start_date,end_date]);
  const sqlquery2=`insert into destinations(start_city,trip_id,city_name,country,arrival_date,departure_date) values(?,?,?,?,?,?)`;
  const [result]=await db.query('SELECT LAST_INSERT_ID() as trip_id');
  const trip_id=result[0].trip_id;
  await db.query(sqlquery2,[from_city,trip_id,to_city,country,start_date,end_date]);


res.redirect('/travel_plan');
});
app.post("/trip/:id/upload_image", upload.single("media"), async (req, res) => {
  try {
    const tripId = req.params.id;

    if (!req.file) {
      return res.send("No file uploaded!");
    }

    const imageUrl = "/uploads/" + req.file.filename;

    await db.query(
      "INSERT INTO trip_images (trip_id, image_url) VALUES (?, ?)",
      [tripId, imageUrl]
    );

    res.redirect("/trip/" + tripId);
  } catch (err) {
    console.error(err);
    res.send("Error uploading image");
  }
});
app.post('/trip/:id/add_destination', checkAuth, async(req, res) => {
  const tripId = req.params.id;
  const {start_city,city_name,country,arrival_date,departure_date} = req.body;
  const sqlquery2=`insert into destinations(start_city,trip_id,city_name,country,arrival_date,departure_date) values(?,?,?,?,?,?)`;
  await db.query(sqlquery2,[start_city,tripId,city_name,country,arrival_date,departure_date]);
  res.redirect('/trip/'+tripId);
});

app.post('/trip/:id/add_activity', checkAuth, async(req, res) => {
  const tripId = req.params.id;
  const {destination_id,activity_name,activity_date,start_time,booking_cost,description} = req.body;
  const ecactivity_id=5;
  const sqlquery3=`insert into activities(activity_name,destination_id,activity_date,start_time,booking_cost,description) values(?,?,?,?,?,?)`;
  const sqlquery4=`insert into expenses(trip_id,category_id,description,amount,expense_date) values(?,?,?,?,?)`
  await db.query(sqlquery3,[activity_name,destination_id,activity_date,start_time,booking_cost,description]);
  await db.query(sqlquery4,[tripId,5,description,booking_cost,activity_date]);
  res.redirect('/trip/'+tripId);

})
app.post('/trip/:id/add_expense', checkAuth, async(req, res) => {
  const tripId = req.params.id;
  const {category_id,amount,expense_date,description} = req.body;
  const sqlquery4=`insert into expenses(trip_id,category_id,amount,expense_date,description) values(?,?,?,?,?)`;
  await db.query(sqlquery4,[tripId,category_id,amount,expense_date,description]);
  res.redirect('/trip/'+tripId);

})
app.get("/trip/:id/expenses-summary", checkAuth, async (req, res) => {
  const tripId = req.params.id;

  const [expenses] = await db.query(
    `SELECT e.*, c.category_name 
     FROM expenses e
     LEFT JOIN expense_category c ON e.category_id = c.category_id
     WHERE e.trip_id = ?
     ORDER BY e.expense_date ASC`,
    [tripId]
  );

  const [categoryTotals] = await db.query(
    `SELECT 
        c.category_name AS label,
        Cast(SUM(e.amount) AS DECIMAL(10,2)) AS total
     FROM expenses e
     LEFT JOIN expense_category c ON e.category_id = c.category_id
     WHERE e.trip_id = ?
     GROUP BY c.category_name`,
    [tripId]
  );

  const [dailyTotals] = await db.query(
    `SELECT 
        DATE(expense_date) AS day,
        SUM(amount) AS total
     FROM expenses
     WHERE trip_id = ?
     GROUP BY DATE(expense_date)
     ORDER BY day ASC`,
    [tripId]
  );
const totalExpense=`select sum(amount) as total from expenses where trip_id=?`;
const [total]=await db.query(totalExpense,[tripId]);
console.log('Total Expense:', total); 

  res.render("expense_summary", {total,
    tripId,
    expenses,
    categoryTotals,
    dailyTotals
  });
});


app.get('/regular-trips', checkAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;

   
    const [trips] = await db.query(
      `SELECT * FROM regular_trips WHERE user_id = ?`,
      [userId]
    );

    for (let t of trips) {


      const [tripMatches] = await db.query(
        `SELECT trip_id FROM trips 
         WHERE user_id = ? AND trip_name LIKE ?`,
        [userId, `%${t.trip_name}%`]
      );

      if (tripMatches.length === 0) {
        t.visits = 0;
        t.total_expense = 0;
        t.avg_expense = 0;
        continue;
      }

      const tripIds = tripMatches.map(row => row.trip_id);

      const idList = tripIds.join(",");

      const [ex] = await db.query(
        `SELECT SUM(amount) AS total FROM expenses 
         WHERE trip_id IN (${idList})`
      );

      t.visits = tripIds.length;
     t.total_expense = Number(ex[0].total) || 0;
t.avg_expense   = t.visits ? (t.total_expense / t.visits) : 0;

    }

    res.render("regular_trips", { regular_trips: trips });

  } catch (err) {
    console.log(err);
    res.status(500).send("Server Error");
  }
});

app.get('/regular-trips/add', checkAuth, (req, res) => {

    res.render('add_regulartrips');
});

app.post('/regular-trips/add', checkAuth, async (req, res) => {
    const user_id = req.session.user.id;
    const { from_city, to_city, trip_name, country } = req.body;

    await db.query(
        `INSERT INTO regular_trips (user_id, from_city, to_city, trip_name, country)
        VALUES (?, ?, ?, ?, ?)`,
        [user_id, from_city, to_city, trip_name, country]
    );

    res.redirect('/regular-trips');
});

app.get('/regular-trips/explore/:id', checkAuth, async (req, res) => {
  const regId = req.params.id;
  const userId = req.session.user.id;


  const [[reg]] = await db.query(
    `SELECT * FROM regular_trips WHERE id = ? AND user_id = ?`,
    [regId, userId]
  );

  if (!reg) return res.send("Regular trip not found");

  const [result] = await db.query(
    `INSERT INTO trips (user_id, trip_name, start_date, end_date)
     VALUES (?, ?, CURDATE(), CURDATE())`,
    [userId, reg.trip_name]
  );

  const newTripId = result.insertId;

  await db.query(
    `INSERT INTO destinations (start_city, trip_id, city_name, country, arrival_date, departure_date)
     VALUES (?, ?, ?, ?, CURDATE(), CURDATE())`,
    [reg.from_city, newTripId, reg.to_city, reg.country]
  );

  res.redirect(`/trip/${newTripId}`);
});


app.use((req, res) => res.status(404).send('Not found'));

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});

export default app;
