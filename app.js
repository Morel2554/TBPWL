const express = require('express');
const mysql = require('mysql');
const bcrypt = require('bcrypt');
const session = require('express-session');
const path = require('path');
const QRCode = require('qrcode');


const app = express();
const port = 8000;

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'pages')));
app.use(session({
  secret: 'event_uni_secret_key',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 3600000 } // 1 jam
}));

// Koneksi database
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

// Middleware proteksi login
function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.status(401).send('Silakan login terlebih dahulu.');
  }
  next();
}

// Middleware proteksi role
function checkRole(allowedRoles) {
  return (req, res, next) => {
    console.log('Cek role:', req.session.user?.role, 'vs allowed:', allowedRoles);
    if (!req.session.user || !allowedRoles.includes(req.session.user.role)) {
      return res.status(403).send('Akses ditolak.');
    }
    next();
  };
}


// === ROUTES ===
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'pages', 'index.html'));
});

app.get('/profil.html', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, 'pages', 'profile.html'));
});

app.get('/keuangan.html', requireLogin, checkRole(['tim_keuangan']), (req, res) => {
  res.sendFile(path.join(__dirname, 'pages', 'keuangan.html'));
});

app.get('/admin.html', requireLogin, checkRole(['administrator']), (req, res) => {
  res.sendFile(path.join(__dirname, 'pages', 'admin.html'));
});

// Login
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).send('Username dan password wajib diisi');
  }

  const sql = `
    SELECT users.*, roles.name AS role
    FROM users
    JOIN roles ON users.role_id = roles.id
    WHERE users.username = ? LIMIT 1
  `;
  db.query(sql, [username], (err, results) => {
    if (err) {
      console.error('Query error:', err);
      return res.status(500).send('Server error');
    }

    if (results.length === 0) {
      return res.status(401).send('Username tidak ditemukan');
    }

    const user = results[0];

    bcrypt.compare(password, user.password, (err, isMatch) => {
      if (err || !isMatch) {
        return res.status(401).send('Password salah');
      }

      req.session.user = {
        id: user.id,
        username: user.username,
        name: user.name,
        email: user.email,
        role: user.role,
        role_id: user.role_id,
        status_pembayaran: user.status_pembayaran || null
      };

      console.log('User berhasil login:', req.session.user);
      return res.redirect('/');
    });
  });
});

// Session info
app.get('/session', (req, res) => {
  if (req.session.user) {
    res.json({ user: req.session.user });
  } else {
    res.json({ user: null });
  }
});

// Logout
app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.redirect('/');
  });
});

// ===== KEUANGAN =====
app.get('/api/member-list', requireLogin, checkRole(['tim_keuangan']), (req, res) => {
  const sql = `
    SELECT users.id, users.name, users.username, users.status_pembayaran
    FROM users
    WHERE users.role_id = 1
  `;
  db.query(sql, (err, results) => {
    if (err) {
      console.error('Error ambil member:', err);
      return res.status(500).send('Gagal ambil data member');
    }
    res.json(results);
  });
});

app.post('/api/update-status', requireLogin, checkRole(['tim_keuangan']), (req, res) => {
  const { userId, status } = req.body;
  const sql = `UPDATE users SET status_pembayaran = ? WHERE id = ? AND role_id = 1`;
  db.query(sql, [status, userId], (err) => {
    if (err) {
      console.error('Error update status:', err);
      return res.status(500).send('Gagal update status');
    }
    res.send('Status pembayaran diperbarui');
  });
});

// ===== ADMIN =====
app.get('/api/keuangan', requireLogin, checkRole(['administrator']), (req, res) => {
  const sql = `
    SELECT id, name, username, email
    FROM users
    WHERE role_id = 4
  `;
  db.query(sql, (err, results) => {
    if (err) {
      console.error('Error ambil data tim keuangan:', err);
      return res.status(500).send('Gagal ambil data tim keuangan');
    }
    res.json(results);
  });
});

app.get('/api/panitia', requireLogin, checkRole(['administrator']), (req, res) => {
  const sql = `
    SELECT id, name, username, email
    FROM users
    WHERE role_id = 5
  `;
  db.query(sql, (err, results) => {
    if (err) {
      console.error('Error ambil data panitia:', err);
      return res.status(500).send('Gagal ambil data panitia');
    }
    res.json(results);
  });
});

//EVENT
app.get('/api/events', (req, res) => {
  const sql = `SELECT * FROM events ORDER BY created_at DESC`;
  db.query(sql, (err, results) => {
    if (err) {
      console.error('Gagal load event:', err);
      return res.status(500).send('Gagal load event');
    }
    res.json(results);
  });
});

//Detail
// Ambil detail 1 event
app.get('/api/events/:id', (req, res) => {
  const eventId = req.params.id;
  const sql = `SELECT * FROM events WHERE id = ?`;
  db.query(sql, [eventId], (err, results) => {
    if (err) {
      console.error('Error ambil event:', err);
      return res.status(500).send('Gagal ambil data event');
    }
    if (results.length === 0) return res.status(404).send('Event tidak ditemukan');
    res.json(results[0]);
  });
});

// Daftar event (member) + selalu keluarkan QR jika belum verified
app.post('/api/register-event', (req, res) => {
  if (!req.session.user || req.session.user.role_id !== 2) {
    return res.status(403).json({ message: 'Hanya member yang bisa daftar' });
  }

  const { event_id } = req.body;
  const user_id = req.session.user.id;

  // 1) Cek apakah sudah ada pendaftaran
  const checkSql = `
    SELECT id, status_pembayaran, registrasi_ulang_qrcode
    FROM event_registrations
    WHERE user_id = ? AND event_id = ?
  `;
  db.query(checkSql, [user_id, event_id], (err, rows) => {
    if (err) {
      console.error('Error cek daftar:', err);
      return res.status(500).json({ message: 'Server error' });
    }

    // 2) Jika sudah terdaftar
    if (rows.length > 0) {
      const reg = rows[0];
      // a) Bila belum bayar, kembalikan QR lama atau generate ulang
      if (reg.status_pembayaran !== 'verified') {
        // kalau sebelumnya sudah ada QR di kolom registrasi_ulang_qrcode
        if (reg.registrasi_ulang_qrcode) {
          return res.json({
            message: 'Anda sudah mendaftar, silakan scan QR untuk bayar',
            qr_url: reg.registrasi_ulang_qrcode
          });
        }
        // bila belum ada QR tersimpan, generate baru
        const qrContent = `http://localhost:8000/qr-scanned/${reg.id}`;
        return QRCode.toDataURL(qrContent)
          .then(qrDataUrl => {
            // simpan ke DB
            const updSql = `UPDATE event_registrations SET registrasi_ulang_qrcode = ? WHERE id = ?`;
            db.query(updSql, [qrDataUrl, reg.id], updErr => {
              if (updErr) console.error('Gagal simpan QR:', updErr);
              res.json({
                message: 'Anda sudah mendaftar, silakan scan QR untuk bayar',
                qr_url: qrDataUrl
              });
            });
          })
          .catch(qrErr => {
            console.error('Error generate QR ulang:', qrErr);
            res.status(500).json({ message: 'Gagal generate QR ulang' });
          });
      }

      // b) Jika sudah terverifikasi
      return res.json({ message: 'Anda sudah menyelesaikan pembayaran' });
    }

    // 3) Jika belum pernah daftar → insert + generate QR baru
    const insertSql = `INSERT INTO event_registrations (user_id, event_id) VALUES (?, ?)`;
    db.query(insertSql, [user_id, event_id], (err2, result) => {
      if (err2) {
        console.error('Error daftar event:', err2);
        return res.status(500).json({ message: 'Gagal daftar event' });
      }

      const registrationId = result.insertId;
      const qrContent = `http://localhost:8000/qr-scanned/${registrationId}`;

      QRCode.toDataURL(qrContent)
        .then(qrDataUrl => {
          // simpan QR ke DB
          const updSql = `UPDATE event_registrations SET registrasi_ulang_qrcode = ? WHERE id = ?`;
          db.query(updSql, [qrDataUrl, registrationId], updErr => {
            if (updErr) console.error('Gagal simpan QR:', updErr);
            res.json({
              message: 'Pendaftaran berhasil, silakan scan QR untuk bayar',
              qr_url: qrDataUrl
            });
          });
        })
        .catch(qrErr => {
          console.error('Error generate QR:', qrErr);
          res.status(500).json({ message: 'Gagal generate QR' });
        });
    });
  });
});


app.get('/qr-scanned/:registrationId', (req, res) => {
  const regId = req.params.registrationId;

  // 1) Update status pembayaran
  const updSql = `UPDATE event_registrations SET status_pembayaran = 'verified' WHERE id = ?`;
  db.query(updSql, [regId], err => {
    if (err) {
      console.error('Error update status QR:', err);
      return res.status(500).send('Gagal update status');
    }

    // 2) Insert kehadiran
    const hadirSql = `INSERT INTO kehadiran (registration_id) VALUES (?)`;
    db.query(hadirSql, [regId], err2 => {
      if (err2) console.error('Error insert kehadiran:', err2);
      // 3) Redirect ke index
      res.redirect('/');
    });
  });
});


// Daftar sertifikat member
app.get('/api/certificates', requireLogin, (req, res) => {
  if (req.session.user.role_id !== 2) {
    return res.status(403).send('Hanya member');
  }
  const userId = req.session.user.id;
  const sql = `
    SELECT e.nama, k.id AS hadir_id
    FROM kehadiran k
    JOIN event_registrations r ON k.registration_id = r.id
    JOIN events e ON r.event_id = e.id
    WHERE r.user_id = ?
  `;
  db.query(sql, [userId], (err, rows) => {
    if (err) {
      console.error('Error fetch certificates:', err);
      return res.status(500).send('Server error');
    }
    // Kirim array { nama, hadir_id }
    res.json(rows);
  });
});

// Register

// Register member baru
app.post('/register', async (req, res) => {
  const { name, username, email, password } = req.body;

  if (!name || !username || !email || !password) {
    return res.status(400).send('Semua field wajib diisi');
  }

  // Cek username sudah dipakai?
  const checkSql = `SELECT id FROM users WHERE username = ?`;
  db.query(checkSql, [username], async (err, results) => {
    if (err) {
      console.error('Error cek username:', err);
      return res.status(500).send('Server error');
    }

    if (results.length > 0) {
      return res.status(400).send('Username sudah digunakan');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Simpan user dengan role_id = 2 (member)
    const insertSql = `
      INSERT INTO users (name, username, email, password, role_id)
      VALUES (?, ?, ?, ?, 2)
    `;
    db.query(insertSql, [name, username, email, hashedPassword], (err2) => {
      if (err2) {
        console.error('Error simpan user:', err2);
        return res.status(500).send('Gagal simpan user');
      }
      // Redirect ke login setelah register berhasil
      res.redirect('/login.html');
    });
  });
});

// ADmin html
app.post('/api/deactivate-user', requireLogin, checkRole(['administrator']), (req, res) => {
  const { id } = req.body;

  // Nonaktifkan user dengan mengganti role_id menjadi 0 (tidak aktif)
  const sql = `UPDATE users SET role_id = 0 WHERE id = ?`;
  db.query(sql, [id], (err) => {
    if (err) {
      console.error('Error nonaktifkan user:', err);
      return res.status(500).send('Gagal nonaktifkan user');
    }
    res.send('User berhasil dinonaktifkan');
  });
});

// admin tambah tim

// Tambah akun (role_id: 4 = tim keuangan, 5 = panitia)
app.post('/api/create-user', requireLogin, checkRole(['administrator']), async (req, res) => {
  const { name, username, email, password, role_id } = req.body;

  if (!name || !username || !email || !password || !role_id) {
    return res.status(400).send('Semua field wajib diisi');
  }

  const checkSql = `SELECT id FROM users WHERE username = ? OR email = ?`;
  db.query(checkSql, [username, email], async (err, results) => {
    if (err) {
      console.error('Gagal cek user:', err);
      return res.status(500).send('Server error');
    }

    if (results.length > 0) {
      return res.status(400).send('Username atau email sudah digunakan');
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const insertSql = `
      INSERT INTO users (name, username, email, password, role_id)
      VALUES (?, ?, ?, ?, ?)
    `;
    db.query(insertSql, [name, username, email, hashedPassword, role_id], (err2) => {
      if (err2) {
        console.error('Gagal tambah user:', err2);
        return res.status(500).send('Gagal tambah user');
      }
      res.send('User berhasil ditambahkan');
    });
  });
});

// Hapus akun berdasarkan ID
app.delete('/api/delete-user', requireLogin, checkRole(['administrator']), (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).send('ID wajib dikirim');

  const sql = `DELETE FROM users WHERE id = ? AND role_id IN (4, 5)`;
  db.query(sql, [id], (err) => {
    if (err) {
      console.error('Gagal hapus user:', err);
      return res.status(500).send('Gagal hapus user');
    }
    res.send('User berhasil dihapus');
  });
});

// EVENT Panitia
//tambah
app.post('/api/events', requireLogin, checkRole(['panitia']), (req, res) => {
  const { nama, tanggal, waktu, lokasi, narasumber, poster, biaya, maksimal_peserta } = req.body;
  if (!nama || !tanggal || !waktu || !lokasi || !narasumber || !biaya || !maksimal_peserta) {
    return res.status(400).send('Kolom wajib tidak lengkap');
  }

  const sql = `
    INSERT INTO events (nama, tanggal, waktu, lokasi, narasumber, poster, biaya, maksimal_peserta, dibuat_oleh)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  db.query(sql, [
    nama, tanggal, waktu, lokasi, narasumber, poster || null, biaya, maksimal_peserta, req.session.user.id
  ], (err) => {
    if (err) return res.status(500).send('Gagal tambah event');
    res.send('Berhasil tambah event');
  });
});
//edit
app.put('/api/events/:id', requireLogin, checkRole(['panitia']), (req, res) => {
  const { nama, tanggal, waktu, lokasi, narasumber, poster, biaya, maksimal_peserta } = req.body;
  if (!nama || !tanggal || !waktu || !lokasi || !narasumber || !biaya || !maksimal_peserta) {
    return res.status(400).send('Kolom wajib tidak lengkap');
  }

  const sql = `
    UPDATE events SET
      nama = ?, tanggal = ?, waktu = ?, lokasi = ?, narasumber = ?, poster = ?, biaya = ?, maksimal_peserta = ?
    WHERE id = ?
  `;
  db.query(sql, [
    nama, tanggal, waktu, lokasi, narasumber, poster || null, biaya, maksimal_peserta, req.params.id
  ], (err, result) => {
    if (err) return res.status(500).send('Gagal update event');
    if (result.affectedRows === 0) return res.status(404).send('Event tidak ditemukan');
    res.send('Berhasil update event');
  });
});

//delete
app.delete('/api/events/:id', requireLogin, checkRole(['panitia']), (req, res) => {
  const sql = `DELETE FROM events WHERE id = ?`;
  db.query(sql, [req.params.id], (err) => {
    if (err) return res.status(500).send('Gagal hapus');
    res.send('Berhasil hapus');
  });
});

// Keuangan

// Daftar member dan event yang mereka daftarkan
app.get('/api/daftar-member', requireLogin, checkRole(['tim_keuangan']), (req, res) => {
  const sql = `
    SELECT u.id AS user_id, u.name AS member_name, u.email,
           e.nama AS event_name, r.status_pembayaran
    FROM users u
    JOIN event_registrations r ON u.id = r.user_id
    JOIN events e ON r.event_id = e.id
    WHERE u.role_id = 2
    ORDER BY u.id DESC
  `;
  db.query(sql, (err, results) => {
    if (err) {
      console.error('Gagal ambil data daftar member:', err);
      return res.status(500).send('Gagal ambil data');
    }
    res.json(results);
  });
});


// Server
app.listen(port, () => {
  console.log(`Server berjalan di http://localhost:${port}`);
});
