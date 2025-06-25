const express = require('express');
const mysql = require('mysql');
const bcrypt = require('bcrypt');
const path = require('path');
const session = require('express-session');

const app = express();
const port = 8000;

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'pages')));

// Session middleware
app.use(session({
  secret: 'event_uni_secret_key',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 3600000 } // 1 jam
}));

// Koneksi ke database
const db = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'event_univ01'
});

db.connect((err) => {
  if (err) {
    console.error('Gagal konek ke database:', err);
    process.exit(1);
  }
  console.log('Berhasil konek ke database MySQL');
});

// === ROUTES ===

// Root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'pages', 'index.html'));
});

// API untuk proses login
app.post('/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).send('Username dan password wajib diisi');
  }

  const sql = 'SELECT * FROM users WHERE username = ? LIMIT 1';
  db.query(sql, [username], (err, results) => {
    if (err) {
      console.error('Error query ke database:', err);
      return res.status(500).send('Internal server error');
    }

    if (results.length === 0) {
      return res.status(401).send('Username tidak ditemukan');
    }

    const user = results[0];

    bcrypt.compare(password, user.password, (err, isMatch) => {
      if (err) {
        console.error('Error bcrypt:', err);
        return res.status(500).send('Internal server error');
      }

      if (!isMatch) {
        return res.status(401).send('Password salah');
      }

      // Simpan info user ke session
      req.session.user = {
        id: user.id,
        username: user.username,
        name: user.name,
        role_id: user.role_id
      };

      console.log('Login berhasil:', req.session.user);

      // Redirect ke index
      return res.redirect('/');
    });
  });
});

// API untuk cek sesi user (dipakai di index.html)
app.get('/session', (req, res) => {
  if (req.session.user) {
    res.json({ user: req.session.user });
  } else {
    res.json({ user: null });
  }
});

// API logout
app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.sendStatus(200);
  });
});

// Jalankan server
app.listen(port, () => {
  console.log(`Server berjalan di http://localhost:${port}`);
});
