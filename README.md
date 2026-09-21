# Bot GenieACS Telegram

Bot Telegram untuk mengelola dan memantau perangkat GenieACS dengan mudah. Bot ini memungkinkan admin dan pelanggan untuk mengakses informasi perangkat dan melakukan konfigurasi dasar melalui Telegram.

## 🚀 Fitur

### Fitur Admin
- Melihat daftar semua perangkat (`/devices`)
- Mengelola pelanggan (`/customers`, `/addcustomer`, `/delcustomer`)
- Mencari pengguna berdasarkan username PPPoE (`/finduser`)
- Memeriksa status perangkat (`/status`)
- Memeriksa status semua WiFi 2.4 GHz & 5 GHz (`/wifi`)
- Mengatur nama WiFi per SSID (`/setwifi`, `/setwifi1` s/d `/setwifi8`)
- Mengatur password WiFi per SSID (`/setpass`, `/setpass1` s/d `/setpass8`)
- Mengatur kredensial WAN (`/addwan`)
- Me-reboot perangkat (`/reboot`)

### Fitur Pelanggan
- Memeriksa status perangkat (`/mystatus`)
- Memeriksa status WiFi 2.4 GHz & 5 GHz (`/mywifi`)
- Mengubah password WiFi per SSID (`/changepass`, `/changepass1` s/d `/changepass8`)
- Mengubah nama WiFi per SSID (`/changessid`, `/changessid1` s/d `/changessid8`)
- Mendapatkan ID Telegram (`/myid`)

## 📋 Prasyarat

- Node.js v14 atau lebih baru
- Server GenieACS yang sudah terkonfigurasi
- Token Bot Telegram (dari @BotFather)

## 🚀 Instalasi

1. **Clone repository ini**
   ```bash
   git clone https://github.com/alijayanet/telebot-acs
   cd telebot-acs
   ```

2. **Install dependensi**
   ```bash
   npm install
   ```

3. **Konfigurasi Environment Variable**
   Salin file `.env.example` menjadi `.env`:
   ```bash
   cp .env.example .env
   ```
   Buka dan edit file `.env` menggunakan teks editor (misal: `nano .env`):
   ```env
   SERVER1_NAME=ALIJAYA-NET
   SERVER1_BOT_TOKEN=1938127147:AAFMcxxxxxxxx
   SERVER1_ADMIN_IDS=56785xxxxxx
   SERVER1_GENIEACS_URL=http://192.168.8.xx:7557
   SERVER1_GENIEACS_USER=admin
   SERVER1_GENIEACS_PASS=admin
   ```
   *(Atau Anda juga dapat menyesuaikan konfigurasi multi-server langsung di file `config.js`)*

4. **Jalankan Bot**
   ```bash
   npm start
   ```

## ⚙️ Menjalankan di Background (PM2)

Agar bot tetap berjalan di background saat koneksi SSH/Putty ditutup, gunakan **PM2**:

1. Install PM2 secara global:
   ```bash
   npm install pm2 -g
   ```
2. Jalankan bot dengan PM2:
   ```bash
   pm2 start index.js --name "genieacs-bot"
   ```
3. Menyimpan status autostart PM2:
   ```bash
   pm2 save
   pm2 startup
   ```

## 📱 Cara Penggunaan

### Untuk Admin

1. Start bot dengan mengirim `/start`
2. Gunakan `/devices` untuk melihat semua perangkat
3. Cek status WiFi: `/wifi {SN/USERNAME}`
4. Ganti nama WiFi per SSID:
   - 2.4 GHz (SSID 1): `/setwifi1 {SN} {SSID_BARU}` atau `/setwifi {SN} 1 {SSID_BARU}`
   - 2.4 GHz (SSID 2): `/setwifi2 {SN} {SSID_BARU}` atau `/setwifi {SN} 2 {SSID_BARU}`
   - 5 GHz (SSID 5): `/setwifi5 {SN} {SSID_BARU}` atau `/setwifi {SN} 5 {SSID_BARU}`
5. Ganti password WiFi per SSID:
   - 2.4 GHz (SSID 1): `/setpass1 {SN} {PASS_BARU}` atau `/setpass {SN} 1 {PASS_BARU}`
   - 5 GHz (SSID 5): `/setpass5 {SN} {PASS_BARU}` atau `/setpass {SN} 5 {PASS_BARU}`
6. Untuk menambah pelanggan:
   - Minta pelanggan mengirim `/myid`
   - Gunakan `/addcustomer {ID_TELEGRAM} "NAMA" {DEVICE_SN}`
   - Contoh: `/addcustomer 123456789 "John Doe" ZTEGC8F12345`

### Untuk Pelanggan

1. Start bot dengan mengirim `/start`
2. Kirim `/myid` dan berikan ID ke admin
3. Setelah didaftarkan, gunakan:
   - `/mystatus` untuk cek status perangkat
   - `/mywifi` untuk cek status seluruh WiFi (2.4 GHz & 5 GHz)
   - `/changepass1 {PASSWORD}` atau `/changepass {PASSWORD}` untuk ganti password 2.4 GHz (SSID 1)
   - `/changepass5 {PASSWORD}` untuk ganti password 5 GHz (SSID 5)
   - `/changessid1 {SSID}` atau `/changessid {SSID}` untuk ganti nama WiFi 2.4 GHz (SSID 1)
   - `/changessid5 {SSID}` untuk ganti nama WiFi 5 GHz (SSID 5)

### 💡 Menu Interaktif (Inline Keyboard)

Selain menggunakan perintah teks di atas, Anda juga dapat menggunakan **Menu Interaktif**:
1. Buka status WiFi dengan `/wifi {SN}` (Admin) atau `/mywifi` (Pelanggan).
2. Bot akan menyertakan tombol inline otomatis untuk setiap SSID (Contoh: `[✏️ Ubah SSID 1]`, `[🔑 Ubah Pass 5]`).
3. Tekan tombol SSID yang ingin diubah, lalu ketik nama atau password baru langsung di chat.
4. Ketik `/cancel` kapan saja jika ingin membatalkan proses perubahan.

## 🔒 Keamanan

- Bot menggunakan sistem autentikasi berbasis ID Telegram
- Data pelanggan disimpan terisolasi di `data/customers.json`
- Hanya admin yang dapat mengakses fitur administratif
- Kredensial sensitif dikonfigurasi melalui `.env` atau `config.js` tanpa terekspos di log

## 🤝 Kontribusi & Komunitas

Kontribusi selalu diterima! Silakan buat pull request atau laporkan issue jika menemukan bug.

- 💬 WhatsApp: https://wa.me/6281947215703
- 💬 Group Telegram: https://t.me/alijayaNetAcs

## 📄 Lisensi

Project ini dilisensikan di bawah [MIT License](LICENSE).
