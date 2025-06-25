const bcrypt = require('bcrypt');

const Password = 'zakew12345';
bcrypt.hash(Password, 10, (err, hash) => {
  if (err) {
    console.error('Gagal hash:', err);
  } else {
    console.log('Hash baru:', hash);
  }
});
